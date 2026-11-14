"use client";

import { forceCollide, forceManyBody } from "d3-force";
import { useEffect, useMemo, useRef } from "react";
import ForceGraph2D, { type ForceGraphMethods, type NodeObject } from "react-force-graph-2d";
import {
  buildSectorLayout,
  computeRankedHalos,
  dominantSector,
  forceAngularTarget,
  forceRadialTarget,
  initialPosition,
  R_MAX,
  R_MIN,
  rankedRadius,
  SECTOR_GAP,
  sectorSpread,
  type GraphNode,
  type Halo,
  type SectorLayout,
} from "@/lib/physics";
import { SECTOR_COLOR, SECTOR_SHORT, STAGE_LABELS, type Sector } from "@/lib/taxonomy";
import type { Deal, Match } from "@/lib/types";
import type { GraphProps } from "./Graph";
import { monoFont, uiFont } from "./canvasFont";
import { useSimHeat } from "./simHeat";

const ACCENT = "#FF6A3D";
const FOUNDER_ID = "__founder__";
const TOP_N = 10;
const NAMED_N = 5;
const BASE_PX = 12;
const EDGE_MS = 500;
const EDGE_STAGGER_MS = 70;
const HALO_EVERY = 4;
const FIXTURE_SUFFIX = " (fixture)";
// Rim labels hang off the ring horizontally, so the horizontal fit needs more room.
const FIT_R_Y = R_MAX + 96;
const FIT_R_X = R_MAX + 190;
const TERRITORY_IN = R_MIN * 0.55;
const TERRITORY_OUT = R_MAX + 38;
const RIM_LABEL_R = R_MAX + 60;
const RIM_LABEL_MIN = 3;
const FLAT_RANGE = 15;

type Props = GraphProps & { width: number; height: number; reducedMotion: boolean; padLeft: number; idle: boolean };

type Satellite = { deal: Deal; x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };
type Label = {
  n: GraphNode;
  name: string;
  score: string;
  nameW: number;
  scoreW: number;
  rect: Rect;
  ax: number;
  ay: number;
  leader: boolean;
  compact: boolean;
};

// Eight directions, near ring first then far ring (far placements get a leader line).
const DIRS = [0, Math.PI, -Math.PI / 4, Math.PI / 4, (-3 * Math.PI) / 4, (3 * Math.PI) / 4, -Math.PI / 2, Math.PI / 2];
const RINGS = [10, 30, 54];

const alphaCache = new Map<string, string>();
function withAlpha(color: string, alpha: number): string {
  const a = Math.round(alpha * 100) / 100;
  const key = `${color}|${a}`;
  let out = alphaCache.get(key);
  if (out) return out;
  if (color.startsWith("hsl(")) out = color.replace(")", ` / ${a})`);
  else if (color.startsWith("#") && color.length === 7) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    out = `rgb(${r} ${g} ${b} / ${a})`;
  } else out = color;
  alphaCache.set(key, out);
  return out;
}

function easeOutCubic(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - c, 3);
}

function displayName(name: string): string {
  return name.endsWith(FIXTURE_SUFFIX) ? name.slice(0, -FIXTURE_SUFFIX.length) : name;
}

