"use client";

import { forceCollide, forceManyBody } from "d3-force";
import { useEffect, useMemo, useRef } from "react";
import ForceGraph2D, { type ForceGraphMethods, type NodeObject } from "react-force-graph-2d";
import {
  angularTarget,
  computeHalos,
  dominantSector,
  forceAngularTarget,
  forceRadialTarget,
  HALO_RADIUS,
  initialPosition,
  R_MAX,
  radialTarget,
  sectorAngle,
  type GraphNode,
} from "@/lib/physics";
import { SECTOR_COLOR, SECTOR_SHORT, SECTORS, STAGE_LABELS, type Sector } from "@/lib/taxonomy";
import type { Deal, Match } from "@/lib/types";
import type { GraphProps } from "./Graph";

const ACCENT = "#FF6A3D";
const FOUNDER_ID = "__founder__";
const TOP_N = 10;
const UI_FONT = "Inter, system-ui, sans-serif";
const MONO_FONT = '"JetBrains Mono", ui-monospace, monospace';

type Props = GraphProps & { width: number; height: number; reducedMotion: boolean; padLeft: number };

type Satellite = { deal: Deal; x: number; y: number };

function withAlpha(color: string, alpha: number): string {
  if (color.startsWith("hsl(")) return color.replace("hsl(", "hsl(").replace(")", ` / ${alpha})`);
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

// Only targets change on a score update; d3 keeps positions and drifts them (spec 5.5).
function applyMatches(byId: Map<string, GraphNode>, matches: Match[], snap: boolean) {
  matches.forEach((m, i) => {
    const n = byId.get(m.investorId);
    if (!n) return;
    n.score = m.score;
    n.rank = i;
    n.targetR = radialTarget(m.score);
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

export default function GraphCanvas({ investors, matches, selectedId, onSelect, center, width, height, reducedMotion, padLeft }: Props) {
  const fg = useRef<ForceGraphMethods<NodeObject<GraphNode>> | undefined>(undefined);
  const hovered = useRef<string | undefined>(undefined);
  const haloAlpha = useRef(new Map<Sector, number>());
  const selectedAt = useRef(0);
  const forcesReady = useRef(false);
  const ringR = useRef(R_MAX);

  // Nodes are created once per investor set and then mutated in place so d3 keeps
  // positions and velocities across score updates.
  const nodes = useMemo<GraphNode[]>(() => {
    const founder: GraphNode = {
      id: FOUNDER_ID,
      kind: "founder",
      name: center?.label ?? "You",
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
    const list = investors.map<GraphNode>((inv) => {
      const n: GraphNode = {
        id: inv.id,
        kind: "investor",
        name: inv.name,
        sector: dominantSector(inv.revealed.S),
        score: 50,
        rank: Infinity,
        targetR: radialTarget(50),
        targetA: angularTarget(inv.revealed.S),
      };
      const p = initialPosition(n);
      n.x = p.x;
      n.y = p.y;
      return n;
    });
    return [founder, ...list];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [investors]);

  const graphData = useMemo(() => ({ nodes, links: [] }), [nodes]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const matchById = useMemo(() => new Map(matches.map((m) => [m.investorId, m])), [matches]);
  const topIds = useMemo(() => matches.slice(0, TOP_N).map((m) => m.investorId), [matches]);

  useEffect(() => {
    const g = fg.current;
    if (!g || forcesReady.current) return;
    forcesReady.current = true;
    g.d3Force("link", null);
    g.d3Force("center", null);
    g.d3Force("charge", forceManyBody().strength(-9).distanceMax(90));
    g.d3Force("collide", forceCollide<NodeObject<GraphNode>>().radius((n) => (n.kind === "founder" ? 46 : n.rank < TOP_N ? 30 : 11)).strength(0.9));
    g.d3Force("radial", forceRadialTarget());
    g.d3Force("angular", forceAngularTarget());
  });

  const fitRadius = useMemo(() => {
    const scores = matches.map((m) => m.score);
    const lowest = scores.length ? Math.min(...scores) : 0;
    return Math.max(HALO_RADIUS * 1.6, radialTarget(lowest));
  }, [matches]);

  useEffect(() => {
    applyMatches(byId, matches, reducedMotion);
    fg.current?.d3ReheatSimulation();
  }, [matches, byId, reducedMotion]);

  // The cloud fills the canvas: zoom tracks the outermost investor, and the centre shifts
  // right when a panel covers the left edge.
  useEffect(() => {
    const g = fg.current;
    if (!g) return;
    ringR.current = fitRadius + 44;
    const k = Math.min(width - padLeft, height) / (2 * (fitRadius + 70));
    const ms = reducedMotion ? 0 : 600;
    g.zoom(k, ms);
    g.centerAt(-padLeft / (2 * k), 0, ms);
  }, [width, height, fitRadius, padLeft, reducedMotion]);

  useEffect(() => {
    selectedAt.current = performance.now();
  }, [selectedId]);

  const satellitesFor = (node: GraphNode, match: Match | undefined): Satellite[] => {
    if (!match || node.x === undefined || node.y === undefined) return [];
    const deals = match.evidence.slice(0, 3);
    const outward = Math.atan2(node.y, node.x);
    const spread = 0.8;
    const dist = 112;
    return deals.map((deal, i) => {
      const a = outward + (i - (deals.length - 1) / 2) * spread;
      return { deal, x: node.x! + Math.cos(a) * dist, y: node.y! + Math.sin(a) * dist };
    });
  };

  const paintPre = (ctx: CanvasRenderingContext2D, scale: number) => {
    // Sector ring: dim labels on the outer rim for every sector that has investors.
    const present = new Set(nodes.filter((n) => n.kind === "investor").map((n) => n.sector));
    ctx.save();
    ctx.font = `500 ${11 / scale}px ${UI_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const rr = ringR.current;
    for (const s of SECTORS) {
      if (!present.has(s)) continue;
      const a = sectorAngle(s);
      ctx.fillStyle = withAlpha(SECTOR_COLOR[s], 0.42);
      ctx.fillText(SECTOR_SHORT[s].toUpperCase(), Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.strokeStyle = "rgb(255 255 255 / 0.045)";
    ctx.lineWidth = 1 / scale;
    for (const r of [HALO_RADIUS, rr - 22]) {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    // Halos
    const halos = computeHalos(nodes);
    const seen = new Set<Sector>();
    for (const h of halos) {
      seen.add(h.sector);
      const cur = haloAlpha.current.get(h.sector) ?? 0;
      haloAlpha.current.set(h.sector, reducedMotion ? 1 : Math.min(1, cur + 0.03));
    }
    for (const [s, a] of haloAlpha.current) {
      if (!seen.has(s)) haloAlpha.current.set(s, Math.max(0, a - 0.04));
    }
    for (const h of halos) {
      const a = haloAlpha.current.get(h.sector) ?? 0;
      if (a <= 0) continue;
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
      ctx.font = `600 ${12 / scale}px ${UI_FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillStyle = withAlpha(color, 0.95 * a);
      ctx.fillText(`${SECTOR_SHORT[h.sector]} · ${h.count} investors`, h.cx, h.cy - h.r - 6 / scale);
    }

    // Connectors to the founder for the top 10.
    for (const id of topIds) {
      const n = byId.get(id);
      if (!n || n.x === undefined || n.y === undefined) continue;
      const alpha = 0.08 + 0.45 * (n.score / 100);
      ctx.strokeStyle = withAlpha(id === selectedId ? ACCENT : SECTOR_COLOR[n.sector], alpha);
      ctx.lineWidth = (id === selectedId ? 1.6 : 0.9) / scale;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(n.x, n.y);
      ctx.stroke();
    }

    // Evidence edges for the selected investor (F7).
    if (selectedId) {
      const n = byId.get(selectedId);
      const m = matchById.get(selectedId);
      if (n && m) {
        const progress = reducedMotion ? 1 : easeOutCubic((performance.now() - selectedAt.current) / 520);
        for (const sat of satellitesFor(n, m)) {
          ctx.strokeStyle = withAlpha(ACCENT, 0.8);
          ctx.lineWidth = 1.2 / scale;
          ctx.beginPath();
          ctx.moveTo(n.x!, n.y!);
          ctx.lineTo(n.x! + (sat.x - n.x!) * progress, n.y! + (sat.y - n.y!) * progress);
          ctx.stroke();
        }
      }
    }
  };

  const paintNode = (node: NodeObject<GraphNode>, ctx: CanvasRenderingContext2D, scale: number) => {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    if (node.kind === "founder") {
      const glow = ctx.createRadialGradient(x, y, 0, x, y, 70);
      glow.addColorStop(0, "rgb(255 241 224 / 0.55)");
      glow.addColorStop(0.35, "rgb(255 214 170 / 0.16)");
      glow.addColorStop(1, "rgb(255 200 150 / 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, 70, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#FFF6EA";
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = `600 ${12 / scale}px ${UI_FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = "rgb(255 246 234 / 0.85)";
      ctx.fillText(node.name, x, y + 16 / scale + 6);
      return;
    }
    const color = SECTOR_COLOR[node.sector];
    const top = node.rank < TOP_N;
    const selected = node.id === selectedId;
    const hover = node.id === hovered.current;
    const core = top ? 4.6 : 2.6;
    const glowR = top ? 20 : 8;
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
    if (selected) {
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 1.5 / scale;
      ctx.beginPath();
      ctx.arc(x, y, core + 5 / scale, 0, Math.PI * 2);
      ctx.stroke();
    }
  };

  const paintPost = (ctx: CanvasRenderingContext2D, scale: number) => {
    // Top-10 labels with greedy vertical de-overlap; the label block is name + score.
    type Label = { n: GraphNode; x: number; y: number; w: number; h: number; text: string; score: string };
    const labels: Label[] = [];
    const fontPx = 12 / scale;
    const lineH = 15 / scale;
    ctx.font = `600 ${fontPx}px ${UI_FONT}`;
    for (const id of topIds) {
      const n = byId.get(id);
      if (!n || n.x === undefined || n.y === undefined) continue;
      const text = n.name;
      const score = String(n.score);
      const w = ctx.measureText(text).width + ctx.measureText(score).width + 12 / scale;
      const right = n.x >= 0;
      labels.push({ n, x: n.x + (right ? 9 / scale : -9 / scale), y: n.y, w, h: lineH, text, score });
    }
    labels.sort((a, b) => a.y - b.y);
    for (let i = 0; i < labels.length; i++) {
      for (let j = 0; j < i; j++) {
        const a = labels[j];
        const b = labels[i];
        const ax0 = a.n.x! >= 0 ? a.x : a.x - a.w;
        const bx0 = b.n.x! >= 0 ? b.x : b.x - b.w;
        const overlapX = ax0 < bx0 + b.w && bx0 < ax0 + a.w;
        if (overlapX && Math.abs(a.y - b.y) < lineH) b.y = a.y + lineH;
      }
    }
    ctx.textBaseline = "middle";
    const dim = selectedId ? 0.22 : 1;
    for (const l of labels) {
      const right = l.n.x! >= 0;
      const selected = l.n.id === selectedId;
      const rank = l.n.rank;
      const a = selected ? 1 : dim;
      const nameColor = selected ? ACCENT : rank < 3 ? `rgb(255 255 255 / ${0.96 * a})` : `rgb(255 255 255 / ${0.8 * a})`;
      ctx.textAlign = right ? "left" : "right";
      ctx.font = `600 ${fontPx}px ${UI_FONT}`;
      const nameW = ctx.measureText(l.text).width;
      const padX = 5 / scale;
      const px0 = right ? l.x - padX : l.x - l.w - padX;
      pill(ctx, px0, l.y - lineH / 2, l.w + padX * 2, lineH, 0.78 * a);
      ctx.fillStyle = nameColor;
      ctx.fillText(l.text, l.x, l.y);
      ctx.font = `500 ${fontPx}px ${MONO_FONT}`;
      ctx.fillStyle = selected ? ACCENT : rank < 3 ? withAlpha(ACCENT, a) : `rgb(255 255 255 / ${0.55 * a})`;
      const sx = right ? l.x + nameW + 6 / scale : l.x - nameW - 6 / scale;
      ctx.fillText(l.score, sx, l.y);
    }

    // Hover label for anything outside the top 10.
    const hid = hovered.current;
    if (hid && !topIds.includes(hid)) {
      const n = byId.get(hid);
      if (n && n.x !== undefined && n.y !== undefined) {
        const text = `${n.name}  ·  ${SECTOR_SHORT[n.sector]}  ·  ${n.score}`;
        ctx.font = `500 ${fontPx}px ${UI_FONT}`;
        const w = ctx.measureText(text).width;
        pill(ctx, n.x + 4 / scale, n.y - lineH / 2, w + 10 / scale, lineH, 0.8);
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "rgb(255 255 255 / 0.85)";
        ctx.fillText(text, n.x + 9 / scale, n.y);
      }
    }

    // Evidence satellites: company name, round and year.
    if (selectedId) {
      const n = byId.get(selectedId);
      const m = matchById.get(selectedId);
      if (n && m) {
        const progress = reducedMotion ? 1 : easeOutCubic((performance.now() - selectedAt.current - 260) / 380);
        if (progress > 0) {
          for (const sat of satellitesFor(n, m)) {
            ctx.fillStyle = withAlpha(ACCENT, progress);
            ctx.beginPath();
            ctx.arc(sat.x, sat.y, 3.2, 0, Math.PI * 2);
            ctx.fill();
            const right = sat.x >= n.x!;
            const round = sat.deal.round === "unknown" ? "Round n/a" : STAGE_LABELS[sat.deal.round];
            const line2 = `${round} ${dealYear(sat.deal)}`.trim();
            ctx.font = `600 ${11 / scale}px ${UI_FONT}`;
            const w1 = ctx.measureText(sat.deal.company).width;
            ctx.font = `500 ${10 / scale}px ${MONO_FONT}`;
            const w2 = ctx.measureText(line2).width;
            const w = Math.max(w1, w2) + 12 / scale;
            const h = 30 / scale;
            const dx = right ? 7 / scale : -7 / scale;
            const px0 = right ? sat.x + dx - 6 / scale : sat.x + dx - w + 6 / scale;
            pill(ctx, px0, sat.y - h / 2, w, h, 0.85 * progress);
            ctx.textAlign = right ? "left" : "right";
            ctx.textBaseline = "middle";
            ctx.font = `600 ${11 / scale}px ${UI_FONT}`;
            ctx.fillStyle = `rgb(255 255 255 / ${0.95 * progress})`;
            ctx.fillText(sat.deal.company, sat.x + dx, sat.y - 6 / scale);
            ctx.font = `500 ${10 / scale}px ${MONO_FONT}`;
            ctx.fillStyle = withAlpha(ACCENT, 0.95 * progress);
            ctx.fillText(line2, sat.x + dx, sat.y + 7 / scale);
          }
        }
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
      warmupTicks={reducedMotion ? 0 : 40}
    />
  );
}
