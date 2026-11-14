"use client";

import { STAGE_LABELS } from "@/lib/taxonomy";
import { calaEntityHref } from "./api";
import type { Reality } from "./types";

export type RealitiesProps = {
  realities: Reality[];
  selectedId?: string;
  onSelect: (id?: string) => void;
  horizonYears?: number;
};

const pct = (p: number) => `${Math.round(p * 100)}%`;

// Step labels sit below the track; a label that would start inside the previous one on that side
// goes above instead. Width is estimated from the character count as a share of the ~330px
// track (≈6px per character, plus the dot and gap).
const CHAR_W = 0.018;
const DOT_W = 0.03;

function labelSides(steps: { x: number; chars: number }[]): ("above" | "below")[] {
  let aboveEnd = -Infinity;
  let belowEnd = -Infinity;
  return steps.map(({ x, chars }) => {
    const side = x >= belowEnd || x < aboveEnd ? "below" : "above";
    const end = x + DOT_W + chars * CHAR_W;
    if (side === "below") belowEnd = end;
    else aboveEnd = end;
    return side;
  });
}

// Lead names run long ("Lightspeed Venture Partners"); the label keeps the first words that fit.
function shortLead(name: string): string {
  return name.length > 18 ? `${name.slice(0, 16).replace(/\s+\S*$/, "")}…` : name;
}

// Compact timelines from today to year N, best reality first; one row per outcome class. Each row
// is a button: the selected one re-routes the particle highways on the map. A reality's title is
// its id, unique within a result.
export default function Realities({ realities, selectedId, onSelect, horizonYears = 5 }: RealitiesProps) {
  const sorted = [...realities].sort((a, b) => b.probability - a.probability);
  const years = Array.from({ length: horizonYears + 1 }, (_, i) => i);
  const maxP = Math.max(...sorted.map((r) => r.probability), 0.01);
  return (
    <section className="fx-realities" aria-label="Possible realities" data-testid="realities">
      <header className="path-section-head">
        <span>Possible realities</span>
        <span className="fx-years font-mono" aria-hidden>
          {years.map((y) => (
            <span key={y} style={{ left: `${(y / horizonYears) * 100}%` }}>
              {y === 0 ? "Today" : `Y${y}`}
            </span>
          ))}
        </span>
      </header>
      <ol className="fx-lanes">
        {sorted.map((r, i) => {
          const selected = r.title === selectedId;
          const stalled = r.outcome !== "reached_vision";
          const at = (s: { monthFromStart: number }) => Math.min(1, Math.max(0, s.monthFromStart / (horizonYears * 12)));
          const lastAt = Math.max(...r.steps.map(at), 0);
          const sides = labelSides(r.steps.map((s) => ({ x: at(s), chars: STAGE_LABELS[s.stage].length })));
          return (
            <li key={r.title}>
              <button
                type="button"
                className={`fx-lane ${selected ? "is-selected" : ""} ${stalled ? "is-stalled" : ""}`}
                onClick={() => onSelect(selected ? undefined : r.title)}
                aria-pressed={selected}
                data-testid="reality"
                data-reality={r.title}
                title={`${r.runs.toLocaleString()} runs · ${r.sampleSize} real companies behind it${r.lowConfidence ? " · low confidence" : ""}`}
              >
                <span className="fx-lane-head">
                  <b className="fx-lane-prob font-mono" style={{ "--p": r.probability / maxP } as React.CSSProperties}>
                    {pct(r.probability)}
                  </b>
                  <span className="fx-lane-name">
                    <span className="fx-lane-rank font-mono">{i + 1}</span>
                    {r.title}
                  </span>
                  <b className="path-outcome-chip" title={r.outcomeLine} data-testid="outcome-chip">
                    {r.outcomeShort ?? r.outcomeLine}
                  </b>
                </span>
                <span className="fx-lane-track">
                  <i className="fx-lane-line" style={{ width: `${lastAt * 100}%` }} />
                  {r.steps.map((s, j) => (
                    <span
                      key={j}
                      className={`fx-step is-${sides[j]}`}
                      style={{ left: `${at(s) * 100}%` }}
                      title={[s.label, s.leadName, `month ${Math.round(s.monthFromStart)}`, s.amountBand, s.headcountBand ? `${s.headcountBand} people` : undefined].filter(Boolean).join(" · ")}
                    >
                      <i />
                      <span className="fx-step-text">
                        <b>{STAGE_LABELS[s.stage]}</b>
                        {s.leadName && <span>{shortLead(s.leadName)}</span>}
                      </span>
                    </span>
                  ))}
                </span>
                {r.precedents.length > 0 && (
                  <span className="fx-lane-precedents">
                    {r.precedents.slice(0, 3).map((p) => (
                      <a key={p.companyId} href={calaEntityHref(p.companyId)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                        {p.name}
                      </a>
                    ))}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
