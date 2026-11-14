"use client";

import { forceCollide, forceManyBody, forceSimulation, forceX, forceY, type Simulation } from "d3-force";
import { useEffect, useRef } from "react";
import { monoFont, uiFont } from "../canvasFont";
import { YOU_ID, type Highway, type InvestorKind, type NetworkData } from "./types";

export const KIND_COLOR: Record<InvestorKind, string> = {
  fund: "#6EA8FF",
  angel: "#FFC46B",
  accelerator: "#4FE3C1",
  cvc: "#B48CFF",
  unknown: "#8C94A8",
};
export const KIND_LABEL: Record<InvestorKind, string> = { fund: "Fund", angel: "Angel", accelerator: "Accelerator", cvc: "Corporate VC", unknown: "Unknown" };

const ACCENT = "#FF6A3D";
const YOU_COLOR = "#FFF6EA";
const PARTICLE_BUDGET = 2600;
const MAX_DEPTH = 4;

export type PathMapPhase = "idle" | "interview" | "simulating" | "results";

// Pixels the drawers and the brief bar cover; highway columns are laid out inside the rest.
export type MapInset = { left: number; right: number; top: number; bottom: number };
const NO_INSET: MapInset = { left: 0, right: 0, top: 0, bottom: 0 };

export type PathMapProps = {
  network: NetworkData;
  inset?: MapInset;
  highways: Highway[];
  // Ordered node-id chains (You -> lead -> lead ...) kept bright and labelled, best first.
  brightPaths: string[][];
  emphasisEdges?: Set<string>;
  backerIds?: string[];
  youLabel: string;
  phase: PathMapPhase;
  reducedMotion: boolean;
};

type Node = {
  id: string;
  name: string;
  kind: InvestorKind;
  led: number;
  r: number;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
  tx: number;
  ty: number;
  depth: number;
  onHighway: boolean;
  alpha: number;
  sector: string;
  // Twinkle phase and rate, fixed per star.
  tw: number;
  twf: number;
};

type Particle = { t: number; speed: number; off: number; size: number };
type Edge = {
  key: string;
  from: Node;
  to: Node;
  weight: number;
  alpha: number;
  target: number;
  particles: Particle[];
  bend: number;
};
type Gather = { x: number; y: number; vx: number; vy: number; life: number };
type Link = [Node, Node];

const CONSTELLATION_REACH = 150;
const CONSTELLATION_EVERY = 40;

// Faint lines between nearby stars of the same sector: the sector clusters read as
// constellations. Recomputed every few dozen frames, not per frame.
function constellations(nodes: Map<string, Node>): Link[] {
  const stars = [...nodes.values()].filter((n) => n.id !== YOU_ID && !n.onHighway && n.alpha > 0.1);
  const bySector = new Map<string, Node[]>();
  for (const n of stars) bySector.set(n.sector, [...(bySector.get(n.sector) ?? []), n]);
  const links: Link[] = [];
  const seen = new Set<string>();
  for (const group of bySector.values()) {
    for (const a of group) {
      const near = group
        .filter((b) => b !== a)
        .map((b) => ({ b, d: Math.hypot(a.x - b.x, a.y - b.y) }))
        .filter((x) => x.d < CONSTELLATION_REACH)
        .sort((x, y) => x.d - y.d)
        .slice(0, 2);
      for (const { b } of near) {
        const k = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
        if (seen.has(k)) continue;
        seen.add(k);
        links.push([a, b]);
      }
    }
  }
  return links;
}

export const edgeKey = (from: string, to: string) => `${from}>${to}`;

const alphaCache = new Map<string, string>();
function withAlpha(hex: string, a: number): string {
  const k = `${hex}|${Math.round(a * 100)}`;
  let v = alphaCache.get(k);
  if (v) return v;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  v = `rgb(${r} ${g} ${b} / ${Math.round(a * 100) / 100})`;
  alphaCache.set(k, v);
  return v;
}