// Radial glow rendered once per (colour, alpha) into a sprite; drawImage replaces a
// per-node createRadialGradient in the paint loop.
const spriteCache = new Map<string, HTMLCanvasElement>();
function glowSprite(color: string, alpha: number): HTMLCanvasElement {
  const key = `${color}|${alpha}`;
  let c = spriteCache.get(key);
  if (c) return c;
  const size = 96;
  c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, withAlpha(color, alpha));
  grad.addColorStop(1, withAlpha(color, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  spriteCache.set(key, c);
  return c;
}

// Territory fills live in graph space (the canvas transform applies), so one gradient per
// (sector, alpha step) serves every frame.
const territoryCache = new Map<string, CanvasGradient>();
function territoryFill(ctx: CanvasRenderingContext2D, sector: Sector, alpha: number): CanvasGradient {
  const a = Math.round(alpha * 200) / 200;
  const key = `${sector}|${a}`;
  let g = territoryCache.get(key);
  if (g) return g;
  const color = SECTOR_COLOR[sector];
  g = ctx.createRadialGradient(0, 0, TERRITORY_IN, 0, 0, TERRITORY_OUT);
  g.addColorStop(0, withAlpha(color, 0));
  g.addColorStop(0.35, withAlpha(color, a));
  g.addColorStop(1, withAlpha(color, a * 0.3));
  territoryCache.set(key, g);
  return g;
}

// Widths are measured once at BASE_PX and scaled; canvas text width is linear in font size.
const nameFont = () => `600 ${BASE_PX}px ${uiFont()}`;
const scoreFont = () => `500 ${BASE_PX}px ${monoFont()}`;
const widthCache = new Map<string, number>();
function textWidth(ctx: CanvasRenderingContext2D, font: string, text: string): number {
  const key = `${font}|${text}`;
  let w = widthCache.get(key);
  if (w === undefined) {
    ctx.font = font;
    w = ctx.measureText(text).width;
    widthCache.set(key, w);
  }
  return w;
}

function overlaps(a: Rect, b: Rect, pad: number): boolean {
  return a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
}

// Only targets change on a score update; d3 keeps positions and drifts them (spec 5.5).
// A flat score band (nothing heard yet) keeps everyone on the outer ring.
function applyMatches(byId: Map<string, GraphNode>, matches: Match[], snap: boolean) {
  if (!matches.length) return;
  const hi = matches[0].score;
  const lo = matches[matches.length - 1].score;
  const flat = hi - lo < FLAT_RANGE;
  matches.forEach((m, i) => {
    const n = byId.get(m.investorId);
    if (!n) return;
    n.score = m.score;
    n.rank = flat ? Infinity : i;
    n.targetR = rankedRadius(m.score, i, matches.length, lo, hi, flat);
    if (snap) {
      n.x = Math.cos(n.targetA) * n.targetR;
      n.y = Math.sin(n.targetA) * n.targetR;
      n.vx = 0;
      n.vy = 0;
    }
  });
}

function pill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, alpha: number) {
  ctx.fillStyle = `rgb(11 14 23 / ${alpha})`;
  const r = h / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
}

function dealYear(d: Deal): string {
  return d.date ? d.date.slice(0, 4) : "";
}

function buildNodes(investors: GraphProps["investors"], centerLabel: string): { nodes: GraphNode[]; layout: SectorLayout } {
  const founder: GraphNode = {
    id: FOUNDER_ID,
    kind: "founder",
    name: centerLabel,
    sector: "other",
    score: 100,
    rank: -1,
    targetR: 0,
    targetA: 0,
    fx: 0,
    fy: 0,
    x: 0,
    y: 0,
  };
  const counts = new Map<Sector, number>();
  const members = new Map<Sector, { id: string; S: Partial<Record<Sector, number>> }[]>();
  for (const inv of investors) {
    const s = dominantSector(inv.revealed.S);
    counts.set(s, (counts.get(s) ?? 0) + 1);
    const list = members.get(s) ?? [];
    list.push({ id: inv.id, S: inv.revealed.S });
    members.set(s, list);
  }
  const layout = buildSectorLayout(counts);
  const angles = new Map<string, number>();
  for (const [s, list] of members) for (const [id, a] of sectorSpread(layout, s, list)) angles.set(id, a);
  const list = investors.map<GraphNode>((inv, i) => {
    const n: GraphNode = {
      id: inv.id,
      kind: "investor",
      name: inv.name,
      sector: dominantSector(inv.revealed.S),
      score: 50,
      rank: Infinity,
      targetR: rankedRadius(50, i, investors.length, 45, 55, true),
      targetA: angles.get(inv.id) ?? 0,
    };
    const p = initialPosition(n, 0.12);
    n.x = p.x;
    n.y = p.y;
    return n;
  });
  return { nodes: [founder, ...list], layout };
}

