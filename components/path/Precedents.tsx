"use client";

import { SECTOR_COLOR, SECTOR_SHORT, STAGE_LABELS } from "@/lib/taxonomy";
import { calaEntityHref } from "./api";
import type { Precedent } from "./types";

// Real companies behind the numbers, stalled ones included (survivorship honesty).
export default function Precedents({ precedents }: { precedents: Precedent[] }) {
  if (!precedents.length) return null;
  return (
    <section className="path-precedents" aria-label="Precedent companies" data-testid="precedents">
      <header className="path-section-head">
        <span>Real precedents</span>
        <span className="muted">
          {precedents.filter((p) => p.reachedVision).length} reached · {precedents.filter((p) => !p.reachedVision).length} stalled
        </span>
      </header>
      <ul>
        {precedents.map((p) => (
          <li key={p.companyId} className={`path-precedent ${p.reachedVision ? "" : "is-stalled"}`} data-testid="precedent">
            <a className="path-precedent-name" href={calaEntityHref(p.companyId)} target="_blank" rel="noreferrer" title="Open in Cala">
              <i className="dot" style={{ color: SECTOR_COLOR[p.sector] }} aria-hidden />
              {p.name}
              <span className="muted">{SECTOR_SHORT[p.sector]}</span>
            </a>
            <span className="path-precedent-path">
              {p.path.map((s) => (
                <span key={s.roundId} className="path-stepchip" title={`${STAGE_LABELS[s.stage]}${s.leadName ? ` · ${s.leadName}` : ""}${s.date ? ` · ${s.date}` : ""}`}>
                  <b>{STAGE_LABELS[s.stage]}</b>
                  {s.leadName && <span>{s.leadName}</span>}
                  {s.date && <span className="font-mono muted">{s.date.slice(0, 4)}</span>}
                </span>
              ))}
              <span className={`tag ${p.reachedVision ? "tag-accent" : ""}`}>{p.reachedVision ? "reached" : `stalled · ${STAGE_LABELS[p.path[p.path.length - 1]?.stage ?? "seed"]}`}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
