"use client";

import { forceCollide, forceManyBody } from "d3-force";
import { useEffect, useMemo, useRef } from "react";
import ForceGraph2D, { type ForceGraphMethods, type NodeObject } from "react-force-graph-2d";
import { forceAngularTarget, forceRadialTarget, HALO_RADIUS, initialPosition, R_MAX, radialTarget, sectorAngle } from "@/lib/physics";
import {
  applyFounderMatches,
  computeSectorHalos,
  computeStageArcs,
  INVESTOR_CENTER_ID,
  makeOrbitNodes,
  ORBIT_TOP_N,
  type GroupHalo,
  type OrbitNode,
  type StageArc,
} from "@/lib/orbit";
import { SECTOR_COLOR, SECTOR_SHORT, SECTORS } from "@/lib/taxonomy";
import type { FounderOrbitProps } from "./FounderOrbit";
import { monoFont, uiFont } from "./canvasFont";
import { useSimHeat } from "./simHeat";

const ACCENT = "#FF6A3D";
const LIVE_LABEL = "Live pitch";
const SWEEP_MS = 700;
const HALO_EVERY = 4;
const HALO_IN = 1 / 42;
const HALO_OUT = 1 / 24;
const BASE_PX = 12;

// Eight directions, near ring first then far ring (far placements get a leader line).
const DIRS = [0, Math.PI, -Math.PI / 4, Math.PI / 4, (-3 * Math.PI) / 4, (3 * Math.PI) / 4, -Math.PI / 2, Math.PI / 2];
const RINGS = [10, 30, 54];

type Props = FounderOrbitProps & { width: number; height: number; reducedMotion: boolean };

type Rect = { x: number; y: number; w: number; h: number };
type Label = { n: OrbitNode; name: string; score: string; sector: string; nameW: number; scoreW: number; rect: Rect; leader: boolean; compact: boolean };
type HaloGeom = { kind: "sector"; h: GroupHalo } | { kind: "stage"; arc: StageArc };
type HaloState = { alpha: number; active: boolean; geom: HaloGeom };
type Sweep = { start: number; from: Map<string, { r: number; a: number; r1: number; a1: number }> };

function withAlpha(color: string, alpha: number): string {
  if (color.startsWith("hsl(")) return color.replace(")", ` / ${alpha})`);
  if (color.startsWith("#") && color.length === 7) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return `rgb(${r} ${g} ${b} / ${alpha})`;
  }
  return color;
}

function easeOutCubic(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - c, 3);
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function overlaps(a: Rect, b: Rect, pad: number): boolean {
  return a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
}

const nameFont = () => `600 ${BASE_PX}px ${uiFont()}`;
const scoreFont = () => `500 ${BASE_PX}px ${monoFont()}`;
const sectorFont = () => `500 ${BASE_PX}px ${uiFont()}`;
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

// Where the sweep lands each founder: its force targets, fanned out around a shared angle
// so a group arrives as a cluster rather than a line that collide then has to pry apart.
function sweepTargets(nodes: OrbitNode[], spread: boolean): Map<string, { r1: number; a1: number }> {
  const out = new Map<string, { r1: number; a1: number }>();
  const groups = new Map<number, OrbitNode[]>();
  for (const n of nodes) {
    if (n.kind !== "investor") continue;
    const key = spread ? Math.round(n.targetA * 1000) : NaN;
    if (Number.isNaN(key)) {
      out.set(n.id, { r1: n.targetR, a1: n.targetA });
      continue;
    }
    groups.set(key, [...(groups.get(key) ?? []), n]);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => a.rank - b.rank);
    list.forEach((n, i) => {
      const slot = i === 0 ? 0 : Math.ceil(i / 2) * (i % 2 === 1 ? 1 : -1);
      const step = 34 / Math.max(n.targetR, 60);
      out.set(n.id, { r1: n.targetR, a1: n.targetA + slot * step });
    });
  }
  return out;
}

