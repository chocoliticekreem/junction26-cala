"use client";

import { useEffect, useRef } from "react";

// Deep-space backdrop behind every page: three star layers pre-rendered once to offscreen
// canvases and translated per frame (parallax drift), plus a sparse set of twinkling stars.
// Nebula colour washes are CSS gradients on <body>, so the per-frame cost is three drawImage
// calls and ~40 small arcs.

type Layer = { tile: HTMLCanvasElement; speed: number; ox: number; oy: number };
type Twinkle = { x: number; y: number; r: number; phase: number; freq: number; hue: string };

const TILE = 1024;
const LAYERS: { count: number; size: [number, number]; alpha: [number, number]; speed: number }[] = [
  { count: 420, size: [0.5, 1.1], alpha: [0.25, 0.55], speed: 0.9 },
  { count: 160, size: [0.9, 1.6], alpha: [0.4, 0.8], speed: 1.9 },
  { count: 50, size: [1.3, 2.2], alpha: [0.6, 1], speed: 3.4 },
];
const TINTS = ["255 255 255", "214 226 255", "255 236 214", "198 240 255"];

function seeded(seed: number): () => number {
  let h = seed >>> 0;
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

function makeTile(spec: (typeof LAYERS)[number], seed: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = TILE;
  c.height = TILE;
  const g = c.getContext("2d")!;
  const rnd = seeded(seed);
  for (let i = 0; i < spec.count; i++) {
    const r = spec.size[0] + rnd() * (spec.size[1] - spec.size[0]);
    const a = spec.alpha[0] + rnd() * (spec.alpha[1] - spec.alpha[0]);
    g.fillStyle = `rgb(${TINTS[Math.floor(rnd() * TINTS.length)]} / ${a})`;
    g.beginPath();
    g.arc(rnd() * TILE, rnd() * TILE, r, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

export default function Starfield() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const layers: Layer[] = LAYERS.map((spec, i) => ({ tile: makeTile(spec, 7919 * (i + 1)), speed: spec.speed, ox: 0, oy: 0 }));
    const rnd = seeded(4242);
    let twinkles: Twinkle[] = [];
    let w = 0;
    let h = 0;
    let raf = 0;
    let last = performance.now();

    const resize = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      const dpr = Math.min(1.5, window.devicePixelRatio || 1);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      twinkles = Array.from({ length: 40 }, () => ({
        x: rnd() * w,
        y: rnd() * h,
        r: 1.2 + rnd() * 1.4,
        phase: rnd() * Math.PI * 2,
        freq: 0.6 + rnd() * 1.2,
        hue: TINTS[Math.floor(rnd() * TINTS.length)],
      }));
      draw(performance.now());
    };

    const draw = (now: number) => {
      ctx.clearRect(0, 0, w, h);
      for (const l of layers) {
        const ox = ((l.ox % TILE) + TILE) % TILE;
        const oy = ((l.oy % TILE) + TILE) % TILE;
        for (let x = -ox; x < w; x += TILE) for (let y = -oy; y < h; y += TILE) ctx.drawImage(l.tile, x, y);
      }
      for (const t of twinkles) {
        const k = 0.5 + 0.5 * Math.sin(now / 1000 * t.freq + t.phase);
        ctx.fillStyle = `rgb(${t.hue} / ${0.25 + 0.7 * k})`;
        ctx.beginPath();
        ctx.arc(t.x, t.y, t.r * (0.7 + 0.5 * k), 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(50, now - last);
      last = now;
      for (const l of layers) {
        l.ox += (l.speed * dt) / 1000;
        l.oy += (l.speed * 0.35 * dt) / 1000;
      }
      draw(now);
    };

    window.addEventListener("resize", resize);
    resize();
    if (!reduced) raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={ref} className="starfield" aria-hidden />;
}
