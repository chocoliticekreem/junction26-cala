"use client";

import { useState } from "react";
import { SECTOR_COLOR, STAGE_LABELS } from "@/lib/taxonomy";
import type { Precedent } from "./types";

// Real companies behind the numbers, stalled ones included (survivorship honesty). Collapsed by
// default; one line each: name, how far they got, and the case-study button for their real rounds.
export default function Precedents({ precedents, onCaseStudy }: { precedents: Precedent[]; onCaseStudy: (p: Precedent) => void }) {
  const [open, setOpen] = useState(false);
  if (!precedents.length) return null;
  return (
    <section className="path-precedents" aria-label="Precedent companies" data-testid="precedents">
      <button type="button" className="path-section-head path-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open} data-testid="toggle-precedents">
        <span>Real precedents</span>
        <span className="muted">
          {precedents.filter((p) => p.reachedVision).length} reached · {precedents.filter((p) => !p.reachedVision).length} stalled
        </span>
        <i aria-hidden />
      </button>
      {open && (
        <ul>
          {precedents.map((p) => {
            const last = p.path[p.path.length - 1];
            return (
              <li key={p.companyId} className={`path-precedent ${p.reachedVision ? "" : "is-stalled"}`} data-testid="precedent">
                <span className="path-precedent-name">
                  <i className="dot" style={{ color: SECTOR_COLOR[p.sector] }} aria-hidden />
                  {p.name}
                </span>
                <span className="path-precedent-route font-mono">
                  {p.path.length} rounds → {STAGE_LABELS[last?.stage ?? "seed"]}
                  {p.reachedVision ? " · reached" : " · stalled"}
                </span>
                <button type="button" className="path-link path-case-btn" onClick={() => onCaseStudy(p)} data-testid="case-study">
                  Case study
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
