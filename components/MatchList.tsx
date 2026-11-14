"use client";

import { SECTOR_COLOR, SECTOR_SHORT, STAGE_LABELS, type Sector, type Stage } from "@/lib/taxonomy";
import type { Deal, Investor, Match } from "@/lib/types";
import { dominantSector } from "@/lib/physics";

export type MatchListProps = {
  matches: Match[];
  investors: Investor[];
  selectedId?: string;
  onSelect: (id?: string) => void;
  limit?: number;
  idle?: boolean;
};

function sourceTitle(deal: Deal): string | undefined {
  const s = deal.sources[0];
  if (!s) return undefined;
  return s.date ? `${s.name} · ${s.date}` : s.name;
}

export function EvidenceChip({ deal }: { deal: Deal }) {
  const round = deal.round === "unknown" ? "round n/a" : STAGE_LABELS[deal.round];
  const year = deal.date ? deal.date.slice(0, 4) : "";
  const text = [deal.company, round, year].filter(Boolean).join(" · ");
  const url = deal.sources.find((s) => s.url)?.url;
  const title = sourceTitle(deal);
  return url ? (
    <a className="evidence" href={url} target="_blank" rel="noreferrer" title={title}>
      {text}
    </a>
  ) : (
    <span className="evidence" title={title}>
      {text}
    </span>
  );
}

// The single stated-vs-revealed pair with the widest gap, across stages then sectors.
export function contradictionPair(inv: Investor): { label: string; stated: number; revealed: number } | null {
  let best: { label: string; stated: number; revealed: number; gap: number } | null = null;
  const consider = (label: string, stated: number, revealed: number) => {
    const gap = Math.abs(stated - revealed);
    if (!best || gap > best.gap) best = { label, stated, revealed, gap };
  };
  for (const [k, v] of Object.entries(inv.statedThesis.stages) as [Stage, number][]) {
    consider(STAGE_LABELS[k] ?? k, v ?? 0, inv.revealed.G[k] ?? 0);
  }
  for (const [k, v] of Object.entries(inv.statedThesis.sectors) as [Sector, number][]) {
    consider(SECTOR_SHORT[k] ?? k, v ?? 0, inv.revealed.S[k] ?? 0);
  }
  return best;
}

function MiniBars({ inv }: { inv: Investor }) {
  const pair = contradictionPair(inv);
  if (!pair) return null;
  const s = Math.round(pair.stated * 100);
  const r = Math.round(pair.revealed * 100);
  return (
    <span className="mini-bars" title={`${pair.label}: stated ${s}%, revealed ${r}%`} aria-label={`${pair.label}: stated ${s} percent, revealed ${r} percent`}>
      <span className="mini-label">{pair.label}</span>
      <span className="mini-track">
        <i className="mini-stated" style={{ width: `${s}%` }} />
        <i className="mini-revealed" style={{ width: `${r}%` }} />
      </span>
      <span className="mini-num font-mono">
        {s}→{r}
      </span>
    </span>
  );
}

export default function MatchList({ matches, investors, selectedId, onSelect, limit = 10, idle = false }: MatchListProps) {
  const byId = new Map(investors.map((i) => [i.id, i]));
  const rows = matches.slice(0, limit);
  return (
    <section className="rail-card rail-grow" aria-label="Top matches" data-testid="match-list" data-idle={idle || undefined}>
      <header className="rail-head">
        <span>Top {rows.length}</span>
        <span className="muted">{idle ? "forms as you speak" : "by revealed deals"}</span>
      </header>
      {idle && (
        <div className="matches-idle" data-testid="match-idle" aria-hidden>
          <ul>
            {[0, 1, 2, 3].map((i) => (
              <li key={i} style={{ animationDelay: `${i * 140}ms` }}>
                <i className="sk sk-rank" />
                <span>
                  <i className="sk sk-name" style={{ width: `${46 + ((i * 17) % 30)}%` }} />
                  <i className="sk sk-line" style={{ width: `${58 + ((i * 23) % 34)}%` }} />
                </span>
                <i className="sk sk-score" />
              </li>
            ))}
          </ul>
        </div>
      )}
      <ol className="matches">
        {rows.map((m, i) => {
          const inv = byId.get(m.investorId);
          if (!inv) return null;
          const sector = dominantSector(inv.revealed.S);
          const selected = m.investorId === selectedId;
          const contradicts = inv.contradiction > 0.4 && !!inv.contradictionLine;
          return (
            <li key={m.investorId} data-testid="match-row" data-sector={sector} data-investor-id={m.investorId}>
              <div className={`match ${selected ? "is-selected" : ""}`}>
                <button type="button" className="match-select" onClick={() => onSelect(selected ? undefined : m.investorId)} aria-pressed={selected}>
                  <span className="match-rank font-mono">{String(i + 1).padStart(2, "0")}</span>
                  <span className="match-main">
                    <span className="match-title">
                      <i className="dot" style={{ background: SECTOR_COLOR[sector] }} aria-hidden />
                      <span className="match-name">{inv.name}</span>
                      <span className="match-sector" style={{ color: SECTOR_COLOR[sector] }}>
                        {SECTOR_SHORT[sector]}
                      </span>
                      {inv.thinHistory && <span className="tag">thin history</span>}
                      {contradicts && (
                        <span className="tag tag-accent" title={inv.contradictionLine}>
                          contradiction
                        </span>
                      )}
                    </span>
                    <span className="match-reason">{m.reason}</span>
                    {contradicts && inv.contradictionLine && (
                      <span className="match-contra" data-testid="match-contradiction">
                        {inv.contradictionLine}
                        <MiniBars inv={inv} />
                      </span>
                    )}
                  </span>
                  <span className="match-score font-mono">
                    {Math.round(m.score)}
                    <small>/100</small>
                  </span>
                </button>
                <span className="match-evidence">
                  {m.evidence.slice(0, 3).map((d, k) => (
                    <EvidenceChip key={`${d.company}-${k}`} deal={d} />
                  ))}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
