"use client";

import { useEffect } from "react";
import { fmtUsd } from "@/lib/sim/util";
import { SECTOR_COLOR, SECTOR_SHORT, STAGE_LABELS, type Stage } from "@/lib/taxonomy";
import { calaEntityHref } from "./api";
import type { Precedent } from "./types";

// The simulated path the founder is presenting: a reality's steps or a branch's best path.
export type CaseStudyPath = { title: string; steps: { stage: Stage; leadName?: string; monthFromStart: number }[] };

export type CaseStudyProps = {
  precedent: Precedent;
  path?: CaseStudyPath;
  companyLabel: string;
  onClose: () => void;
};

const year = (d?: string) => (d ? d.slice(0, 4) : undefined);

function monthsBetween(a?: string, b?: string): number | undefined {
  if (!a || !b) return undefined;
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + ((bm || 1) - (am || 1));
}

// A real company's funding path next to the simulated one the founder picked, round by round.
export default function CaseStudy({ precedent: p, path, companyLabel, onClose }: CaseStudyProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const last = p.path[p.path.length - 1];
  const first = p.path[0];
  const span = monthsBetween(first?.date, last?.date);
  const raised = p.path.reduce((a, s) => a + (s.amountUsd ?? 0), 0);
  const yours = new Map(path?.steps.map((s) => [s.stage, s]) ?? []);
  const shared = p.path.filter((s) => yours.has(s.stage)).length;

  return (
    <div className="case-backdrop" onClick={onClose} role="presentation" data-testid="case-study-backdrop">
      <section className="case glass" role="dialog" aria-modal="true" aria-label={`${p.name} case study`} onClick={(e) => e.stopPropagation()} data-testid="case-study-panel">
        <header className="case-head">
          <div>
            <p className="case-kicker">
              Case study · <i className="dot" style={{ color: SECTOR_COLOR[p.sector] }} aria-hidden /> {SECTOR_SHORT[p.sector]}
            </p>
            <h2 className="case-title">{p.name}</h2>
            <p className="case-sub">
              <span className={`tag ${p.reachedVision ? "tag-accent" : ""}`}>{p.reachedVision ? "Reached the vision" : `Stalled after ${STAGE_LABELS[last?.stage ?? "seed"]}`}</span>
              {p.path.length > 0 && (
                <span className="muted">
                  {p.path.length} round{p.path.length === 1 ? "" : "s"}
                  {raised > 0 && ` · ${fmtUsd(raised)} raised`}
                  {span !== undefined && span > 0 && ` · ${year(first.date)}–${year(last.date)}`}
                </span>
              )}
            </p>
          </div>
          <div className="case-tools">
            <a className="btn" href={calaEntityHref(p.companyId)} target="_blank" rel="noreferrer">
              Open in Cala
            </a>
            <button type="button" className="btn" onClick={onClose} aria-label="Close" data-testid="case-study-close">
              Esc
            </button>
          </div>
        </header>

        <div className="case-grid">
          <div className="case-col">
            <p className="case-col-head">{p.name}&apos;s real rounds</p>
            <ol className="case-rounds">
              {p.path.map((s, i) => {
                const gap = i > 0 ? monthsBetween(p.path[i - 1].date, s.date) : undefined;
                return (
                  <li key={s.roundId} className="case-round">
                    <span className="case-when font-mono">{s.date ? s.date.slice(0, 7) : "—"}</span>
                    <span className="case-what">
                      <b>{STAGE_LABELS[s.stage]}</b>
                      {s.amountUsd && <span className="font-mono">{fmtUsd(s.amountUsd)}</span>}
                      {s.leadName && <span className="muted">led by {s.leadName}</span>}
                      {gap !== undefined && gap > 0 && <span className="muted font-mono">+{gap} mo</span>}
                      {s.source?.url && (
                        <a href={s.source.url} target="_blank" rel="noreferrer" className="case-src" title={s.source.name}>
                          source
                        </a>
                      )}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
          <div className="case-col">
            <p className="case-col-head">{path ? `${companyLabel} on "${path.title}"` : `${companyLabel}, simulated`}</p>
            {path && path.steps.length === 0 && <p className="muted case-empty">No new round on this path within the horizon.</p>}
            {path ? (
              <ol className="case-rounds">
                {path.steps.map((s, i) => {
                  const theirs = p.path.find((r) => r.stage === s.stage);
                  return (
                    <li key={i} className={`case-round ${theirs ? "is-matched" : ""}`}>
                      <span className="case-when font-mono">m{Math.round(s.monthFromStart)}</span>
                      <span className="case-what">
                        <b>{STAGE_LABELS[s.stage]}</b>
                        {s.leadName && <span className="muted">led by {s.leadName}</span>}
                        {theirs?.leadName && theirs.leadName === s.leadName && <span className="tag tag-accent">same lead</span>}
                      </span>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="muted case-empty">Pick a reality or a next move to line it up against {p.name}.</p>
            )}
            {path && (
              <p className="case-map muted">
                {shared === 0
                  ? `No shared stage yet: ${p.name} is a ${p.reachedVision ? "destination" : "warning"}, not a template.`
                  : `${shared} of ${path.steps.length} simulated rounds have a real ${p.name} counterpart${p.reachedVision ? "; they got there" : "; they stalled, which is the risk on this path"}.`}
              </p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