export default function FounderOrbitCanvas({ investor, founders, matches, groupBy, liveId, selectedId, onSelect, width, height, reducedMotion }: Props) {
  const fg = useRef<ForceGraphMethods<NodeObject<OrbitNode>> | undefined>(undefined);
  const hovered = useRef<string | undefined>(undefined);
  const halos = useRef(new Map<string, HaloState>());
  const haloFrame = useRef(0);
  const ringAlpha = useRef(1);
  const forcesReady = useRef(false);
  const ringR = useRef(R_MAX);
  const sweep = useRef<Sweep | null>(null);
  const prevGroupBy = useRef(groupBy);
  const labelBuf = useRef<Label[]>([]);
  const obstacles = useRef<Rect[]>([]);
  const { heat: heatRef, reheat, tick: heatTick, scaled } = useSimHeat(reducedMotion);
  const UI = uiFont();
  const MONO = monoFont();

  // Nodes are rebuilt only when the founder set changes; the live profile rewrites every
  // few seconds and only updates fields in place, so d3 keeps positions and velocities.
  const founderKey = founders.map((f) => f.id).join("|");
  const nodes = useMemo<OrbitNode[]>(() => {
    const list = makeOrbitNodes(investor.name, founders, liveId);
    for (const n of list) {
      if (n.kind !== "investor") continue;
      const p = initialPosition(n);
      n.x = p.x;
      n.y = p.y;
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [founderKey]);

  const graphData = useMemo(() => ({ nodes, links: [] }), [nodes]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const topIds = useMemo(() => {
    const ids = matches.slice(0, ORBIT_TOP_N).map((m) => m.founderId);
    if (matches.some((m) => m.founderId === liveId) && !ids.includes(liveId)) ids.push(liveId);
    return ids;
  }, [matches, liveId]);
  const topNodes = useMemo(() => topIds.map((id) => byId.get(id)).filter((n): n is OrbitNode => Boolean(n)), [topIds, byId]);

  useEffect(() => {
    const centre = byId.get(INVESTOR_CENTER_ID);
    if (centre) centre.name = investor.name;
    for (const f of founders) {
      const n = byId.get(f.id);
      if (!n) continue;
      const fresh = makeOrbitNodes(investor.name, [f], liveId)[1];
      n.name = f.id === liveId ? (f.company ?? LIVE_LABEL) : fresh.name;
      n.sector = fresh.sector;
      n.sectors = fresh.sectors;
      n.stage = fresh.stage;
    }
  }, [investor.name, founders, liveId, byId]);

  useEffect(() => {
    const g = fg.current;
    if (!g || forcesReady.current) return;
    forcesReady.current = true;
    g.d3Force("link", null);
    g.d3Force("center", null);
    g.d3Force("charge", scaled(forceManyBody().strength(-10).distanceMax(90)));
    g.d3Force("collide", forceCollide<NodeObject<OrbitNode>>().radius((n) => (n.kind === "founder" ? 50 : n.rank < ORBIT_TOP_N || n.live ? 30 : 13)).strength(0.9));
    g.d3Force("radial", scaled(forceRadialTarget()));
    g.d3Force("angular", scaled(forceAngularTarget(0.045)));
  });

  const fitRadius = useMemo(() => {
    const scores = matches.map((m) => m.score);
    const lowest = scores.length ? Math.min(...scores) : 0;
    return Math.max(HALO_RADIUS * 1.6, radialTarget(lowest));
  }, [matches]);

  // A group-by change sweeps every founder along an arc to its new target over SWEEP_MS
  // (cubic-out), with the forces frozen; a score change just retargets and reheats.
  useEffect(() => {
    const regroup = prevGroupBy.current !== groupBy;
    prevGroupBy.current = groupBy;
    if (regroup && !reducedMotion) {
      applyFounderMatches(byId, matches, groupBy, false);
      const targets = sweepTargets(nodes, groupBy !== "none");
      const from = new Map<string, { r: number; a: number; r1: number; a1: number }>();
      for (const n of nodes) {
        const t = targets.get(n.id);
        if (!t || n.x === undefined || n.y === undefined) continue;
        from.set(n.id, { r: Math.hypot(n.x, n.y), a: Math.atan2(n.y, n.x), ...t });
      }
      sweep.current = { start: performance.now(), from };
      heatRef.current = 0;
      return;
    }
    applyFounderMatches(byId, matches, groupBy, reducedMotion);
    reheat();
  }, [matches, byId, nodes, groupBy, reducedMotion, reheat, heatRef]);

  const onTick = () => {
    const s = sweep.current;
    if (!s) return heatTick();
    const t = (performance.now() - s.start) / SWEEP_MS;
    const e = easeOutCubic(t);
    for (const [id, f] of s.from) {
      const n = byId.get(id);
      if (!n) continue;
      const r = f.r + (f.r1 - f.r) * e;
      const a = f.a + wrapAngle(f.a1 - f.a) * e;
      n.x = Math.cos(a) * r;
      n.y = Math.sin(a) * r;
      n.vx = 0;
      n.vy = 0;
    }
    if (t >= 1) {
      sweep.current = null;
      reheat();
    }
  };

  useEffect(() => {
    const g = fg.current;
    if (!g) return;
    ringR.current = fitRadius + 44;
    const k = Math.min(width, height) / (2 * (fitRadius + 70));
    const ms = reducedMotion ? 0 : 600;
    g.zoom(k, ms);
    g.centerAt(0, 0, ms);
  }, [width, height, fitRadius, reducedMotion]);

  // Halo membership is recomputed every few frames for the active grouping; every halo
  // keeps its last geometry while its alpha eases, so a regroup cross-fades.
  const stepHalos = () => {
    haloFrame.current += 1;
    const map = halos.current;
    if (haloFrame.current % HALO_EVERY === 1) {
      for (const st of map.values()) st.active = false;
      const put = (key: string, geom: HaloGeom) => {
        const st = map.get(key);
        if (st) {
          st.geom = geom;
          st.active = true;
        } else map.set(key, { alpha: 0, active: true, geom });
      };
      if (groupBy === "stage") for (const arc of computeStageArcs(nodes)) put(`stage:${arc.stage}`, { kind: "stage", arc });
      else for (const h of computeSectorHalos(nodes, groupBy)) put(`sector:${h.sector}`, { kind: "sector", h });
    }
    const inStep = reducedMotion ? 1 : HALO_IN;
    const outStep = reducedMotion ? 1 : HALO_OUT;
    for (const [key, st] of map) {
      st.alpha = st.active ? Math.min(1, st.alpha + inStep) : Math.max(0, st.alpha - outStep);
      if (!st.active && st.alpha <= 0) map.delete(key);
    }
  };

  const paintPre = (ctx: CanvasRenderingContext2D, scale: number) => {
    const rr = ringR.current;
    const ringTarget = groupBy === "none" && width >= 560 ? 1 : 0;
    ringAlpha.current = reducedMotion ? ringTarget : ringAlpha.current + (ringTarget - ringAlpha.current) * 0.08;
    ctx.save();
    ctx.font = `500 ${11 / scale}px ${UI}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (ringAlpha.current > 0.01) {
      const present = new Set(nodes.filter((n) => n.kind === "investor").map((n) => n.sector));
      for (const s of SECTORS) {
        if (!present.has(s)) continue;
        const a = sectorAngle(s);
        ctx.fillStyle = withAlpha(SECTOR_COLOR[s], 0.42 * ringAlpha.current);
        ctx.fillText(SECTOR_SHORT[s].toUpperCase(), Math.cos(a) * rr, Math.sin(a) * rr);
      }
    }
    ctx.strokeStyle = "rgb(255 255 255 / 0.045)";
    ctx.lineWidth = 1 / scale;
    for (const r of [HALO_RADIUS, rr - 22]) {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    stepHalos();
    for (const st of halos.current.values()) {
      const a = st.alpha;
      if (a <= 0) continue;
      if (st.geom.kind === "stage") {
        const arc = st.geom.arc;
        const inner = HALO_RADIUS * 0.45;
        const outer = rr - 30;
        const half = Math.min(arc.halfWidth * 0.86, Math.PI / 3);
        const a0 = arc.angle - half;
        const a1 = arc.angle + half;
        const grad = ctx.createRadialGradient(0, 0, inner, 0, 0, outer);
        grad.addColorStop(0, `rgb(255 255 255 / ${0.07 * a})`);
        grad.addColorStop(1, `rgb(255 255 255 / ${0.012 * a})`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(0, 0, outer, a0, a1);
        ctx.arc(0, 0, inner, a1, a0, true);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = `rgb(255 255 255 / ${0.14 * a})`;
        ctx.lineWidth = 1 / scale;
        ctx.setLineDash([4 / scale, 6 / scale]);
        ctx.beginPath();
        ctx.arc(0, 0, outer, a0, a1);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = `600 ${12 / scale}px ${UI}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = `rgb(255 255 255 / ${0.8 * a})`;
        const lx = Math.cos(arc.angle) * (outer + 18 / scale);
        const ly = Math.sin(arc.angle) * (outer + 18 / scale);
        ctx.fillText(arc.label, lx, ly - 7 / scale);
        ctx.font = `500 ${11 / scale}px ${MONO}`;
        ctx.fillStyle = `rgb(255 255 255 / ${0.45 * a})`;
        ctx.fillText(`${arc.count} founders`, lx, ly + 8 / scale);
        continue;
      }
      const h = st.geom.h;
      const color = SECTOR_COLOR[h.sector];
      const grad = ctx.createRadialGradient(h.cx, h.cy, h.r * 0.2, h.cx, h.cy, h.r);
      grad.addColorStop(0, withAlpha(color, 0.16 * a));
      grad.addColorStop(1, withAlpha(color, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(h.cx, h.cy, h.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = withAlpha(color, 0.35 * a);
      ctx.lineWidth = 1 / scale;
      ctx.setLineDash([4 / scale, 6 / scale]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = `600 ${12 / scale}px ${UI}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillStyle = withAlpha(color, 0.95 * a);
      ctx.fillText(h.label, h.cx, h.cy - h.r - 6 / scale);
    }

    for (const n of topNodes) {
      if (n.x === undefined || n.y === undefined) continue;
      const alpha = 0.08 + 0.45 * (n.score / 100);
      const live = n.live || n.id === selectedId;
      ctx.strokeStyle = withAlpha(live ? ACCENT : SECTOR_COLOR[n.sector], live ? Math.max(alpha, 0.5) : alpha);
      ctx.lineWidth = (live ? 1.6 : 0.9) / scale;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(n.x, n.y);
      ctx.stroke();
    }
  };

  const paintNode = (node: NodeObject<OrbitNode>, ctx: CanvasRenderingContext2D, scale: number) => {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    if (node.kind === "founder") {
      const glow = ctx.createRadialGradient(x, y, 0, x, y, 78);
      glow.addColorStop(0, "rgb(255 241 224 / 0.55)");
      glow.addColorStop(0.35, "rgb(255 214 170 / 0.16)");
      glow.addColorStop(1, "rgb(255 200 150 / 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, 78, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#FFF6EA";
      ctx.beginPath();
      ctx.arc(x, y, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgb(255 246 234 / 0.35)";
      ctx.lineWidth = 1 / scale;
      ctx.beginPath();
      ctx.arc(x, y, 10 + 6 / scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.font = `600 ${12 / scale}px ${UI}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = "rgb(255 246 234 / 0.9)";
      ctx.fillText(node.name, x, y + 18 / scale + 6);
      ctx.font = `500 ${10 / scale}px ${UI}`;
      ctx.fillStyle = "rgb(255 246 234 / 0.5)";
      ctx.fillText("you", x, y + 33 / scale + 6);
      return;
    }
    const color = node.live ? ACCENT : SECTOR_COLOR[node.sector];
    const top = node.rank < ORBIT_TOP_N || node.live;
    const selected = node.id === selectedId;
    const hover = node.id === hovered.current;
    const core = node.live ? 5.4 : top ? 4.6 : 2.6;
    const glowR = node.live ? 26 : top ? 20 : 8;
    const glow = ctx.createRadialGradient(x, y, 0, x, y, glowR);
    glow.addColorStop(0, withAlpha(color, top ? 0.55 : 0.28));
    glow.addColorStop(1, withAlpha(color, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, glowR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = top || hover ? color : withAlpha(color, 0.78);
    ctx.beginPath();
    ctx.arc(x, y, core, 0, Math.PI * 2);
    ctx.fill();
    if (top) {
      ctx.fillStyle = "rgb(255 255 255 / 0.9)";
      ctx.beginPath();
      ctx.arc(x, y, core * 0.42, 0, Math.PI * 2);
      ctx.fill();
    }
    if (selected || node.live) {
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = (selected ? 1.5 : 1) / scale;
      ctx.beginPath();
      ctx.arc(x, y, core + 5 / scale, 0, Math.PI * 2);
      ctx.stroke();
    }
  };

  // Greedy label placement, as in the founder graph: selected first, then by rank, eight
  // directions on three rings, avoiding the centre label, top dots and every halo label.
  const placeLabels = (ctx: CanvasRenderingContext2D, scale: number): Label[] => {
    const labels = labelBuf.current;
    labels.length = 0;
    const obs = obstacles.current;
    obs.length = 0;
    const inv = 1 / scale;
    const lineH = 16 * inv;
    const padX = 6 * inv;
    const gap = 6 * inv;
    const dotR = 8 * inv;
    const rr = ringR.current;

    const centreW = textWidth(ctx, nameFont(), investor.name) * inv;
    obs.push({ x: -Math.max(centreW / 2, 14) - 4 * inv, y: -14 * inv, w: Math.max(centreW, 28) + 8 * inv, h: 14 * inv + 18 * inv + 6 + lineH * 2 });
    for (const n of topNodes) {
      if (n.x === undefined || n.y === undefined) continue;
      obs.push({ x: n.x - dotR, y: n.y - dotR, w: dotR * 2, h: dotR * 2 });
    }
    for (const st of halos.current.values()) {
      if (st.alpha <= 0) continue;
      if (st.geom.kind === "sector") {
        const h = st.geom.h;
        const w = textWidth(ctx, nameFont(), h.label) * inv;
        obs.push({ x: h.cx - w / 2, y: h.cy - h.r - 6 * inv - lineH, w, h: lineH });
      } else {
        const arc = st.geom.arc;
        const outer = rr - 30;
        const lx = Math.cos(arc.angle) * (outer + 18 * inv);
        const ly = Math.sin(arc.angle) * (outer + 18 * inv);
        const w = Math.max(textWidth(ctx, nameFont(), arc.label), textWidth(ctx, scoreFont(), `${arc.count} founders`)) * inv;
        obs.push({ x: lx - w / 2, y: ly - 15 * inv, w, h: 30 * inv });
      }
    }

    const tryPlace = (n: OrbitNode, w: number, h: number): { rect: Rect; leader: boolean } | null => {
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
          if (free) return { rect, leader: ri > 0 };
        }
      }
      return null;
    };

    const order = selectedId && topIds.includes(selectedId) ? [byId.get(selectedId)!, ...topNodes.filter((n) => n.id !== selectedId)] : topNodes;
    for (const n of order) {
      if (n.x === undefined || n.y === undefined) continue;
      const selected = n.id === selectedId;
      const name = n.name;
      const score = String(Math.round(n.score));
      const sector = SECTOR_SHORT[n.sector];
      const nameW = textWidth(ctx, nameFont(), name) * inv;
      const scoreW = textWidth(ctx, scoreFont(), score) * inv;
      const sectorW = textWidth(ctx, sectorFont(), sector) * (11 / BASE_PX) * inv;
      const fullW = nameW + gap + scoreW + gap + sectorW + padX * 2;
      const shortW = nameW + gap + scoreW + padX * 2;
      const base = { n, name, score, sector, nameW, scoreW, compact: false };
      let placed: Label | null = null;
      const full = tryPlace(n, fullW, lineH);
      if (full) placed = { ...base, ...full };
      else if (selected || n.live) {
        const ax = n.x + RINGS[0] * inv;
        placed = { ...base, rect: { x: ax, y: n.y - lineH / 2, w: fullW, h: lineH }, leader: false };
      } else {
        const short = tryPlace(n, shortW, lineH);
        if (short) placed = { ...base, sector: "", ...short };
        else {
          const badge = `#${n.rank + 1}`;
          const badgeW = textWidth(ctx, scoreFont(), badge) * (10 / BASE_PX) * inv + padX * 2;
          const badgeH = 13 * inv;
          const spot = tryPlace(n, badgeW, badgeH) ?? { rect: { x: n.x + dotR + 2 * inv, y: n.y - badgeH / 2, w: badgeW, h: badgeH }, leader: false };
          placed = { ...base, score: badge, sector: "", compact: true, ...spot };
        }
      }
      labels.push(placed);
      obs.push(placed.rect);
    }
    return labels;
  };

  const paintPost = (ctx: CanvasRenderingContext2D, scale: number) => {
    const inv = 1 / scale;
    const fontPx = 12 * inv;
    const lineH = 16 * inv;
    const padX = 6 * inv;
    const gap = 6 * inv;
    const labels = placeLabels(ctx, scale);
    const dim = selectedId ? 0.3 : 1;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    for (const l of labels) {
      const hot = l.n.id === selectedId || l.n.live;
      const rank = l.n.rank;
      const a = hot ? 1 : dim;
      const color = l.n.live ? ACCENT : SECTOR_COLOR[l.n.sector];
      if (l.leader) {
        const r = l.rect;
        const ex = Math.max(r.x, Math.min(r.x + r.w, l.n.x!));
        const ey = Math.max(r.y, Math.min(r.y + r.h, l.n.y!));
        ctx.strokeStyle = withAlpha(color, 0.5 * a);
        ctx.lineWidth = 0.8 * inv;
        ctx.beginPath();
        ctx.moveTo(l.n.x!, l.n.y!);
        ctx.lineTo(ex, ey);
        ctx.stroke();
      }
      const cy = l.rect.y + l.rect.h / 2;
      pill(ctx, l.rect.x, l.rect.y, l.rect.w, l.rect.h, 0.8 * a);
      if (l.compact) {
        ctx.font = `500 ${10 * inv}px ${MONO}`;
        ctx.fillStyle = hot ? ACCENT : rank < 3 ? withAlpha(ACCENT, a) : `rgb(255 255 255 / ${0.7 * a})`;
        ctx.fillText(l.score, l.rect.x + padX, cy);
        continue;
      }
      if (l.n.id === selectedId) {
        ctx.strokeStyle = withAlpha(ACCENT, 0.7);
        ctx.lineWidth = 1 * inv;
        ctx.beginPath();
        ctx.roundRect(l.rect.x, l.rect.y, l.rect.w, l.rect.h, l.rect.h / 2);
        ctx.stroke();
      }
      ctx.font = `600 ${fontPx}px ${UI}`;
      ctx.fillStyle = hot ? ACCENT : rank < 3 ? `rgb(255 255 255 / ${0.96 * a})` : `rgb(255 255 255 / ${0.8 * a})`;
      ctx.fillText(l.name, l.rect.x + padX, cy);
      ctx.font = `500 ${fontPx}px ${MONO}`;
      ctx.fillStyle = hot ? ACCENT : rank < 3 ? withAlpha(ACCENT, a) : `rgb(255 255 255 / ${0.55 * a})`;
      ctx.fillText(l.score, l.rect.x + padX + l.nameW + gap, cy);
      if (l.sector) {
        ctx.font = `500 ${11 * inv}px ${UI}`;
        ctx.fillStyle = withAlpha(color, 0.9 * a);
        ctx.fillText(l.sector, l.rect.x + padX + l.nameW + gap + l.scoreW + gap, cy);
      }
    }

    const hid = hovered.current;
    if (hid && (!topIds.includes(hid) || !labels.some((l) => l.n.id === hid && !l.compact))) {
      const n = byId.get(hid);
      if (n && n.x !== undefined && n.y !== undefined) {
        const text = `${n.name}  ·  ${SECTOR_SHORT[n.sector]}  ·  ${Math.round(n.score)}`;
        ctx.font = `500 ${fontPx}px ${UI}`;
        const w = ctx.measureText(text).width;
        pill(ctx, n.x + 4 * inv, n.y - lineH / 2, w + 10 * inv, lineH, 0.8);
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "rgb(255 255 255 / 0.85)";
        ctx.fillText(text, n.x + 9 * inv, n.y);
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
      onEngineTick={onTick}
      warmupTicks={reducedMotion ? 0 : 40}
    />
  );
}
