"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { pct, sectorColor, sectorLabel } from "./format";
import type { SpotterPick } from "./types";

type Props = {
  investorName: string;
  picks: SpotterPick[];
  selectedId?: string;
  onSelect: (id: string | undefined) => void;
  reducedMotion: boolean;
};

type Placed = { pick: SpotterPick; x: number; y: number; r: number; angle: number; rank: number };
type Frame = { cx: number; cy: number; minR: number; maxR: number; sep: number; compact: boolean };

const RINGS = [90, 70, 50];
const GOLDEN = 2.399963;
const EASE = "600ms cubic-bezier(0.22, 1, 0.36, 1)";

// The detail card sits over the left of the pane; with a pick selected the map re-centres in
// the space that is left so no node hides under it. Node and label sizes never change.
function frame(w: number, h: number, selected: boolean): Frame {
  const cy = h / 2;
  // Side labels run ~150px past a node, so the outer ring stops short of the pane edges.
  if (!selected) return { cx: w / 2, cy, minR: 104, maxR: Math.max(170, Math.min(w / 2 - 170, h / 2 - 48)), sep: 108, compact: false };
  const panelW = w < 860 ? 340 : 372;
  const left = panelW + 32;
  const avail = Math.max(260, w - left - 24);
  // Under ~640px of room the side labels collide; dimmed nodes then drop them (hover still tells).
  const compact = avail < 640;
  const maxR = Math.max(130, Math.min(avail / 2 - (compact ? 30 : 110), h / 2 - 48));
  return { cx: left + avail / 2, cy, minR: Math.min(88, maxR * 0.45), maxR, sep: compact ? 64 : 92, compact };
}

// Rank sets the distance from "you"; a golden-angle spiral spreads the angles, then a short
// relaxation pushes any two nodes apart (labels sit to the side, so x counts for more).
function layout(picks: SpotterPick[], f: Frame): Placed[] {
  const { cx, cy, minR, maxR, sep } = f;
  const placed = picks.map((pick, i) => {
    const t = Math.min(1, Math.max(0, pick.scores.total / 100));
    const dist = minR + (1 - t) * (maxR - minR);
    const angle = -Math.PI / 2 + i * GOLDEN;
    const r = 7 + (pick.scores.unicornOdds / 100) * 14;
    return { pick, x: cx + Math.cos(angle) * dist, y: cy + Math.sin(angle) * dist, r, angle, rank: i + 1 };
  });
  for (let iter = 0; iter < 80; iter++) {
    let moved = false;
    for (let a = 0; a < placed.length; a++) {
      for (let b = a + 1; b < placed.length; b++) {
        const A = placed[a];
        const B = placed[b];
        const dx = (B.x - A.x) * 0.55;
        const dy = B.y - A.y;
        const d = Math.hypot(dx, dy) || 0.01;
        if (d >= sep) continue;
        const push = ((sep - d) / d) * 0.5;
        A.x -= dx * push;
        A.y -= dy * push;
        B.x += dx * push;
        B.y += dy * push;
        moved = true;
      }
    }
    for (const p of placed) {
      const dx = p.x - cx;
      const dy = p.y - cy;
      const d = Math.hypot(dx, dy) || 0.01;
      const clamped = Math.min(maxR, Math.max(minR, d));
      p.x = cx + (dx / d) * clamped;
      p.y = cy + (dy / d) * clamped;
      p.angle = Math.atan2(dy, dx);
    }
    if (!moved) break;
  }
  return placed;
}