const sprites = new Map<string, HTMLCanvasElement>();
function sprite(color: string, size = 64): HTMLCanvasElement {
  const key = `${color}|${size}`;
  let c = sprites.get(key);
  if (c) return c;
  c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, withAlpha(color, 1));
  grad.addColorStop(0.25, withAlpha(color, 0.55));
  grad.addColorStop(1, withAlpha(color, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  sprites.set(key, c);
  return c;
}

function seeded(s: string): () => number {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

function bezier(e: Edge, t: number): [number, number] {
  const x0 = e.from.x;
  const y0 = e.from.y;
  const x1 = e.to.x;
  const y1 = e.to.y;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const cx = (x0 + x1) / 2 + (-dy / len) * e.bend * len;
  const cy = (y0 + y1) / 2 + (dx / len) * e.bend * len;
  const u = 1 - t;
  return [u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1];
}

function assignDepths(nodes: Map<string, Node>, highways: Highway[]) {
  for (const n of nodes.values()) {
    n.onHighway = false;
    n.depth = -1;
  }
  const you = nodes.get(YOU_ID);
  if (you) you.depth = 0;
  const out = new Map<string, string[]>();
  for (const h of highways) out.set(h.from, [...(out.get(h.from) ?? []), h.to]);
  const queue = [YOU_ID];
  while (queue.length) {
    const id = queue.shift()!;
    const d = nodes.get(id)?.depth ?? 0;
    for (const next of out.get(id) ?? []) {
      const n = nodes.get(next);
      if (!n) continue;
      n.onHighway = true;
      if (n.depth === -1 || n.depth > d + 1) {
        n.depth = Math.min(MAX_DEPTH, d + 1);
        queue.push(next);
      }
    }
  }
}

function layoutTargets(nodes: Map<string, Node>, w: number, h: number, phase: PathMapPhase, inset: MapInset) {
  const results = phase === "results";
  const bx = results ? inset.left : 0;
  const by = results ? inset.top : 0;
  const bw = results ? Math.max(200, w - inset.left - inset.right) : w;
  const bh = results ? Math.max(200, h - inset.top - inset.bottom) : h;
  const x0 = results ? bx + bw * 0.1 : w * 0.5;
  const colW = bw * 0.21;
  const byDepth = new Map<number, Node[]>();
  for (const n of nodes.values()) {
    if (n.id === YOU_ID) {
      n.tx = x0;
      n.ty = results ? by + bh * 0.5 : h * 0.5;
      n.fx = n.tx;
      n.fy = n.ty;
      continue;
    }
    if (results && n.onHighway) byDepth.set(n.depth, [...(byDepth.get(n.depth) ?? []), n]);
  }
  for (const [d, list] of byDepth) {
    list.sort((a, b) => b.led - a.led);
    const span = Math.min(bh * 0.7, list.length * 58);
    list.forEach((n, i) => {
      n.tx = x0 + d * colW;
      n.ty = Math.min(by + bh * 0.9, Math.max(by + bh * 0.1, by + bh * 0.5 + (list.length === 1 ? 0 : -span / 2 + (span * i) / (list.length - 1))));
    });
  }
  for (const n of nodes.values()) {
    if (n.id === YOU_ID || (results && n.onHighway)) continue;
    const rnd = seeded(n.id);
    const a = rnd() * Math.PI * 2;
    const rr = 0.3 + rnd() * 0.7;
    if (results) {
      n.tx = bx + bw * (0.2 + rnd() * 0.8);
      n.ty = by + bh * (0.04 + rnd() * 0.92);
    } else {
      n.tx = w * 0.5 + Math.cos(a) * rr * w * 0.42;
      n.ty = h * 0.5 + Math.sin(a) * rr * h * 0.44;
    }
  }
}

// d3 position forces cache their accessor values when (re)attached, so every change of a
// node's target re-attaches them.
function retarget(sim: Simulation<Node, undefined>, phase: PathMapPhase, h: number) {
  const results = phase === "results";
  sim.force("charge", forceManyBody<Node>().strength((n) => (n.onHighway && results ? -70 : -14)).distanceMax(170));
  sim.force("collide", forceCollide<Node>().radius((n) => n.r + (n.onHighway && results ? Math.min(34, h / 18) : 5)).strength(0.8));
  sim.force("x", forceX<Node>((n) => n.tx).strength((n) => (n.onHighway && results ? 0.34 : 0.06)));
  sim.force("y", forceY<Node>((n) => n.ty).strength((n) => (n.onHighway && results ? 0.34 : 0.06)));
}

export default function PathMap({ network, inset = NO_INSET, highways, brightPaths, emphasisEdges, backerIds, youLabel, phase, reducedMotion }: PathMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const nodesRef = useRef<Map<string, Node>>(new Map());
  const edgesRef = useRef<Map<string, Edge>>(new Map());
  const simRef = useRef<Simulation<Node, undefined> | null>(null);
  const gatherRef = useRef<Gather[]>([]);
  const linksRef = useRef<{ links: Link[]; frame: number }>({ links: [], frame: 0 });
  const hoverRef = useRef<Node | null>(null);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const propsRef = useRef({ highways, brightPaths, emphasisEdges, backerIds, youLabel, phase, reducedMotion, inset });
  useEffect(() => {
    propsRef.current = { highways, brightPaths, emphasisEdges, backerIds, youLabel, phase, reducedMotion, inset };
  });
  const insetKey = `${inset.left}|${inset.right}|${inset.top}|${inset.bottom}`;

  // Nodes are built once per network and mutated in place so positions survive re-simulations.
  useEffect(() => {
    const map = new Map<string, Node>();
    const maxLed = Math.max(1, ...network.nodes.map((n) => n.ledCount));
    map.set(YOU_ID, { id: YOU_ID, name: youLabel, kind: "unknown", led: 0, r: 9, x: 0, y: 0, tx: 0, ty: 0, depth: 0, onHighway: true, alpha: 1, sector: "", tw: 0, twf: 0 });
    for (const n of network.nodes) {
      const rnd = seeded(n.id);
      map.set(n.id, {
        id: n.id,
        name: n.name,
        kind: n.kind,
        led: n.ledCount,
        r: 2.2 + 5.5 * Math.sqrt(n.ledCount / maxLed),
        x: n.x ?? rnd() * 800,
        y: n.y ?? rnd() * 500,
        tx: 0,
        ty: 0,
        depth: -1,
        onHighway: false,
        alpha: 0,
        sector: n.sector,
        tw: rnd() * Math.PI * 2,
        twf: 0.5 + rnd() * 1.4,
      });
    }
    nodesRef.current = map;
    edgesRef.current = new Map();
    const sim = forceSimulation<Node>([...map.values()]).alphaDecay(0.028).velocityDecay(0.42).stop();
    simRef.current = sim;
    const { w, h } = sizeRef.current;
    if (w && h) {
      assignDepths(map, propsRef.current.highways);
      layoutTargets(map, w, h, propsRef.current.phase, propsRef.current.inset);
      retarget(sim, propsRef.current.phase, h);
      for (const n of map.values()) {
        n.x = n.tx + (seeded(`${n.id}x`)() - 0.5) * 40;
        n.y = n.ty + (seeded(`${n.id}y`)() - 0.5) * 40;
      }
      sim.alpha(1);
      for (let i = 0; i < 60; i++) sim.tick();
    }
    return () => {
      sim.stop();
    };
  }, [network, youLabel]);

  // Highways, phase or size change: re-target and reheat; edges fade in/out with particles.
  useEffect(() => {
    const map = nodesRef.current;
    const sim = simRef.current;
    const { w, h } = sizeRef.current;
    if (!sim || !w || !h) return;
    const you = map.get(YOU_ID);
    if (you) you.name = youLabel;
    assignDepths(map, highways);
    layoutTargets(map, w, h, phase, propsRef.current.inset);
    retarget(sim, phase, h);
    sim.alpha(reducedMotion ? 1 : 0.9);
    if (reducedMotion) for (let i = 0; i < 120; i++) sim.tick();

    const edges = edgesRef.current;
    const live = new Set<string>();
    const total = highways.reduce((a, e) => a + e.weight, 0) || 1;
    for (const hw of highways) {
      const from = map.get(hw.from);
      const to = map.get(hw.to);
      if (!from || !to) continue;
      const key = edgeKey(hw.from, hw.to);
      live.add(key);
      let e = edges.get(key);
      const count = Math.max(6, Math.round((hw.weight / total) * PARTICLE_BUDGET));
      if (!e) {
        const rnd = seeded(key);
        e = { key, from, to, weight: hw.weight, alpha: 0, target: 1, particles: [], bend: (rnd() - 0.5) * 0.5 };
        edges.set(key, e);
      }
      e.weight = hw.weight;
      e.target = 1;
      const rnd = seeded(`${key}p`);
      while (e.particles.length < count) e.particles.push({ t: rnd(), speed: 0.0022 + rnd() * 0.0036, off: (rnd() - 0.5) * 14, size: 1.6 + rnd() * 2.2 });
      if (e.particles.length > count) e.particles.length = count;
    }
    for (const e of edges.values()) if (!live.has(e.key)) e.target = 0;
  }, [highways, phase, youLabel, reducedMotion, insetKey]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    let last = performance.now();

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const hadSize = sizeRef.current.w > 0 && sizeRef.current.h > 0;
      sizeRef.current = { w: rect.width, h: rect.height, dpr };
      if (!rect.width || !rect.height) return;
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const map = nodesRef.current;
      const sim = simRef.current;
      if (sim && map.size) {
        assignDepths(map, propsRef.current.highways);
        layoutTargets(map, rect.width, rect.height, propsRef.current.phase, propsRef.current.inset);
        retarget(sim, propsRef.current.phase, rect.height);
        // Nothing visible yet (or the pane only just got a size): snap to the layout instead of
        // letting the weak idle forces drift stars in from wherever they were.
        const first = !hadSize || ![...map.values()].some((n) => n.id !== YOU_ID && n.alpha > 0.1);
        if (first) {
          for (const n of map.values()) {
            n.x = n.tx + (seeded(`${n.id}x`)() - 0.5) * 40;
            n.y = n.ty + (seeded(`${n.id}y`)() - 0.5) * 40;
          }
          sim.alpha(1);
          for (let i = 0; i < 60; i++) sim.tick();
        } else sim.alpha(0.6);
      }
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();

    const onMove = (ev: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      let best: Node | null = null;
      let bd = 14;
      for (const n of nodesRef.current.values()) {
        if (n.id === YOU_ID) continue;
        const d = Math.hypot(n.x - x, n.y - y);
        if (d < bd + n.r) {
          bd = d;
          best = n;
        }
      }
      hoverRef.current = best;
    };
    const onLeave = () => (hoverRef.current = null);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);

    const UI = uiFont();
    const MONO = monoFont();

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(50, now - last);
      last = now;
      const { w, h, dpr } = sizeRef.current;
      if (!w || !h) return;
      const p = propsRef.current;
      const map = nodesRef.current;
      const sim = simRef.current;
      const motion = p.reducedMotion ? 0 : 1;
      const results = p.phase === "results";
      if (sim && sim.alpha() > 0.003) {
        sim.tick();
        if (sim.alpha() > 0.3) sim.tick();
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const you = map.get(YOU_ID);
      const edges = edgesRef.current;
      const emphasis = p.emphasisEdges;
      const hasEmphasis = !!emphasis && emphasis.size > 0;
      const brightEdges = new Set<string>();
      for (const chain of p.brightPaths) for (let i = 1; i < chain.length; i++) brightEdges.add(edgeKey(chain[i - 1], chain[i]));

      // Node alpha targets: highway nodes full, others a quiet backdrop.
      for (const n of map.values()) {
        if (n.id === YOU_ID) continue;
        const target = results ? (n.onHighway ? 1 : 0.42) : p.phase === "simulating" ? 0.55 : 0.75;
        n.alpha += (target - n.alpha) * (motion ? 0.06 : 1);
      }

      // Edge fades (and removal) drive the visible re-route.
      for (const e of edges.values()) {
        e.alpha += (e.target - e.alpha) * (motion ? 0.07 : 1);
        if (e.target === 0 && e.alpha < 0.01) edges.delete(e.key);
      }

      // Constellations: faint same-sector links behind everything else.
      const lk = linksRef.current;
      if (lk.frame++ % CONSTELLATION_EVERY === 0 || (lk.links.length === 0 && lk.frame < 120)) lk.links = constellations(map);
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      for (const [a, b] of lk.links) {
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.strokeStyle = `rgb(190 205 255 / ${results ? 0.07 : 0.1})`;
      ctx.stroke();

      // Highway ribbons under the particles.
      if (results) {
        ctx.lineCap = "round";
        for (const e of edges.values()) {
          const bright = brightEdges.has(e.key);
          const emph = !hasEmphasis || emphasis!.has(e.key);
          const base = (bright ? 0.22 : 0.09) * e.alpha * (emph ? 1 : 0.3);
          ctx.strokeStyle = withAlpha(KIND_COLOR[e.to.kind], base);
          ctx.lineWidth = 1.5 + Math.sqrt(e.particles.length) * 0.55;
          ctx.beginPath();
          const [sx, sy] = bezier(e, 0);
          ctx.moveTo(sx, sy);
          for (let i = 1; i <= 16; i++) {
            const [x, y] = bezier(e, i / 16);
            ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      }

      // Particles: additive, coloured by where they are going.
      ctx.globalCompositeOperation = "lighter";
      for (const e of edges.values()) {
        const bright = brightEdges.has(e.key);
        const emph = !hasEmphasis || emphasis!.has(e.key);
        const a = e.alpha * (emph ? 1 : 0.22) * (bright ? 1 : 0.7);
        if (a < 0.02) continue;
        const spr = sprite(KIND_COLOR[e.to.kind]);
        const dx = e.to.x - e.from.x;
        const dy = e.to.y - e.from.y;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;
        ctx.globalAlpha = a;
        for (const q of e.particles) {
          q.t += q.speed * dt * 0.06 * motion;
          if (q.t >= 1) q.t -= 1;
          const [x, y] = bezier(e, q.t);
          const fade = Math.min(1, q.t * 6, (1 - q.t) * 6);
          const s = q.size * (bright ? 2.4 : 2) * (0.6 + 0.4 * fade);
          ctx.drawImage(spr, x + nx * q.off - s, y + ny * q.off - s, s * 2, s * 2);
          // Comet tail: two fainter heads trailing along the curve.
          if (bright && q.t > 0.05) {
            const [x1, y1] = bezier(e, q.t - 0.018);
            const [x2, y2] = bezier(e, q.t - 0.036);
            ctx.drawImage(spr, x1 + nx * q.off - s * 0.7, y1 + ny * q.off - s * 0.7, s * 1.4, s * 1.4);
            ctx.drawImage(spr, x2 + nx * q.off - s * 0.45, y2 + ny * q.off - s * 0.45, s * 0.9, s * 0.9);
          }
        }
      }
      ctx.globalAlpha = 1;

      // Simulating: particles gather into You from the whole map.
      if (p.phase === "simulating" && you) {
        const g = gatherRef.current;
        if (motion) {
          for (let i = 0; i < 18 && g.length < 900; i++) {
            const a = Math.random() * Math.PI * 2;
            const rr = Math.max(w, h) * (0.35 + Math.random() * 0.4);
            g.push({ x: you.x + Math.cos(a) * rr, y: you.y + Math.sin(a) * rr, vx: 0, vy: 0, life: 1 });
          }
        }
        const spr = sprite(YOU_COLOR);
        for (let i = g.length - 1; i >= 0; i--) {
          const q = g[i];
          const dx = you.x - q.x;
          const dy = you.y - q.y;
          const d = Math.hypot(dx, dy) || 1;
          q.vx += (dx / d) * 0.55 + (-dy / d) * 0.32;
          q.vy += (dy / d) * 0.55 + (dx / d) * 0.32;
          q.vx *= 0.93;
          q.vy *= 0.93;
          q.x += q.vx * dt * 0.06;
          q.y += q.vy * dt * 0.06;
          if (d < 14) {
            g.splice(i, 1);
            continue;
          }
          ctx.globalAlpha = Math.min(1, d / 120) * 0.9;
          ctx.drawImage(spr, q.x - 3, q.y - 3, 6, 6);
        }
        ctx.globalAlpha = 1;
      } else {
        gatherRef.current.length = 0;
      }
      ctx.globalCompositeOperation = "source-over";

      // Investor stars: soft glow, a bright core, a slow twinkle; highway stars get a sparkle.
      const backers = new Set(p.backerIds ?? []);
      for (const n of map.values()) {
        if (n.id === YOU_ID || n.alpha < 0.02) continue;
        const color = KIND_COLOR[n.kind];
        const key = n.onHighway && results;
        const isBacker = backers.has(n.id);
        const tw = motion ? 0.8 + 0.2 * Math.sin((now / 1000) * n.twf + n.tw) : 1;
        const glowR = n.r * (key ? 4.6 : 3) * (key ? 1 : tw);
        ctx.globalAlpha = n.alpha * (key ? 0.8 : 0.4 * tw);
        ctx.drawImage(sprite(color), n.x - glowR, n.y - glowR, glowR * 2, glowR * 2);
        ctx.globalAlpha = n.alpha * (key ? 1 : 0.7 + 0.3 * tw);
        ctx.fillStyle = key ? color : withAlpha(color, 0.85);
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r * (key ? 1 : 0.85), 0, Math.PI * 2);
        ctx.fill();
        if (key) {
          ctx.fillStyle = "rgb(255 255 255 / 0.9)";
          ctx.beginPath();
          ctx.arc(n.x, n.y, n.r * 0.4, 0, Math.PI * 2);
          ctx.fill();
          const sp = n.r * 2.6;
          ctx.strokeStyle = withAlpha(color, 0.55);
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.moveTo(n.x - sp, n.y);
          ctx.lineTo(n.x + sp, n.y);
          ctx.moveTo(n.x, n.y - sp);
          ctx.lineTo(n.x, n.y + sp);
          ctx.stroke();
        }
        if (isBacker) {
          ctx.strokeStyle = withAlpha(ACCENT, 0.9);
          ctx.lineWidth = 1.4;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.arc(n.x, n.y, n.r + 5, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      ctx.globalAlpha = 1;

      // You: the galaxy's bright core, with a slow orbit ring.
      if (you) {
        const pulse = motion ? 1 + 0.08 * Math.sin(now / 600) : 1;
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = 0.55;
        ctx.drawImage(sprite(ACCENT), you.x - 110 * pulse, you.y - 110 * pulse, 220 * pulse, 220 * pulse);
        ctx.globalAlpha = 0.9;
        ctx.drawImage(sprite(ACCENT), you.x - 60 * pulse, you.y - 60 * pulse, 120 * pulse, 120 * pulse);
        ctx.drawImage(sprite(YOU_COLOR, 32), you.x - 22, you.y - 22, 44, 44);
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 1;
        const spin = motion ? now / 9000 : 0;
        ctx.save();
        ctx.translate(you.x, you.y);
        ctx.rotate(-0.35 + spin);
        ctx.strokeStyle = "rgb(255 220 200 / 0.28)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(0, 0, 30, 12, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = "rgb(255 246 234 / 0.95)";
        ctx.beginPath();
        ctx.arc(30 * Math.cos(spin * 3), 12 * Math.sin(spin * 3), 2.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = YOU_COLOR;
        ctx.beginPath();
        ctx.arc(you.x, you.y, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = `600 14px ${UI}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = "rgb(255 246 234 / 0.92)";
        ctx.fillText(you.name, you.x, you.y + 18);
        if (results) {
          ctx.font = `500 10.5px ${MONO}`;
          ctx.fillStyle = withAlpha(ACCENT, 0.9);
          ctx.fillText("TODAY", you.x, you.y + 37);
        }
      }

      // Labels for highway nodes (results) and bright-path ranks.
      if (results) {
        ctx.textBaseline = "middle";
        const labelled = new Set<string>();
        for (const n of map.values()) {
          if (n.id === YOU_ID || !n.onHighway) continue;
          const right = n.depth >= 1;
          ctx.font = `600 12px ${UI}`;
          ctx.textAlign = right ? "left" : "right";
          ctx.fillStyle = `rgb(255 255 255 / ${0.88 * n.alpha})`;
          const lx = right ? n.x + n.r + 7 : n.x - n.r - 7;
          ctx.fillText(n.name, lx, n.y - 1);
          labelled.add(n.id);
        }
        p.brightPaths.forEach((chain, i) => {
          const end = map.get(chain[chain.length - 1]);
          if (!end || i > 2) return;
          const tag = `${i + 1}`;
          const names = chain.slice(1).map((id) => map.get(id)?.name ?? id);
          const text = names.join("  →  ");
          ctx.font = `500 10.5px ${MONO}`;
          const tw = ctx.measureText(text).width;
          const bx = end.x + end.r + 7;
          const by = end.y + 10;
          ctx.fillStyle = "rgb(11 14 23 / 0.8)";
          ctx.beginPath();
          ctx.roundRect(bx - 4, by, tw + 30, 16, 8);
          ctx.fill();
          ctx.fillStyle = ACCENT;
          ctx.textAlign = "left";
          ctx.font = `700 10px ${MONO}`;
          ctx.fillText(tag, bx + 2, by + 8);
          ctx.font = `500 10.5px ${MONO}`;
          ctx.fillStyle = "rgb(255 255 255 / 0.78)";
          ctx.fillText(text, bx + 16, by + 8);
        });
      }

      // Hover pill.
      const hv = hoverRef.current;
      if (hv && hv.alpha > 0.2) {
        const text = `${hv.name}  ·  ${KIND_LABEL[hv.kind]}  ·  led ${hv.led}`;
        ctx.font = `500 12px ${UI}`;
        const tw = ctx.measureText(text).width;
        ctx.fillStyle = "rgb(11 14 23 / 0.9)";
        ctx.beginPath();
        ctx.roundRect(hv.x + 10, hv.y - 11, tw + 14, 22, 11);
        ctx.fill();
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "rgb(255 255 255 / 0.92)";
        ctx.fillText(text, hv.x + 17, hv.y);
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <div ref={wrapRef} className="path-map" data-testid="path-map" data-phase={phase}>
      <canvas ref={canvasRef} aria-hidden />
    </div>
  );
}
