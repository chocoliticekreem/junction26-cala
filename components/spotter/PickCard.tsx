"use client";

import { useEffect, useState } from "react";
import type { Source } from "@/lib/types";
import { pct, roundLabel, sectorColor, sectorLabel, whyItFits } from "./format";
import type { SpotterInvestor, SpotterPick } from "./types";

type Props = { pick: SpotterPick; investor: SpotterInvestor; rank: number; asOf: string; onClose: () => void };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SourcesState = { status: "idle" } | { status: "ok"; sources: Source[] } | { status: "error" };

// Company sources live on the Cala entity; the cohort only keeps the id. Fetched on demand, once.
// While open and still idle the card shows "Loading".
function useSources(companyId: string, open: boolean): SourcesState {
  const [state, setState] = useState<SourcesState>(() => (UUID.test(companyId) ? { status: "idle" } : { status: "ok", sources: [] }));
  useEffect(() => {
    if (!open || state.status !== "idle") return;
    const ctrl = new AbortController();
    fetch(`/api/cala/entity/${companyId}`, { signal: ctrl.signal })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as { sources?: Source[] } | null;
        if (!res.ok || !body) throw new Error(`HTTP ${res.status}`);
        return { status: "ok", sources: body.sources ?? [] } as const;
      })
      .catch(() => ({ status: "error" }) as const)
      .then((next) => {
        if (!ctrl.signal.aborted) setState(next);
      });
    return () => ctrl.abort();
  }, [open, companyId, state.status]);
  return state;
}

export default function PickCard({ pick, investor, rank, asOf, onClose }: Props) {
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const sources = useSources(pick.company.id, sourcesOpen);
  const color = sectorColor(pick.company.sector);
  const c = pick.company;
  const unicorns = pick.precedents.filter((p) => p.outcome === "unicorn");
  const stalled = pick.precedents.find((p) => p.outcome === "stalled");

  return (
    <aside className="sp-detail" data-testid="spotter-card" onClick={(e) => e.stopPropagation()}>
      <div className="sp-detail-head">
        <div className="min-w-0">
          <div className="profile-kind">
            #{rank}
            {c.city ? ` · ${c.city}` : ""}
          </div>
          <h2>{c.name}</h2>
          <div className="sp-pick-chips">
            <span className="sp-chip">
              <i className="dot" style={{ color, background: color }} aria-hidden />
              {sectorLabel(c.sector)}
            </span>
            <span className="sp-chip">{roundLabel(c.latestRound)}</span>
            {c.latestRound.leadName && <span className="sp-chip">led by {c.latestRound.leadName}</span>}
          </div>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      <div className="sp-numbers" data-testid="spotter-numbers">
        <div>
          <b className="font-mono">{pct(pick.scores.unicornOdds)}</b>
          <span>Unicorn-like odds</span>
        </div>
        <div className="k">
          <b className="font-mono">{pct(pick.scores.youOnPath)}</b>
          <span>You&rsquo;re on its path</span>
        </div>
      </div>

      <div className="sp-block">
        <h3>Why it fits you</h3>
        <p className="sp-why">{whyItFits(pick, investor)}</p>
      </div>

      <div className="sp-block">
        <h3>Its rounds so far</h3>
        <div className="sp-pick-chips" data-testid="spotter-rounds">
          {c.rounds.map((r, i) => (
            <span key={i} className="sp-chip">
              {r}
            </span>
          ))}
        </div>
      </div>

      <div className="sp-block">
        <h3>
          Looks like early
          <span className="muted">
            n={pick.sampleSize} paths
            {pick.lowConfidence && (
              <span className="sp-lowconf" title={`Low confidence: only ${pick.sampleSize} comparable paths`} data-testid="spotter-lowconf">
                {" "}
                <i aria-hidden>!</i> low
              </span>
            )}
          </span>
        </h3>
        <div className="sp-precedents" data-testid="spotter-precedents">
          {unicorns.map((p) => (
            <div key={p.id} className="sp-precedent" title={p.steps.join(" → ")}>
              <b>{p.name}</b>
              <span>{p.steps.join(" → ")}</span>
            </div>
          ))}
          {stalled && (
            <div className="sp-precedent is-stalled" title={stalled.steps.join(" → ")}>
              <b>{stalled.name}</b>
              <span>same start, stalled</span>
            </div>
          )}
          {pick.precedents.length === 0 && <span className="muted text-[12px]">No precedent at this depth yet.</span>}
        </div>
      </div>

      <div className="sp-block">
        <div className="sp-actions">
          <a className="sp-action" href={`/?company=${encodeURIComponent(c.name)}`} data-testid="spotter-company-file">
            <b>Company file ↗</b>
            <small>{c.investors.length ? `${c.investors.length} investors on record` : "open in the founder flow"}</small>
          </a>
          <button type="button" className={`sp-action ${sourcesOpen ? "is-on" : ""}`} onClick={() => setSourcesOpen((o) => !o)} aria-expanded={sourcesOpen} data-testid="spotter-sources">
            <b>Sources</b>
            <small>{sourcesOpen ? "hide" : "where this comes from"}</small>
          </button>
        </div>
        {sourcesOpen && (
          <div className="sp-sources" data-testid="spotter-sources-list">
            <ul className="sources">
              <li>
                Cala knowledge/query · funding rounds<span className="muted font-mono"> {asOf}</span>
              </li>
              {sources.status === "ok" &&
                sources.sources.slice(0, 8).map((s, i) => (
                  <li key={`${s.name}-${i}`}>
                    {s.url ? (
                      <a href={s.url} target="_blank" rel="noreferrer">
                        {s.name}
                      </a>
                    ) : (
                      s.name
                    )}
                    {s.date && <span className="muted font-mono"> {s.date}</span>}
                  </li>
                ))}
            </ul>
            {sources.status === "idle" && <p className="muted">Looking up the Cala entity…</p>}
            {sources.status === "error" && <p className="muted">Cala entity lookup failed.</p>}
          </div>
        )}
      </div>
    </aside>
  );
}
