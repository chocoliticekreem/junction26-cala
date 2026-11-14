"use client";

import { useEffect, useState } from "react";
import { SECTOR_COLOR, SECTOR_SHORT, STAGE_LABELS, type Sector, type Stage } from "@/lib/taxonomy";
import type { Investor, Match, Source } from "@/lib/types";
import CacheBadge from "./CacheBadge";
import DoorPanel from "./DoorPanel";
import Markdown, { markdownBullets } from "./Markdown";
import { EventChips, EvidenceChip } from "./MatchList";

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

const CONTRADICTION = 0.4;

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

// The intro the founder would send: one subject, three lines, the evidence that makes it land.
function introMailto(investor: Investor, match?: Match): string {
  const evidence = (match?.evidence ?? []).slice(0, 2).map((d) => `${d.company}${d.round !== "unknown" ? ` (${STAGE_LABELS[d.round]})` : ""}`);
  const subject = `Intro: ${investor.name}`;
  const body = [
    `Hi ${investor.partners[0]?.name?.split(" ")[0] ?? "there"},`,
    "",
    match?.reason ? `${match.reason}.` : `We are raising and ${investor.name} keeps coming up.`,
    evidence.length ? `Your rounds in ${evidence.join(" and ")} are close to what we are building.` : "",
    "",
    "Could we take 20 minutes this week?",
  ]
    .filter((l, i, a) => !(l === "" && a[i - 1] === ""))
    .join("\n");
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function SourceList({ sources }: { sources: Source[] }) {
  if (!sources.length) return <p className="muted">No sources on record.</p>;
  return (
    <ul className="sources">
      {sources.slice(0, 8).map((s, i) => (
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
  );
}

export default function ProfilePanel({ investor, match, onClose }: ProfilePanelProps) {
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [fullOpen, setFullOpen] = useState(false);
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
  const answer = search?.ok && !budgetPaused ? search.data.answer : undefined;
  const bullets = answer ? markdownBullets(answer) : [];
  const contradicts = investor.contradiction > CONTRADICTION && !!investor.contradictionLine;
  const sources: Source[] = [...investor.statedThesis.sources, ...(match?.evidence ?? []).flatMap((d) => d.sources), ...liveSources];

  return (
    <aside className="profile-panel glass" aria-label={`${investor.name} profile`} data-testid="profile-panel">
      <header className="profile-head">
        <div>
          <div className="profile-kind font-mono">
            {KIND_LABEL[investor.kind]} <EventChips investor={investor} />
          </div>
          <h2>{investor.name}</h2>
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

      {match ? (
        <p className="profile-fit" data-testid="profile-fit">
          {match.reason}
        </p>
      ) : (
        investor.description && <p className="profile-fit muted">{investor.description}</p>
      )}
      {match && match.evidence.length > 0 && (
        <div className="match-evidence profile-evidence">
          {match.evidence.slice(0, 3).map((d, i) => (
            <EvidenceChip key={`${d.company}-${i}`} deal={d} />
          ))}
        </div>
      )}

      <div className="profile-actions">
        <a className="hero-btn hero-btn-primary profile-primary" href={introMailto(investor, match)} title="Opens a drafted intro in your mail app; nothing is sent" data-testid="intro-email">
          Draft intro email
        </a>
        <button type="button" className="btn" onClick={() => setSourcesOpen((v) => !v)} aria-expanded={sourcesOpen} data-testid="profile-sources">
          Sources
        </button>
      </div>
      {sourcesOpen && (
        <section className="panel-block">
          <h3>Sources</h3>
          <SourceList sources={sources} />
        </section>
      )}

      {contradicts && (
        <section className="panel-block">
          <p className="contradiction" data-testid="contradiction">
            <span className="tag tag-accent">contradiction</span> {investor.contradictionLine}
          </p>
          <Bars title="Sectors" stated={investor.statedThesis.sectors} revealed={investor.revealed.S} labelOf={(k) => SECTOR_SHORT[k as Sector] ?? k} colorOf={(k) => SECTOR_COLOR[k as Sector]} />
          <Bars title="Stages" stated={investor.statedThesis.stages} revealed={investor.revealed.G} labelOf={(k) => STAGE_LABELS[k as Stage] ?? k} />
        </section>
      )}

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
        {search && !search.ok && (!investor.calaId || (entity && !entity.ok)) && <p className="muted">Live Cala data unavailable ({search.detail}).</p>}
        {search && !search.ok && entity?.ok && <p className="muted">Live Cala summary unavailable ({search.detail}).</p>}
        {search?.ok && !budgetPaused && !answer && <p className="muted">No fresh summary returned.</p>}
        {answer && (
          <>
            <ul className="profile-bullets" data-testid="cala-bullets">
              {bullets.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
            <button type="button" className="path-link" onClick={() => setFullOpen((v) => !v)} aria-expanded={fullOpen} data-testid="cala-full-toggle">
              {fullOpen ? "Hide Cala's full answer" : "Read Cala's full answer"}
            </button>
            {fullOpen && (
              <div className="profile-full" data-testid="cala-full">
                <Markdown text={answer} />
              </div>
            )}
          </>
        )}
        <CacheBadge result={search?.ok ? search.data : entity?.ok ? entity.data : undefined} />
      </section>

      <DoorPanel doors={investor.doors} />
    </aside>
  );
}
