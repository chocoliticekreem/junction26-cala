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
          const lastYear = Math.min(horizonYears, Math.max(...r.steps.map((s) => s.year), 0));
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
                  <i className="path-lane-line" style={{ width: `${(lastYear / horizonYears) * 100}%` }} />
                  {r.steps.map((s, j) => (
                    <span
                      key={j}
                      className="path-step"
                      style={{ left: `${(Math.min(s.year, horizonYears) / horizonYears) * 100}%` }}
                      title={[s.label, `month ${Math.round(s.monthFromStart)}`, s.amountBand, s.headcountBand ? `${s.headcountBand} people` : undefined].filter(Boolean).join(" · ")}
                    >
                      <i />
                      <span className="path-step-text">
                        <b>{STAGE_LABELS[s.stage]}</b>
                        {s.leadName && <span>{s.leadName}</span>}
                      </span>
                    </span>
                  ))}
                </span>
                <span className="path-lane-outcome">
                  <b>{r.outcomeLine}</b>
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
