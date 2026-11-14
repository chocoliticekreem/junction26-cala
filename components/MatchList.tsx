"use client";

import { SECTOR_COLOR, SECTOR_SHORT, STAGE_LABELS } from "@/lib/taxonomy";
import type { Deal, Investor, Match } from "@/lib/types";
import { dominantSector } from "@/lib/physics";

export type MatchListProps = {
  matches: Match[];
  investors: Investor[];
  selectedId?: string;
  onSelect: (id?: string) => void;
  limit?: number;
};

export function EvidenceChip({ deal }: { deal: Deal }) {
  const round = deal.round === "unknown" ? "round n/a" : STAGE_LABELS[deal.round];
  const year = deal.date ? deal.date.slice(0, 4) : "";
  const text = [deal.company, round, year].filter(Boolean).join(" · ");
  const url = deal.sources.find((s) => s.url)?.url;
  return url ? (
    <a className="evidence" href={url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title={deal.sources[0]?.name}>
      {text}
    </a>
  ) : (
    <span className="evidence" title={deal.sources[0]?.name}>
      {text}
    </span>
  );
}

export default function MatchList({ matches, investors, selectedId, onSelect, limit = 10 }: MatchListProps) {
  const byId = new Map(investors.map((i) => [i.id, i]));
  const rows = matches.slice(0, limit);
  return (
    <section className="rail-card rail-grow" aria-label="Top matches" data-testid="match-list">
      <header className="rail-head">
        <span>Top {rows.length}</span>
        <span className="muted">ranked on revealed deals</span>
      </header>
      <ol className="matches">
        {rows.map((m, i) => {
          const inv = byId.get(m.investorId);
          if (!inv) return null;
          const sector = dominantSector(inv.revealed.S);
          const selected = m.investorId === selectedId;
          return (
            <li key={m.investorId} data-testid="match-row">
              <button
                type="button"
                className={`match ${selected ? "is-selected" : ""}`}
                onClick={() => onSelect(selected ? undefined : m.investorId)}
                aria-pressed={selected}
              >
                <span className="match-rank font-mono">{String(i + 1).padStart(2, "0")}</span>
                <span className="match-main">
                  <span className="match-title">
                    <i className="dot" style={{ background: SECTOR_COLOR[sector] }} aria-hidden />
                    <span className="match-name">{inv.name}</span>
                    <span className="sr-only">, {SECTOR_SHORT[sector]}</span>
                    {inv.thinHistory && <span className="tag">thin history</span>}
                    {inv.contradiction > 0.4 && (
                      <span className="tag tag-accent" title={inv.contradictionLine}>
                        contradiction
                      </span>
                    )}
                  </span>
                  <span className="match-reason">{m.reason}</span>
                  {inv.contradiction > 0.4 && inv.contradictionLine && <span className="match-contra">{inv.contradictionLine}</span>}
                  <span className="match-evidence">
                    {m.evidence.slice(0, 3).map((d, k) => (
                      <EvidenceChip key={`${d.company}-${k}`} deal={d} />
                    ))}
                  </span>
                </span>
                <span className="match-score font-mono">
                  {m.score}
                  <small>/100</small>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
