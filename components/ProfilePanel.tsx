"use client";

import { useEffect, useState } from "react";
import { SECTOR_COLOR, SECTOR_SHORT, STAGE_LABELS, type Sector, type Stage } from "@/lib/taxonomy";
import type { Investor, Match, Source } from "@/lib/types";
import CacheBadge from "./CacheBadge";
import DoorPanel from "./DoorPanel";
import { EvidenceChip } from "./MatchList";

export type ProfilePanelProps = {
  investor: Investor;
  match?: Match;
  onClose: () => void;
};

const KIND_LABEL: Record<Investor["kind"], string> = {
  fund: "Fund",
  angel_network: "Angel network",
  accelerator: "Accelerator",
  cvc: "Corporate VC",
};

type Fetched<T> = { ok: true; data: T } | { ok: false; detail: string };
type CalaPayload = { answer?: string; sources?: Source[]; mock?: boolean; budgetExhausted?: boolean };

// Session cache per investor. An uncached Cala search takes 40-70 s, so the request is never
// aborted when the panel closes: reopening the same investor picks up the in-flight promise or
// the finished result. Failures are dropped so the next open retries.
const pending = new Map<string, Promise<Fetched<CalaPayload>>>();
const settled = new Map<string, Fetched<CalaPayload>>();

async function getJson(url: string, init?: RequestInit): Promise<Fetched<CalaPayload>> {
  try {
    const res = await fetch(url, init);
    if (!res.ok) return { ok: false, detail: `Cala route answered ${res.status}` };
    return { ok: true, data: (await res.json()) as CalaPayload };
  } catch {
    return { ok: false, detail: "network error" };
  }
}

function cachedFetch(key: string, load: () => Promise<Fetched<CalaPayload>>): Promise<Fetched<CalaPayload>> {
  const hit = pending.get(key);
  if (hit) return hit;
  const p = load().then((r) => {
    pending.delete(key);
    if (r.ok) settled.set(key, r);
    return r;
  });
  pending.set(key, p);
  return p;
}