export default function GraphCanvas({ investors, matches, selectedId, onSelect, center, emphasis, width, height, reducedMotion, padLeft, idle }: Props) {
  const fg = useRef<ForceGraphMethods<NodeObject<GraphNode>> | undefined>(undefined);
  const hovered = useRef<string | undefined>(undefined);
  const haloAlpha = useRef(new Map<Sector, number>());
  const territoryAlpha = useRef(new Map<Sector, number>());
  const haloCache = useRef<{ frame: number; halos: Halo[] }>({ frame: 0, halos: [] });
  const selectedAt = useRef(0);
  const forcesReady = useRef(false);
  const satBuf = useRef<Satellite[]>([]);
  const labelBuf = useRef<Label[]>([]);
  const obstacles = useRef<Rect[]>([]);
  const { reheat, tick: heatTick, scaled } = useSimHeat(reducedMotion);
  const UI = uiFont();
  const MONO = monoFont();

  // Nodes are created once per investor set and then mutated in place so d3 keeps
  // positions and velocities across score updates.
  const built = useMemo(() => buildNodes(investors, center?.label ?? "You"), [investors]); // eslint-disable-line react-hooks/exhaustive-deps
  const { nodes, layout } = built;

  const graphData = useMemo(() => ({ nodes, links: [] }), [nodes]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const matchById = useMemo(() => new Map(matches.map((m) => [m.investorId, m])), [matches]);
  const topIds = useMemo(() => matches.slice(0, TOP_N).map((m) => m.investorId), [matches]);
  const topNodes = useMemo(() => topIds.map((id) => byId.get(id)).filter((n): n is GraphNode => Boolean(n)), [topIds, byId]);
  const founder = nodes[0];

  useEffect(() => {
    const f = byId.get(FOUNDER_ID);
    if (f) f.name = center?.label ?? "You";
  }, [center?.label, byId]);

  useEffect(() => {
    const g = fg.current;
    if (!g || forcesReady.current) return;
    forcesReady.current = true;
    g.d3Force("link", null);
    g.d3Force("center", null);
    g.d3Force("charge", scaled(forceManyBody().strength(-6).distanceMax(60)));
    g.d3Force("collide", forceCollide<NodeObject<GraphNode>>().radius((n) => (n.kind === "founder" ? 52 : n.rank < TOP_N ? 26 : 10)).strength(0.9));
    g.d3Force("radial", scaled(forceRadialTarget(0.1)));
    g.d3Force("angular", scaled(forceAngularTarget(0.09)));
  });

  useEffect(() => {
    applyMatches(byId, matches, reducedMotion);
    reheat();
  }, [matches, byId, reducedMotion, reheat]);

  // The ring is a fixed size, so the zoom only moves when the pane does; the centre shifts
  // right when a panel covers the left edge.
  useEffect(() => {
    const g = fg.current;
    if (!g) return;
    const k = Math.min((width - padLeft) / (2 * FIT_R_X), height / (2 * FIT_R_Y));
    const ms = reducedMotion ? 0 : 600;
    g.zoom(k, ms);
    g.centerAt(-padLeft / (2 * k), 0, ms);
  }, [width, height, padLeft, reducedMotion]);

  useEffect(() => {
    selectedAt.current = performance.now();
  }, [selectedId]);

  const satellitesFor = (node: GraphNode, match: Match | undefined): Satellite[] => {
    const buf = satBuf.current;
    buf.length = 0;
    if (!match || node.x === undefined || node.y === undefined) return buf;
    const deals = match.evidence.length > 3 ? match.evidence.slice(0, 3) : match.evidence;
    const outward = Math.atan2(node.y, node.x);
    const spread = 0.8;
    const dist = 112;
    for (let i = 0; i < deals.length; i++) {
      const a = outward + (i - (deals.length - 1) / 2) * spread;
      buf.push({ deal: deals[i], x: node.x + Math.cos(a) * dist, y: node.y + Math.sin(a) * dist });
    }
    return buf;
  };

  // Pill geometry for an evidence satellite: company on line 1, round + year on line 2.
  const satelliteBox = (ctx: CanvasRenderingContext2D, sat: Satellite, originX: number, inv: number) => {
    const right = sat.x >= originX;
    const round = sat.deal.round === "unknown" ? "Round n/a" : STAGE_LABELS[sat.deal.round];
    const line2 = `${round} ${dealYear(sat.deal)}`.trim();
    const w1 = textWidth(ctx, nameFont(), sat.deal.company) * (11 / BASE_PX) * inv;
    const w2 = textWidth(ctx, scoreFont(), line2) * (10 / BASE_PX) * inv;
    const w = Math.max(w1, w2) + 12 * inv;
    const h = 30 * inv;
    const dx = right ? 7 * inv : -7 * inv;
    const x = right ? sat.x + dx - 6 * inv : sat.x + dx - w + 6 * inv;
    return { right, line2, dx, rect: { x, y: sat.y - h / 2, w, h } };
  };

  const drawGlow = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, alpha: number) => {
    ctx.drawImage(glowSprite(color, alpha), x - r, y - r, r * 2, r * 2);
  };

  // Sector territories: a soft wedge per sector, brighter for sectors the pitch mentions,
  // named once on the rim. These carry the sector names so node labels do not have to.
  const paintTerritories = (ctx: CanvasRenderingContext2D, scale: number) => {
    const inv = 1 / scale;
    for (const [s, slot] of layout) {
      const target = emphasis?.[s] ?? 0;
      const cur = territoryAlpha.current.get(s) ?? 0;
      const next = reducedMotion ? target : cur + (target - cur) * 0.06;
      territoryAlpha.current.set(s, next);
      const a0 = slot.angle - slot.half + SECTOR_GAP;
      const a1 = slot.angle + slot.half - SECTOR_GAP;
      if (a1 - a0 < 0.03) continue;
      const base = idle ? 0.045 : 0.06;
      const alpha = base + 0.16 * next;
      ctx.fillStyle = territoryFill(ctx, s, alpha);
      ctx.beginPath();
      ctx.arc(0, 0, TERRITORY_OUT, a0, a1);
      ctx.arc(0, 0, TERRITORY_IN, a1, a0, true);
      ctx.closePath();
      ctx.fill();

      if (slot.count < RIM_LABEL_MIN) continue;
      const color = SECTOR_COLOR[s];
      const name = SECTOR_SHORT[s].toUpperCase();
      const count = String(slot.count);
      const namePx = 13 * inv;
      const countPx = 11 * inv;
      const nameW = textWidth(ctx, nameFont(), name) * (13 / BASE_PX) * inv;
      const countW = textWidth(ctx, scoreFont(), count) * (11 / BASE_PX) * inv;
      const gap = 6 * inv;
      const total = nameW + gap + countW;
      const cx = Math.cos(slot.angle);
      const lx = cx * RIM_LABEL_R;
      const ly = Math.sin(slot.angle) * RIM_LABEL_R;
      const x0 = cx > 0.3 ? lx : cx < -0.3 ? lx - total : lx - total / 2;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.font = `600 ${namePx}px ${UI}`;
      ctx.fillStyle = withAlpha(color, (idle ? 0.5 : 0.55) + 0.45 * next);
      ctx.fillText(name, x0, ly);
      ctx.font = `500 ${countPx}px ${MONO}`;
      ctx.fillStyle = `rgb(233 236 244 / ${0.3 + 0.3 * next})`;
      ctx.fillText(count, x0 + nameW + gap, ly);
    }
  };

  const paintPre = (ctx: CanvasRenderingContext2D, scale: number) => {
    ctx.save();
    paintTerritories(ctx, scale);
    ctx.restore();

    if (idle) return;

    // Halos (membership recomputed every few frames; alpha eased every frame).
    const hc = haloCache.current;
    hc.frame += 1;
    if (hc.frame % HALO_EVERY === 1) hc.halos = computeRankedHalos(nodes);
    const halos = hc.halos;
    for (const h of halos) {
      const cur = haloAlpha.current.get(h.sector) ?? 0;
      haloAlpha.current.set(h.sector, reducedMotion ? 1 : Math.min(1, cur + 0.03));
    }
    for (const [s, a] of haloAlpha.current) {
      if (a > 0 && !halos.some((h) => h.sector === s)) haloAlpha.current.set(s, Math.max(0, a - 0.04));
    }
    for (const h of halos) {
      const a = haloAlpha.current.get(h.sector) ?? 0;
      if (a <= 0) continue;
      const color = SECTOR_COLOR[h.sector];
      drawGlow(ctx, h.cx, h.cy, h.r * 1.15, color, 0.22 * a);
      ctx.strokeStyle = withAlpha(color, 0.4 * a);
      ctx.lineWidth = 1 / scale;
      ctx.setLineDash([4 / scale, 6 / scale]);
      ctx.beginPath();
      ctx.arc(h.cx, h.cy, h.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = `600 ${13 / scale}px ${UI}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillStyle = withAlpha(color, 0.95 * a);
      ctx.fillText(`${SECTOR_SHORT[h.sector]} · ${h.count} investors`, h.cx, h.cy - h.r - 8 / scale);
    }

    // Connectors to the founder for the top 10, fading with rank.
    for (const n of topNodes) {
      if (n.x === undefined || n.y === undefined) continue;
      const sel = n.id === selectedId;
      const alpha = sel ? 0.9 : n.rank < NAMED_N ? 0.42 - n.rank * 0.05 : 0.12;
      ctx.strokeStyle = withAlpha(sel ? ACCENT : SECTOR_COLOR[n.sector], alpha);
      ctx.lineWidth = (sel ? 1.6 : 0.9) / scale;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(n.x, n.y);
      ctx.stroke();
    }

    // Evidence edges (F7): a lighter static preview on hover, full staggered draw-on on select.
    const hid = hovered.current;
    if (hid && hid !== selectedId) {
      const n = byId.get(hid);
      const m = matchById.get(hid);
      if (n && m && n.x !== undefined && n.y !== undefined) {
        ctx.strokeStyle = withAlpha(ACCENT, 0.35);
        ctx.lineWidth = 0.9 / scale;
        ctx.setLineDash([3 / scale, 4 / scale]);
        for (const sat of satellitesFor(n, m)) {
          ctx.beginPath();
          ctx.moveTo(n.x, n.y);
          ctx.lineTo(sat.x, sat.y);
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }
    }
    if (selectedId) {
      const n = byId.get(selectedId);
      const m = matchById.get(selectedId);
      if (n && m && n.x !== undefined && n.y !== undefined) {
        const since = performance.now() - selectedAt.current;
        const sats = satellitesFor(n, m);
        for (let i = 0; i < sats.length; i++) {
          const sat = sats[i];
          const progress = reducedMotion ? 1 : easeOutCubic((since - i * EDGE_STAGGER_MS) / EDGE_MS);
          if (progress <= 0) continue;
          const tx = n.x + (sat.x - n.x) * progress;
          const ty = n.y + (sat.y - n.y) * progress;
          ctx.strokeStyle = withAlpha(ACCENT, 0.8);
          ctx.lineWidth = 1.2 / scale;
          ctx.beginPath();
          ctx.moveTo(n.x, n.y);
          ctx.lineTo(tx, ty);
          ctx.stroke();
          if (progress < 1) drawGlow(ctx, tx, ty, 10 / scale, ACCENT, 0.9);
        }
      }
    }
  };

  const paintNode = (node: NodeObject<GraphNode>, ctx: CanvasRenderingContext2D, scale: number) => {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    if (node.kind === "founder") {
      drawGlow(ctx, x, y, 74, "#FFE6C8", 0.5);
      ctx.fillStyle = "#FFF6EA";
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.fill();
      if (idle) return;
      ctx.font = `600 ${13 / scale}px ${UI}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = "rgb(255 246 234 / 0.85)";
      ctx.fillText(node.name, x, y + 16 / scale + 6);
      return;
    }
    const color = SECTOR_COLOR[node.sector];
    const top = !idle && node.rank < TOP_N;
    const selected = node.id === selectedId;
    const hover = node.id === hovered.current;
    const dimmed = selectedId !== undefined && !selected && !top;
    const core = top ? 4.8 : 2.8;
    drawGlow(ctx, x, y, top ? 22 : 9, color, top ? 0.6 : dimmed ? 0.14 : 0.3);
    ctx.fillStyle = top || hover ? color : withAlpha(color, idle ? 0.62 : dimmed ? 0.45 : 0.8);
    ctx.beginPath();
    ctx.arc(x, y, core, 0, Math.PI * 2);
    ctx.fill();
    if (top) {
      ctx.fillStyle = "rgb(255 255 255 / 0.9)";
      ctx.beginPath();
      ctx.arc(x, y, core * 0.42, 0, Math.PI * 2);
      ctx.fill();
    }
    if (selected) {
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 1.5 / scale;
      ctx.beginPath();
      ctx.arc(x, y, core + 5 / scale, 0, Math.PI * 2);
      ctx.stroke();
    }
  };

  // Greedy label placement for the named few: selected first, then the top NAMED_N;
  // 8 directions on three rings. Name + score, or a compact "#rank" badge when nothing fits.
  const placeLabels = (ctx: CanvasRenderingContext2D, scale: number): Label[] => {
    const labels = labelBuf.current;
    labels.length = 0;
    const obs = obstacles.current;
    obs.length = 0;
    const inv = 1 / scale;
    const lineH = 18 * inv;
    const padX = 7 * inv;
    const gap = 7 * inv;
    const dotR = 7 * inv;

    const founderW = textWidth(ctx, nameFont(), founder.name) * (13 / BASE_PX) * inv;
    obs.push({ x: -Math.max(founderW / 2, 12) - 4 * inv, y: -12 * inv, w: Math.max(founderW, 24) + 8 * inv, h: 12 * inv + 16 * inv + 6 + lineH });
    for (const n of topNodes) {
      if (n.x === undefined || n.y === undefined) continue;
      obs.push({ x: n.x - dotR, y: n.y - dotR, w: dotR * 2, h: dotR * 2 });
    }
    if (selectedId) {
      const n = byId.get(selectedId);
      if (n && n.x !== undefined && n.y !== undefined) {
        for (const sat of satellitesFor(n, matchById.get(selectedId))) obs.push(satelliteBox(ctx, sat, n.x, inv).rect);
      }
    }
    for (const h of haloCache.current.halos) {
      if ((haloAlpha.current.get(h.sector) ?? 0) <= 0) continue;
      const w = textWidth(ctx, nameFont(), `${SECTOR_SHORT[h.sector]} · ${h.count} investors`) * (13 / BASE_PX) * inv;
      obs.push({ x: h.cx - w / 2, y: h.cy - h.r - 8 * inv - lineH, w, h: lineH });
    }

    const tryPlace = (n: GraphNode, w: number, h: number): { rect: Rect; ax: number; ay: number; leader: boolean } | null => {
      for (let ri = 0; ri < RINGS.length; ri++) {
        const d = RINGS[ri] * inv;
        for (let di = 0; di < DIRS.length; di++) {
          const a = DIRS[di];
          const ax = n.x! + Math.cos(a) * d;
          const ay = n.y! + Math.sin(a) * d;
          const cx = Math.cos(a);
          const rx = cx > 0.1 ? ax : cx < -0.1 ? ax - w : ax - w / 2;
          const sy = Math.sin(a);
          const ry = Math.abs(cx) > 0.1 ? ay - h / 2 : sy < 0 ? ay - h : ay;
          const rect = { x: rx, y: ry, w, h };
          let free = true;
          for (const o of obs) {
            if (overlaps(rect, o, 2 * inv)) {
              free = false;
              break;
            }
          }
          if (free) return { rect, ax, ay, leader: ri > 0 };
        }
      }
      return null;
    };

    const named = topNodes.slice(0, NAMED_N);
    const sel = selectedId ? byId.get(selectedId) : undefined;
    const order = sel && sel.kind === "investor" ? [sel, ...named.filter((n) => n.id !== sel.id)] : named;
    for (const n of order) {
      if (n.x === undefined || n.y === undefined) continue;
      const selected = n.id === selectedId;
      const name = displayName(n.name);
      const score = String(Math.round(n.score));
      const nameW = textWidth(ctx, nameFont(), name) * (13 / BASE_PX) * inv;
      const scoreW = textWidth(ctx, scoreFont(), score) * inv;
      const h = lineH;
      const fullW = nameW + gap + scoreW + padX * 2;
      const base = { n, name, score, nameW, scoreW, compact: false };
      let placed: Label | null = null;
      const full = tryPlace(n, fullW, h);
      if (full) placed = { ...base, ...full };
      else if (selected) {
        const ax = n.x + RINGS[0] * inv;
        placed = { ...base, rect: { x: ax, y: n.y - h / 2, w: fullW, h }, ax, ay: n.y, leader: false };
      } else {
        const badge = `#${n.rank + 1}`;
        const badgeW = textWidth(ctx, scoreFont(), badge) * (10 / BASE_PX) * inv + padX * 2;
        const badgeH = 13 * inv;
        const spot = tryPlace(n, badgeW, badgeH) ?? { rect: { x: n.x + dotR + 2 * inv, y: n.y - badgeH / 2, w: badgeW, h: badgeH }, ax: n.x, ay: n.y, leader: false };
        placed = { ...base, score: badge, compact: true, ...spot };
      }
      labels.push(placed);
      obs.push(placed.rect);
    }
    return labels;
  };

  const paintPost = (ctx: CanvasRenderingContext2D, scale: number) => {
    const inv = 1 / scale;
    const fontPx = 13 * inv;
    const lineH = 18 * inv;
    const padX = 7 * inv;
    const gap = 7 * inv;

    if (!idle) {
      const labels = placeLabels(ctx, scale);
      const dim = selectedId ? 0.3 : 1;
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      for (const l of labels) {
        const selected = l.n.id === selectedId;
        const rank = l.n.rank;
        const a = selected ? 1 : dim;
        const color = SECTOR_COLOR[l.n.sector];
        if (l.leader) {
          const r = l.rect;
          const ex = Math.max(r.x, Math.min(r.x + r.w, l.n.x!));
          const ey = Math.max(r.y, Math.min(r.y + r.h, l.n.y!));
          ctx.strokeStyle = withAlpha(selected ? ACCENT : color, 0.5 * a);
          ctx.lineWidth = 0.8 * inv;
          ctx.beginPath();
          ctx.moveTo(l.n.x!, l.n.y!);
          ctx.lineTo(ex, ey);
          ctx.stroke();
        }
        const cy = l.rect.y + l.rect.h / 2;
        if (l.compact) {
          pill(ctx, l.rect.x, l.rect.y, l.rect.w, l.rect.h, 0.82 * a);
          ctx.font = `500 ${10 * inv}px ${MONO}`;
          ctx.fillStyle = rank < 3 ? withAlpha(ACCENT, a) : `rgb(255 255 255 / ${0.7 * a})`;
          ctx.fillText(l.score, l.rect.x + padX, cy);
          continue;
        }
        pill(ctx, l.rect.x, l.rect.y, l.rect.w, l.rect.h, 0.84 * a);
        if (selected) {
          ctx.strokeStyle = withAlpha(ACCENT, 0.7);
          ctx.lineWidth = 1 * inv;
          ctx.beginPath();
          ctx.roundRect(l.rect.x, l.rect.y, l.rect.w, l.rect.h, l.rect.h / 2);
          ctx.stroke();
        }
        ctx.font = `600 ${fontPx}px ${UI}`;
        ctx.fillStyle = selected ? ACCENT : `rgb(255 255 255 / ${(rank < 3 ? 0.96 : 0.82) * a})`;
        ctx.fillText(l.name, l.rect.x + padX, cy);
        ctx.font = `500 ${12 * inv}px ${MONO}`;
        ctx.fillStyle = selected || rank < 3 ? withAlpha(ACCENT, a) : `rgb(255 255 255 / ${0.55 * a})`;
        ctx.fillText(l.score, l.rect.x + padX + l.nameW + gap, cy);
      }
    }

    // Hover label for anything without a full placed label.
    const hid = hovered.current;
    if (hid && (idle || !labelBuf.current.some((l) => l.n.id === hid && !l.compact))) {
      const n = byId.get(hid);
      if (n && n.x !== undefined && n.y !== undefined) {
        const text = idle ? `${displayName(n.name)}  ·  ${SECTOR_SHORT[n.sector]}` : `${displayName(n.name)}  ·  ${SECTOR_SHORT[n.sector]}  ·  ${Math.round(n.score)}`;
        ctx.font = `500 ${fontPx}px ${UI}`;
        const w = ctx.measureText(text).width;
        pill(ctx, n.x + 4 * inv, n.y - lineH / 2, w + 10 * inv, lineH, 0.85);
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "rgb(255 255 255 / 0.85)";
        ctx.fillText(text, n.x + 9 * inv, n.y);
      }
    }

    // Evidence satellites: company name, round and year. Hover preview is static and faint;
    // the selected investor's land as each edge finishes drawing.
    const drawSatellites = (n: GraphNode, m: Match, progressAt: (i: number) => number, strength: number) => {
      const sats = satellitesFor(n, m);
      for (let i = 0; i < sats.length; i++) {
        const sat = sats[i];
        const progress = progressAt(i) * strength;
        if (progress <= 0) continue;
        ctx.fillStyle = withAlpha(ACCENT, progress);
        ctx.beginPath();
        ctx.arc(sat.x, sat.y, 3.2, 0, Math.PI * 2);
        ctx.fill();
        const { right, line2, dx, rect } = satelliteBox(ctx, sat, n.x!, inv);
        pill(ctx, rect.x, rect.y, rect.w, rect.h, 0.85 * progress);
        ctx.textAlign = right ? "left" : "right";
        ctx.textBaseline = "middle";
        ctx.font = `600 ${11 * inv}px ${UI}`;
        ctx.fillStyle = `rgb(255 255 255 / ${0.95 * progress})`;
        ctx.fillText(sat.deal.company, sat.x + dx, sat.y - 6 * inv);
        ctx.font = `500 ${10 * inv}px ${MONO}`;
        ctx.fillStyle = withAlpha(ACCENT, 0.95 * progress);
        ctx.fillText(line2, sat.x + dx, sat.y + 7 * inv);
      }
    };
    if (hid && hid !== selectedId) {
      const n = byId.get(hid);
      const m = matchById.get(hid);
      if (n && m && n.x !== undefined && n.y !== undefined) drawSatellites(n, m, () => 1, 0.55);
    }
    if (selectedId) {
      const n = byId.get(selectedId);
      const m = matchById.get(selectedId);
      if (n && m && n.x !== undefined && n.y !== undefined) {
        const since = performance.now() - selectedAt.current;
        drawSatellites(n, m, (i) => (reducedMotion ? 1 : easeOutCubic((since - i * EDGE_STAGGER_MS - EDGE_MS * 0.55) / 380)), 1);
      }
    }
  };

  return (
    <ForceGraph2D
      ref={fg}
      width={width}
      height={height}
      graphData={graphData}
      backgroundColor="rgba(0,0,0,0)"
      nodeId="id"
      nodeCanvasObjectMode={() => "replace"}
      nodeCanvasObject={paintNode}
      nodePointerAreaPaint={(node, color, ctx) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(node.x ?? 0, node.y ?? 0, node.kind === "founder" ? 14 : 11, 0, Math.PI * 2);
        ctx.fill();
      }}
      nodeLabel={() => ""}
      onRenderFramePre={paintPre}
      onRenderFramePost={paintPost}
      onNodeClick={(node) => {
        if (node.kind === "founder") return onSelect(undefined);
        onSelect(node.id === selectedId ? undefined : node.id);
      }}
      onBackgroundClick={() => onSelect(undefined)}
      onNodeHover={(node) => {
        hovered.current = node?.kind === "investor" ? node.id : undefined;
      }}
      enableNodeDrag={false}
      enableZoomInteraction={false}
      enablePanInteraction={false}
      autoPauseRedraw={false}
      d3AlphaDecay={0}
      d3VelocityDecay={0.4}
      d3AlphaMin={0}
      cooldownTicks={Infinity}
      cooldownTime={Infinity}
      onEngineTick={heatTick}
      warmupTicks={reducedMotion ? 0 : 40}
    />
  );
}
