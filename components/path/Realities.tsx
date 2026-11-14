"use client";

import { STAGE_LABELS } from "@/lib/taxonomy";
import { calaEntityHref } from "./api";
import type { Reality } from "./types";

export type RealitiesProps = {
  realities: Reality[];
  selectedId?: string;
  onSelect: (id?: string) => void;
  horizonYears?: number;
  startLabel: string;
};

const pct = (p: number) => `${Math.round(p * 100)}%`;

// Labels sit above the line; a step whose label would start inside the previous label on that
// side goes below the line instead, so close rounds never print on top of each other. Label width
// is estimated as a share of the track from its character count (≈6px per character on a ≈560px
// track, plus the dot and gap).
const CHAR_W = 0.011;
const DOT_W = 0.03;

function labelSides(steps: { x: number; chars: number }[]): ("above" | "below")[] {
  let aboveEnd = -Infinity;
  let belowEnd = -Infinity;
  return steps.map(({ x, chars }) => {
    const side = x >= aboveEnd || x < belowEnd ? "above" : "below";
    const end = x + DOT_W + chars * CHAR_W;
    if (side === "above") aboveEnd = end;
    else belowEnd = end;
    return side;
  });
}

// Lead names run long ("Lightspeed Venture Partners"); the label keeps the first words that fit.
function shortLead(name: string): string {
  return name.length > 22 ? `${name.slice(0, 20).replace(/\s+\S*$/, "")}…` : name;
}

// Diverging timelines from today to year N, best reality first. Each lane is a button; the
// selected lane re-routes the particle highways on the map. A reality's title is its id: the
// engine builds one lane per outcome class, so titles are unique within a result.
export default function Realities({ realities, selectedId, onSelect, horizonYears = 5, startLabel }: RealitiesProps) {
  const sorted = [...realities].sort((a, b) => b.probability - a.probability);
  const years = Array.from({ length: horizonYears + 1 }, (_, i) => i);
  const maxP = Math.max(...sorted.map((r) => r.probability), 0.01);
  return (
    <section className="path-realities" aria-label="Possible realities" data-testid="realities">
      <header className="path-section-head">
        <span>Possible realities</span>
        <span className="muted">{startLabel} · today → year {horizonYears} · best first</span>
      </header>
      <div className="path-years" aria-hidden>
        <span />
        <span className="path-years-track">
          {years.map((y) => (
            <span key={y} className="path-year" style={{ left: `${(y / horizonYears) * 100}%` }}>
              {y === 0 ? "Today" : `Y${y}`}
            </span>
          ))}
        </span>
        <span className="path-years-outcome">Outcome</span>
      </div>
      <ol className="path-lanes">
        {sorted.map((r, i) => {
          const selected = r.title === selectedId;
          const stalled = r.outcome !== "reached_vision";
          // Steps sit at their median month, so two rounds inside one year do not stack.
          const at = (s: { monthFromStart: number }) => Math.min(1, Math.max(0, s.monthFromStart / (horizonYears * 12)));
          const lastAt = Math.max(...r.steps.map(at), 0);
          const sides = labelSides(r.steps.map((s) => ({ x: at(s), chars: STAGE_LABELS[s.stage].length + (s.leadName ? shortLead(s.leadName).length + 1 : 0) })));
          const outcomeShort = r.outcomeShort ?? r.outcomeLine;
          return (
            <li key={r.title}>
              <button
                type="button"
                className={`path-lane ${selected ? "is-selected" : ""} ${stalled ? "is-stalled" : ""}`}
                onClick={() => onSelect(selected ? undefined : r.title)}
                aria-pressed={selected}
                data-testid="reality"
                data-reality={r.title}
                title={`${r.runs.toLocaleString()} runs · ${r.sampleSize} real companies behind it${r.lowConfidence ? " · low confidence" : ""}`}
              >
                <span className="path-lane-head">
                  <b className="path-lane-prob font-mono" style={{ "--p": r.probability / maxP } as React.CSSProperties}>
                    {pct(r.probability)}
                  </b>
                  <span className="path-lane-name">
                    <span className="path-lane-rank font-mono">{i + 1}</span>
                    {r.title}
                  </span>
                </span>
                <span className="path-lane-track" style={{ "--cols": horizonYears } as React.CSSProperties}>
                  <i className="path-lane-line" style={{ width: `${lastAt * 100}%` }} />
                  {r.steps.map((s, j) => (
                    <span
                      key={j}
                      className={`path-step is-${sides[j]}`}
                      style={{ left: `${at(s) * 100}%` }}
                      title={[s.label, `month ${Math.round(s.monthFromStart)}`, s.amountBand, s.headcountBand ? `${s.headcountBand} people` : undefined].filter(Boolean).join(" · ")}
                    >
                      <i />
                      <span className="path-step-text">
                        <b>{STAGE_LABELS[s.stage]}</b>
                        {s.leadName && <span>{shortLead(s.leadName)}</span>}
                      </span>
                    </span>
                  ))}
                </span>
                <span className="path-lane-outcome">
                  <b className="path-outcome-chip" title={r.outcomeLine} data-testid="outcome-chip">
                    {outcomeShort}
                  </b>
                  {r.precedents.length > 0 && (
                    <span className="path-lane-precedents">
                      {r.precedents.map((p) => (
                        <a key={p.companyId} href={calaEntityHref(p.companyId)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                          {p.name}
                        </a>
                      ))}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
