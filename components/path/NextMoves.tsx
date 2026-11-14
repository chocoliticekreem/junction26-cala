"use client";

import { useEffect, useState } from "react";
import { STAGE_LABELS } from "@/lib/taxonomy";
import { calaEntityHref, errorMessage, fetchActions, fetchFeed, watchInvestor } from "./api";
import type { Decision, DecisionNode, FeedItem, InvestorAction } from "./types";

export type NextMovesProps = {
  tree: DecisionNode;
  selected?: Decision;
  onSelect: (d?: Decision) => void;
  leadIds: string[];
  // Store id of the built company file; the action and watch routes read it. Undefined until built.
  docId?: string;
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

function Action({ card, onWatch, watched }: { card: InvestorAction; onWatch: (c: InvestorAction) => void; watched: boolean }) {
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
        {card.leadPartner && <span className="muted">{card.leadPartner.name}</span>}
        {card.events?.map((e) => (
          <span key={e.id} className="path-event" title={e.date ? `${e.name} · ${e.date}` : e.name}>
            ▦ {e.name}
          </span>
        ))}
        {card.precedent && (
          <a
            className="path-precedent-chip"
            href={card.precedent.companyCalaId ? calaEntityHref(card.precedent.companyCalaId) : undefined}
            target="_blank"
            rel="noreferrer"
            title={`${card.precedent.led ? "Led" : "Joined"} ${card.precedent.company}'s ${card.precedent.round}${card.precedent.date ? ` · ${card.precedent.date}` : ""}`}
          >
            {card.precedent.company}
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
        <button type="button" className={`btn ${watched ? "is-busy" : ""}`} onClick={() => onWatch(card)} disabled={watched}>
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

const fmtAmount = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M` : `$${Math.round(n / 1e3)}k`);

function feedLine(e: FeedItem): string {
  const verb = e.led === true ? "led" : e.led === false ? "joined" : "was in";
  const round = e.round === "unknown" ? "a round" : `the ${STAGE_LABELS[e.round]}`;
  return `${e.investorName} ${verb} ${round} of ${e.company}${e.amountUsd ? ` (${fmtAmount(e.amountUsd)})` : ""}`;
}

type Leads = { key: string; actions: InvestorAction[]; unknown: string[]; error?: string };

export default function NextMoves({ tree, selected, onSelect, leadIds, docId }: NextMovesProps) {
  const [leads, setLeads] = useState<Leads | undefined>();
  const [watched, setWatched] = useState<InvestorAction[]>([]);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [feedError, setFeedError] = useState<string | undefined>();
  const branches = [...tree.children].sort((a, b) => b.reachVisionShare - a.reachVisionShare);
  const leadKey = leadIds.join("|");
  const key = `${docId ?? ""}#${leadKey}`;

  useEffect(() => {
    let alive = true;
    const ids = leadKey ? leadKey.split("|") : [];
    if (!ids.length || !docId) return;
    fetchActions(docId, ids).then(
      (r) => alive && setLeads({ key, actions: r.actions, unknown: r.unknown }),
      (e) => alive && setLeads({ key, actions: [], unknown: ids, error: errorMessage(e) }),
    );
    return () => {
      alive = false;
    };
  }, [key, leadKey, docId]);

  // Stale answers (from a previous branch or reality) are not shown while the new one loads.
  const current = leads?.key === key ? leads : undefined;
  const actions = current?.actions ?? [];
  const unknown = current?.unknown ?? [];
  const actionsError = current?.error;
  const leadsLoading = leadIds.length > 0 && !!docId && !current;

  const watch = async (card: InvestorAction) => {
    if (!docId) return;
    setWatched((w) => (w.some((x) => x.investorId === card.investorId) ? w : [...w, card]));
    setFeedError(undefined);
    try {
      await watchInvestor(docId, card.investorId);
      setFeed(await fetchFeed(docId));
    } catch (e) {
      setFeedError(errorMessage(e));
    }
  };

  const leadsSection = leadIds.length > 0 && !!docId;
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
      {leadsSection && (
        <header className="path-section-head path-section-sub">
          <span>Leads on this path</span>
          {unknown.length > 0 && actions.length > 0 && <span className="muted">{unknown.length} without an investor file</span>}
        </header>
      )}
      {leadsSection && actionsError && (
        <p className="muted path-empty" role="status" data-testid="actions-error">
          {actionsError}
        </p>
      )}
      {leadsSection && !actionsError && actions.length === 0 && (
        <p className="muted path-empty" data-testid={leadsLoading ? "actions-loading" : "actions-empty"}>
          {leadsLoading ? "Loading…" : "No investor file for these leads yet; their rounds are in Cala, the outreach file is not."}
        </p>
      )}
      {actions.length > 0 && (
        <ul className="path-actions">
          {actions.map((a) => (
            <Action key={a.investorId} card={a} onWatch={watch} watched={watched.some((w) => w.investorId === a.investorId)} />
          ))}
        </ul>
      )}
      {watched.length > 0 && (
        <div className="path-feed" data-testid="watch-feed">
          <header className="path-section-head path-section-sub">
            <span>Watching {watched.length}</span>
            <span className="muted">in-app alerts (email digest coming)</span>
          </header>
          <ul>
            {feedError && <li className="muted">{feedError}</li>}
            {!feedError && feed.length === 0 && <li className="muted">Nothing since the cohort cut-off</li>}
            {feed.map((e, i) => (
              <li key={i}>
                <span className="font-mono muted">{e.date}</span> {feedLine(e)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