function useCala(key: string | null, load: () => Promise<Fetched<CalaPayload>>): Fetched<CalaPayload> | undefined {
  const [result, setResult] = useState<{ key: string; r: Fetched<CalaPayload> } | null>(null);
  useEffect(() => {
    if (!key || settled.has(key)) return;
    let live = true;
    cachedFetch(key, load).then((r) => {
      if (live) setResult({ key, r });
    });
    return () => {
      live = false;
    };
    // load is rebuilt each render from the same key; the key alone identifies the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!key) return undefined;
  return settled.get(key) ?? (result?.key === key ? result.r : undefined);
}

function Bars({ title, stated, revealed, labelOf, colorOf }: { title: string; stated: Partial<Record<string, number>>; revealed: Partial<Record<string, number>>; labelOf: (k: string) => string; colorOf?: (k: string) => string }) {
  const keys = Array.from(new Set([...Object.keys(stated), ...Object.keys(revealed)]))
    .sort((a, b) => (revealed[b] ?? 0) + (stated[b] ?? 0) - ((revealed[a] ?? 0) + (stated[a] ?? 0)))
    .slice(0, 4);
  if (keys.length === 0) return null;
  return (
    <div className="bars">
      <div className="bars-title">
        <span>{title}</span>
        <span className="legend">
          <i className="legend-stated" /> stated <i className="legend-revealed" /> revealed
        </span>
      </div>
      {keys.map((k) => (
        <div key={k} className="bar-row">
          <span className="bar-label">{labelOf(k)}</span>
          <span className="bar-track">
            <span className="bar bar-stated" style={{ width: `${Math.round((stated[k] ?? 0) * 100)}%` }} />
            <span className="bar bar-revealed" style={{ width: `${Math.round((revealed[k] ?? 0) * 100)}%`, background: colorOf?.(k) }} />
          </span>
          <span className="bar-num font-mono">{Math.round((revealed[k] ?? 0) * 100)}%</span>
        </div>
      ))}
    </div>
  );
}

export default function ProfilePanel({ investor, match, onClose }: ProfilePanelProps) {
  // An empty calaId means no correct Cala entity was found for this investor; skip the fetch.
  const entity = useCala(investor.calaId ? `entity:${investor.calaId}` : null, () =>
    getJson(`/api/cala/entity/${encodeURIComponent(investor.calaId)}`),
  );
  const search = useCala(`search:${investor.id}`, () =>
    getJson("/api/cala/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: `What does ${investor.name} invest in?` }),
    }),
  );
  const liveSources = [...(search?.ok ? (search.data.sources ?? []) : []), ...(entity?.ok ? (entity.data.sources ?? []) : [])];
  const budgetPaused = (search?.ok && search.data.budgetExhausted) || (entity?.ok && entity.data.budgetExhausted);
  const liveMock = !budgetPaused && ((search?.ok && search.data.mock) || (entity?.ok && entity.data.mock));

  const recent = [...investor.deals].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")).slice(0, 5);

  return (
    <aside className="profile-panel" aria-label={`${investor.name} profile`} data-testid="profile-panel">
      <header className="profile-head">
        <div>
          <div className="profile-kind font-mono">{KIND_LABEL[investor.kind]}</div>
          <h2>{investor.name}</h2>
          {investor.description && <p className="muted">{investor.description}</p>}
        </div>
        <div className="profile-score">
          {match && (
            <span className="font-mono">
              {Math.round(match.score)}
              <small>/100</small>
            </span>
          )}
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close profile">
            ×
          </button>
        </div>
      </header>

      {investor.contradiction > 0.4 && investor.contradictionLine && (
        <p className="contradiction" data-testid="contradiction">
          <span className="tag tag-accent">contradiction</span> {investor.contradictionLine}
        </p>
      )}
      {investor.thinHistory && <p className="muted">Thin deal history: stated thesis weighs more for this investor.</p>}

      {match && (
        <section className="panel-block">
          <h3>Why this match</h3>
          <p>{match.reason}</p>
          <div className="match-evidence">
            {match.evidence.slice(0, 3).map((d, i) => (
              <EvidenceChip key={`${d.company}-${i}`} deal={d} />
            ))}
          </div>
        </section>
      )}

      <section className="panel-block">
        <h3>Stated vs revealed</h3>
        <Bars title="Sectors" stated={investor.statedThesis.sectors} revealed={investor.revealed.S} labelOf={(k) => SECTOR_SHORT[k as Sector] ?? k} colorOf={(k) => SECTOR_COLOR[k as Sector]} />
        <Bars
          title="Stages"
          stated={investor.statedThesis.stages}
          revealed={investor.revealed.G}
          labelOf={(k) => STAGE_LABELS[k as Stage] ?? k}
        />
        {investor.statedThesis.text && (
          <p className="muted quote">Stated thesis, summarised from Cala sources: {investor.statedThesis.text}</p>
        )}
      </section>

      <section className="panel-block">
        <h3>Recent deals</h3>
        <ul className="deals">
          {recent.map((d, i) => (
            <li key={`${d.company}-${i}`}>
              <span className="deal-company">{d.company}</span>
              <span className="deal-meta font-mono">
                {d.round === "unknown" ? "n/a" : STAGE_LABELS[d.round]}
                {d.date ? ` · ${d.date.slice(0, 7)}` : ""}
                {d.amount ? ` · ${d.amount}` : ""}
              </span>
              <span className="deal-sector" style={{ color: SECTOR_COLOR[d.sector] }}>
                {SECTOR_SHORT[d.sector]}
              </span>
              {d.sources[0]?.url ? (
                <a className="deal-src" href={d.sources[0].url} target="_blank" rel="noreferrer">
                  {d.sources[0].name}
                </a>
              ) : (
                <span className="deal-src">{d.sources[0]?.name ?? "no source"}</span>
              )}
            </li>
          ))}
          {recent.length === 0 && <li className="muted">No deals on record.</li>}
        </ul>
      </section>

      <section className="panel-block">
        <h3>Partners</h3>
        <ul className="partners">
          {investor.partners.map((p) => (
            <li key={p.calaId}>
              <span>{p.name}</span>
              {p.role && <span className="muted"> · {p.role}</span>}
              {p.linkedinUrl && (
                <a href={p.linkedinUrl} target="_blank" rel="noreferrer" className="partner-link">
                  LinkedIn
                </a>
              )}
            </li>
          ))}
          {investor.partners.length === 0 && <li className="muted">No partner records.</li>}
        </ul>
      </section>

      <section className="panel-block" data-testid="cala-live">
        <h3>
          Live from Cala {liveMock && <span className="tag">mock</span>}
          {budgetPaused && <span className="tag">paused</span>}
        </h3>
        {budgetPaused && (
          <p className="muted" data-testid="cala-budget-paused">
            Live Cala lookup paused, showing cached data.
          </p>
        )}
        {!search && (
          <div className="cala-wait" role="status" data-testid="cala-loading">
            <p className="muted">Asking Cala… this can take up to a minute.</p>
            <span className="cala-progress" aria-hidden="true">
              <i />
            </span>
          </div>
        )}
        {search && !search.ok && (!investor.calaId || (entity && !entity.ok)) && (
          <p className="muted">Live Cala data unavailable ({search.detail}). Showing cached deals above.</p>
        )}
        {search && !search.ok && entity?.ok && <p className="muted">Live Cala summary unavailable ({search.detail}).</p>}
        {search?.ok &&
          !budgetPaused &&
          (search.data.answer ? <p>{search.data.answer}</p> : <p className="muted">No fresh summary returned.</p>)}
        {liveSources.length > 0 && (
          <ul className="sources">
            {liveSources.slice(0, 5).map((s, i) => (
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
        )}
        <CacheBadge result={search?.ok ? search.data : entity?.ok ? entity.data : undefined} />
      </section>

      <DoorPanel doors={investor.doors} />
    </aside>
  );
}
