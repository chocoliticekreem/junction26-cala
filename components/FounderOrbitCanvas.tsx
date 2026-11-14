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
  type OrbitNode,
} from "@/lib/orbit";
import { SECTOR_COLOR, SECTOR_SHORT, SECTORS } from "@/lib/taxonomy";
import type { FounderOrbitProps } from "./FounderOrbit";

const ACCENT = "#FF6A3D";
const UI_FONT = "Inter, system-ui, sans-serif";
const MONO_FONT = '"JetBrains Mono", ui-monospace, monospace';

type Props = FounderOrbitProps & { width: number; height: number; reducedMotion: boolean };

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

export default function FounderOrbitCanvas({ investor, founders, matches, groupBy, liveId, selectedId, onSelect, width, height, reducedMotion }: Props) {
  const fg = useRef<ForceGraphMethods<NodeObject<OrbitNode>> | undefined>(undefined);
  const hovered = useRef<string | undefined>(undefined);
  const haloAlpha = useRef(new Map<string, number>());
  const forcesReady = useRef(false);
  const ringR = useRef(R_MAX);

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
  }, [founders]);

  const graphData = useMemo(() => ({ nodes, links: [] }), [nodes]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const topIds = useMemo(() => {
    const ids = matches.slice(0, ORBIT_TOP_N).map((m) => m.founderId);
    if (matches.some((m) => m.founderId === liveId) && !ids.includes(liveId)) ids.push(liveId);
    return ids;
  }, [matches, liveId]);

  useEffect(() => {
    const centre = byId.get(INVESTOR_CENTER_ID);
    if (centre) centre.name = investor.name;
  }, [investor.name, byId]);

  useEffect(() => {
    const g = fg.current;
    if (!g || forcesReady.current) return;
    forcesReady.current = true;
    g.d3Force("link", null);
    g.d3Force("center", null);
    g.d3Force("charge", forceManyBody().strength(-10).distanceMax(90));
    g.d3Force("collide", forceCollide<NodeObject<OrbitNode>>().radius((n) => (n.kind === "founder" ? 50 : n.rank < ORBIT_TOP_N || n.live ? 30 : 13)).strength(0.9));
    g.d3Force("radial", forceRadialTarget());
    g.d3Force("angular", forceAngularTarget(0.045));
  });

  const fitRadius = useMemo(() => {
    const scores = matches.map((m) => m.score);
    const lowest = scores.length ? Math.min(...scores) : 0;
    return Math.max(HALO_RADIUS * 1.6, radialTarget(lowest));
  }, [matches]);

  useEffect(() => {
    applyFounderMatches(byId, matches, groupBy, reducedMotion);
    fg.current?.d3ReheatSimulation();
  }, [matches, byId, groupBy, reducedMotion]);

  useEffect(() => {
    const g = fg.current;
    if (!g) return;
    ringR.current = fitRadius + 44;
    const k = Math.min(width, height) / (2 * (fitRadius + 70));
    const ms = reducedMotion ? 0 : 600;
    g.zoom(k, ms);
    g.centerAt(0, 0, ms);
  }, [width, height, fitRadius, reducedMotion]);

  const paintPre = (ctx: CanvasRenderingContext2D, scale: number) => {
    const rr = ringR.current;
    ctx.save();
    ctx.font = `500 ${11 / scale}px ${UI_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (groupBy !== "stage" && width >= 560) {
      const present = new Set(nodes.filter((n) => n.kind === "investor").map((n) => n.sector));
      for (const s of SECTORS) {
        if (!present.has(s)) continue;
        const a = sectorAngle(s);
        ctx.fillStyle = withAlpha(SECTOR_COLOR[s], 0.42);
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

    const step = reducedMotion ? 1 : 0.035;
    const seen = new Set<string>();

    if (groupBy === "stage") {
      const arcs = computeStageArcs(nodes);
      for (const arc of arcs) {
        const key = `stage:${arc.stage}`;
        seen.add(key);
        const a = Math.min(1, (haloAlpha.current.get(key) ?? 0) + step);
        haloAlpha.current.set(key, a);
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
        ctx.font = `600 ${12 / scale}px ${UI_FONT}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = `rgb(255 255 255 / ${0.8 * a})`;
        const lx = Math.cos(arc.angle) * (outer + 18 / scale);
        const ly = Math.sin(arc.angle) * (outer + 18 / scale);
        ctx.fillText(arc.label, lx, ly - 7 / scale);
        ctx.font = `500 ${11 / scale}px ${MONO_FONT}`;
        ctx.fillStyle = `rgb(255 255 255 / ${0.45 * a})`;
        ctx.fillText(`${arc.count} founders`, lx, ly + 8 / scale);
      }
    } else {
      const halos = computeSectorHalos(nodes, groupBy);
      for (const h of halos) {
        const key = `sector:${h.sector}`;
        seen.add(key);
        haloAlpha.current.set(key, Math.min(1, (haloAlpha.current.get(key) ?? 0) + step));
      }
      for (const h of halos) {
        const a = haloAlpha.current.get(`sector:${h.sector}`) ?? 0;
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
        ctx.fillText(h.label, h.cx, h.cy - h.r - 6 / scale);
      }
    }
    for (const [k, a] of haloAlpha.current) {
      if (!seen.has(k)) haloAlpha.current.set(k, Math.max(0, a - 0.05));
    }

    for (const id of topIds) {
      const n = byId.get(id);
      if (!n || n.x === undefined || n.y === undefined) continue;
      const alpha = 0.08 + 0.45 * (n.score / 100);
      const live = n.live || id === selectedId;
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
      ctx.font = `600 ${12 / scale}px ${UI_FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = "rgb(255 246 234 / 0.9)";
      ctx.fillText(node.name, x, y + 18 / scale + 6);
      ctx.font = `500 ${10 / scale}px ${UI_FONT}`;
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

  const paintPost = (ctx: CanvasRenderingContext2D, scale: number) => {
    type Label = { n: OrbitNode; x: number; y: number; w: number; h: number; text: string; score: string };
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
    const dim = selectedId ? 0.3 : 1;
    for (const l of labels) {
      const right = l.n.x! >= 0;
      const hot = l.n.id === selectedId || l.n.live;
      const rank = l.n.rank;
      const a = hot ? 1 : dim;
      const nameColor = hot ? ACCENT : rank < 3 ? `rgb(255 255 255 / ${0.96 * a})` : `rgb(255 255 255 / ${0.8 * a})`;
      ctx.textAlign = right ? "left" : "right";
      ctx.font = `600 ${fontPx}px ${UI_FONT}`;
      const nameW = ctx.measureText(l.text).width;
      const padX = 5 / scale;
      const px0 = right ? l.x - padX : l.x - l.w - padX;
      pill(ctx, px0, l.y - lineH / 2, l.w + padX * 2, lineH, 0.78 * a);
      ctx.fillStyle = nameColor;
      ctx.fillText(l.text, l.x, l.y);
      ctx.font = `500 ${fontPx}px ${MONO_FONT}`;
      ctx.fillStyle = hot ? ACCENT : rank < 3 ? withAlpha(ACCENT, a) : `rgb(255 255 255 / ${0.55 * a})`;
      const sx = right ? l.x + nameW + 6 / scale : l.x - nameW - 6 / scale;
      ctx.fillText(l.score, sx, l.y);
    }

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