export default function Constellation({ investorName, picks, selectedId, onSelect, reducedMotion }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hoverId, setHoverId] = useState<string | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ w: Math.round(width), h: Math.round(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const f = useMemo(() => frame(size.w, size.h, !!selectedId), [size, selectedId]);
  const placed = useMemo(() => (size.w && size.h ? layout(picks, f) : []), [picks, f, size]);
  const hover = placed.find((p) => p.pick.company.id === hoverId) ?? null;
  const move = reducedMotion ? undefined : `transform ${EASE}`;
  const grow = reducedMotion ? undefined : `r ${EASE}`;

  return (
    <div ref={host} className="sp-pane" data-testid="spotter-constellation" onClick={() => onSelect(undefined)}>
      {size.w > 0 && (
        <svg viewBox={`0 0 ${size.w} ${size.h}`} role="img" aria-label={`${picks.length} picks for ${investorName}, closest to you ranked highest`}>
          <defs>
            {placed.map(({ pick }) => (
              <radialGradient key={pick.company.id} id={`glow-${pick.company.id}`}>
                <stop offset="0%" stopColor={sectorColor(pick.company.sector)} stopOpacity={0.55} />
                <stop offset="45%" stopColor={sectorColor(pick.company.sector)} stopOpacity={0.18} />
                <stop offset="100%" stopColor={sectorColor(pick.company.sector)} stopOpacity={0} />
              </radialGradient>
            ))}
            <radialGradient id="glow-you">
              <stop offset="0%" stopColor="#FF6A3D" stopOpacity={0.6} />
              <stop offset="100%" stopColor="#FF6A3D" stopOpacity={0} />
            </radialGradient>
          </defs>

          <g style={{ transform: `translate(${f.cx}px, ${f.cy}px)`, transition: move }}>
            {RINGS.map((score) => {
              const rr = f.minR + (1 - score / 100) * (f.maxR - f.minR);
              return (
                <circle key={score} className="sp-ring" r={rr} style={{ transition: grow }} />
              );
            })}
          </g>

          <g style={{ pointerEvents: "none" }}>
            {placed.map((p) => (
              <g key={`glow-${p.pick.company.id}`} style={{ transform: `translate(${p.x}px, ${p.y}px)`, transition: move }}>
                <circle r={p.r * 3.4 + 18 * (p.pick.scores.unicornOdds / 100)} fill={`url(#glow-${p.pick.company.id})`} />
              </g>
            ))}
          </g>

          {placed.map((p) => {
            const d = Math.hypot(p.x - f.cx, p.y - f.cy);
            const a = (Math.atan2(p.y - f.cy, p.x - f.cx) * 180) / Math.PI;
            return (
              <line
                key={`spoke-${p.pick.company.id}`}
                className="sp-spoke"
                x1={0}
                y1={0}
                x2={1}
                y2={0}
                vectorEffect="non-scaling-stroke"
                style={{
                  transform: `translate(${f.cx}px, ${f.cy}px) rotate(${a}deg) scale(${d}, 1)`,
                  transition: move,
                  stroke: selectedId === p.pick.company.id ? "rgb(255 106 61 / 0.5)" : undefined,
                }}
              />
            );
          })}

          <g style={{ transform: `translate(${f.cx}px, ${f.cy}px)`, transition: move }}>
            <g className="sp-center" data-testid="spotter-you">
              <circle className="sp-center-glow" r={52} fill="url(#glow-you)" />
              <circle r={9} fill="#FF6A3D" />
              <circle r={16} fill="none" stroke="#FF6A3D" strokeOpacity={0.35} />
              <text y={36} textAnchor="middle">
                You
              </text>
            </g>
          </g>

          {placed.map((p, i) => {
            const { pick } = p;
            const color = sectorColor(pick.company.sector);
            const ringR = p.r + 7;
            const circ = 2 * Math.PI * ringR;
            const onPath = pick.scores.youOnPath / 100;
            const selected = selectedId === pick.company.id;
            const dim = !!selectedId && !selected;
            const labelRight = Math.cos(p.angle) >= -0.2;
            const showLabel = !(f.compact && dim);
            const lx = labelRight ? ringR + 8 : -ringR - 8;
            return (
              <g key={pick.company.id} style={{ transform: `translate(${p.x}px, ${p.y}px)`, transition: move }}>
                <g
                  className={`sp-node ${selected ? "is-selected" : ""} ${dim ? "is-dim" : ""}`}
                  style={{ "--delay": reducedMotion ? "0ms" : `${120 + i * 70}ms` } as React.CSSProperties}
                  tabIndex={0}
                  role="button"
                  aria-label={`${pick.company.name}, rank ${p.rank}, you on its path ${pct(pick.scores.youOnPath)}`}
                  data-testid={`spotter-node-${pick.company.id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(selected ? undefined : pick.company.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelect(pick.company.id);
                    }
                  }}
                  onMouseEnter={() => setHoverId(pick.company.id)}
                  onMouseLeave={() => setHoverId((h) => (h === pick.company.id ? null : h))}
                >
                  {selected && <circle className="sp-select" r={24} />}
                  <circle className="sp-you-track" r={ringR} />
                  <circle className="sp-you" r={ringR} strokeDasharray={circ} strokeDashoffset={circ * (1 - onPath)} transform="rotate(-90)" />
                  <circle className="sp-core" r={p.r} fill={color} />
                  {showLabel && (
                    <>
                      <text className="sp-name" x={lx} y={-2} textAnchor={labelRight ? "start" : "end"}>
                        {pick.company.name}
                      </text>
                      <text className="sp-odds" x={lx} y={12} textAnchor={labelRight ? "start" : "end"}>
                        {sectorLabel(pick.company.sector)}
                      </text>
                    </>
                  )}
                </g>
              </g>
            );
          })}
        </svg>
      )}

      {hover && (
        <div className="sp-tip" style={{ left: hover.x, top: hover.y - hover.r - 8 }}>
          <b>{hover.pick.company.name}</b> ·{" "}
          <span style={{ color: "var(--accent)" }}>you&rsquo;re on its path {pct(hover.pick.scores.youOnPath)}</span>
        </div>
      )}
    </div>
  );
}
