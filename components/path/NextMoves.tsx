"use client";

import { useEffect, useState } from "react";
import { STAGE_LABELS } from "@/lib/taxonomy";
import { calaEntityHref, fetchActions, fetchFeed, watchInvestor } from "./api";
import type { ActionCard, Decision, DecisionNode, WatchEvent } from "./types";

export type NextMovesProps = {
  tree: DecisionNode;
  selected?: Decision;
  onSelect: (d?: Decision) => void;
  leadIds: string[];
  companyLabel: string;
  companyId: string;
};

const pct = (p: number) => `${Math.round(p * 100)}%`;
const sameDecision = (a?: Decision | null, b?: Decision | null) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function Branch({ node, selected, onSelect, depth }: { node: DecisionNode; selected?: Decision; onSelect: (d?: Decision) => void; depth: number }) {
  const isSel = !!node.decision && sameDecision(node.decision, selected);
  const [open, setOpen] = useState(false);
  return (
    <li className={`path-branch ${isSel ? "is-selected" : ""}`} data-testid="branch" data-depth={depth}>
      <button
        type="button"
        className="path-branch-row"
        onClick={() => {
          onSelect(isSel ? undefined : (node.decision ?? undefined));
          setOpen(true);
        }}
        aria-pressed={isSel}
      >
        <b className="path-branch-share font-mono">{pct(node.reachVisionShare)}</b>
        <span className="path-branch-main">
          <span className="path-branch-label">{node.label}</span>
          <span className="path-branch-meta font-mono">
            {node.medianMonthsToNextRound !== undefined && <span title="Median months to the next round">{node.medianMonthsToNextRound}mo</span>}
            <span className="path-n" title={`${node.sampleSize} real precedent transitions behind this branch`}>
              n={node.sampleSize}
            </span>
            {node.lowConfidence && (
              <span className="path-lowconf" title="Low confidence: fewer than 25 real transitions" aria-label="Low confidence">
                ◔
              </span>
            )}
          </span>
        </span>
        <i className="path-branch-bar" style={{ width: `${node.reachVisionShare * 100}%` }} aria-hidden />
      </button>
      {(isSel || open) && (
        <div className="path-branch-detail">
          <div className="path-bands font-mono">
            <span title="Best simulated outcome">▲ {node.outcomeBands.best}</span>
            <span title="Median simulated outcome">● {node.outcomeBands.median}</span>
            <span title="Worst simulated outcome">▼ {node.outcomeBands.worst}</span>
          </div>
          <ol className="path-toppaths">
            {node.topPaths.slice(0, 3).map((p, i) => (
              <li key={i} className={p.reachedVision ? "" : "is-stalled"} title={p.reachedVision ? "Reached the vision" : `Stalled at ${p.stalledAtStage ? STAGE_LABELS[p.stalledAtStage] : "an earlier stage"}`}>
                <span className="font-mono muted">{pct(p.share)}</span>
                {p.steps.map((s, j) => (
                  <span key={j} className="path-stepchip">
                    <b>{STAGE_LABELS[s.stage]}</b>
                    {s.leadName && <span>{s.leadName}</span>}
                    <span className="font-mono muted">m{s.monthFromStart}</span>
                  </span>
                ))}
                {!p.reachedVision && <span className="path-stall">stalls</span>}
              </li>
            ))}
          </ol>
          {node.children.length > 0 && (
            <ul className="path-branches path-branches-sub">
              {node.children.map((c) => (
                <Branch key={c.label} node={c} selected={selected} onSelect={onSelect} depth={depth + 1} />
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

function Action({ card, companyId, onWatch, watched }: { card: ActionCard; companyId: string; onWatch: (c: ActionCard) => void; watched: boolean }) {
  const [copied, setCopied] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${card.emailDraft.subject}\n\n${card.emailDraft.body}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setShowSources(true);
    }
  };
  return (
    <li className="path-action" data-testid="action-card">
      <div className="path-action-head">
        <b>{card.name}</b>
        {card.leadPartner && <span className="muted">{card.leadPartner}</span>}
        {card.events?.map((e) => (
          <span key={e.id} className="path-event" title={e.date ? `${e.name} · ${e.date}` : e.name}>
            ▦ {e.name}
          </span>
        ))}
        {card.precedent && (
          <a className="path-precedent-chip" href={calaEntityHref(card.precedent.companyId)} target="_blank" rel="noreferrer" title="A company they led that took this path">
            {card.precedent.name}
          </a>
        )}
      </div>
      <div className="path-action-btns">
        <button type="button" className="btn" onClick={copy} title={card.emailDraft.subject}>
          {copied ? "Copied" : "Copy email"}
        </button>
        <a className="btn" href={card.mailto} title="Opens a draft in your mail app; nothing is sent">
          Open in mail
        </a>
        <button type="button" className="btn" onClick={() => setShowSources((v) => !v)} aria-expanded={showSources}>
          Sources
        </button>
        <button type="button" className={`btn ${watched ? "is-busy" : ""}`} onClick={() => onWatch(card)} disabled={watched} data-company={companyId}>
          {watched ? "Watching" : "Watch"}
        </button>
      </div>
      {showSources && (
        <ul className="path-sources">
          {card.calaSources.map((s, i) => (
            <li key={i}>
              {s.url ? (
                <a href={s.url} target="_blank" rel="noreferrer">
                  {s.name}
                </a>
              ) : (
                s.name
              )}
            </li>
          ))}
          {card.website && (
            <li>
              <a href={card.website} target="_blank" rel="noreferrer">
                Website
              </a>
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

export default function NextMoves({ tree, selected, onSelect, leadIds, companyLabel, companyId }: NextMovesProps) {
  const [actions, setActions] = useState<ActionCard[]>([]);
  const [watched, setWatched] = useState<ActionCard[]>([]);
  const [feed, setFeed] = useState<WatchEvent[]>([]);
  const branches = [...tree.children].sort((a, b) => b.reachVisionShare - a.reachVisionShare);
  const leadKey = leadIds.join("|");

  useEffect(() => {
    let alive = true;
    const ids = leadKey ? leadKey.split("|") : [];
    void (ids.length ? fetchActions(companyId, ids, companyLabel) : Promise.resolve({ data: [] as ActionCard[] })).then((r) => alive && setActions(r.data));
    return () => {
      alive = false;
    };
  }, [leadKey, companyId, companyLabel]);

  const watch = async (card: ActionCard) => {
    setWatched((w) => (w.some((x) => x.investorId === card.investorId) ? w : [...w, card]));
    await watchInvestor(companyId, card.investorId);
    const names = [...watched, card].map((c) => c.name);
    const r = await fetchFeed(companyId, names);
    setFeed(r.data);
  };

  return (
    <section className="path-moves" aria-label="Best next moves" data-testid="next-moves">
      <header className="path-section-head">
        <span>Best next moves</span>
        <span className="muted">reach-vision share · months · n</span>
      </header>
      <ul className="path-branches" data-testid="tree">
        {branches.map((b) => (
          <Branch key={b.label} node={b} selected={selected} onSelect={onSelect} depth={1} />
        ))}
      </ul>
      {actions.length > 0 && (
        <>
          <header className="path-section-head path-section-sub">
            <span>Leads on this path</span>
          </header>
          <ul className="path-actions">
            {actions.map((a) => (
              <Action key={a.investorId} card={a} companyId={companyId} onWatch={watch} watched={watched.some((w) => w.investorId === a.investorId)} />
            ))}
          </ul>
        </>
      )}
      {watched.length > 0 && (
        <div className="path-feed" data-testid="watch-feed">
          <header className="path-section-head path-section-sub">
            <span>Watching {watched.length}</span>
            <span className="muted">in-app alerts (email digest coming)</span>
          </header>
          <ul>
            {feed.length === 0 && <li className="muted">Nothing yet</li>}
            {feed.map((e, i) => (
              <li key={i}>
                <span className="font-mono muted">{e.at}</span> {e.text}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
