"use client";

import { useEffect, useState } from "react";
import { STAGE_LABELS } from "@/lib/taxonomy";
import { calaEntityHref, errorMessage, fetchActions } from "./api";
import { odds, vsTypical } from "./odds";
import type { Decision, DecisionNode, InvestorAction } from "./types";

export type NextMovesProps = {
  tree: DecisionNode;
  selected?: Decision;
  onSelect: (d?: Decision) => void;
  // Opens the case study of the real company closest to this branch; undefined when none fits.
  onCaseStudy?: (node: DecisionNode) => void;
  leadIds: string[];
  // Store id of the built company file; the action and watch routes read it. Undefined until built.
  docId?: string;
};

const sameDecision = (a?: Decision | null, b?: Decision | null) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function Branch({ node, selected, onSelect, onCaseStudy, depth }: { node: DecisionNode; selected?: Decision; onSelect: (d?: Decision) => void; onCaseStudy?: (node: DecisionNode) => void; depth: number }) {
  const isSel = !!node.decision && sameDecision(node.decision, selected);
  const [open, setOpen] = useState(false);
  // Older cached results have no nextRound: they fall back to the vision share.
  const headline = node.nextRound?.share ?? node.reachVisionShare;
  const rel = node.typical ? vsTypical(node.reachVisionShare, node.typical.reachVisionShare) : undefined;
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
        <b
          className="path-branch-share font-mono"
          title={node.nextRound ? `Runs on this branch that close a ${STAGE_LABELS[node.nextRound.stage]} round within the horizon${node.typical ? ` (typical company at this stage: ${odds(node.typical.nextRoundShare, node.runs)})` : ""}` : "Runs on this branch that reach the vision"}
        >
          {odds(headline, node.runs)}
        </b>
        <span className="path-branch-main">
          <span className="path-branch-label">{node.label}</span>
          <span className="path-branch-meta font-mono">
            {node.nextRound && <span>raises {STAGE_LABELS[node.nextRound.stage]}</span>}
            {node.nextRound && (
              <span title={`Runs that reach the vision; typical company at this stage: ${node.typical ? odds(node.typical.reachVisionShare, node.runs) : "n/a"}`}>
                vision {odds(node.reachVisionShare, node.runs)}
                {rel ? ` · ${rel}` : ""}
              </span>
            )}
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
        <i className="path-branch-bar" style={{ width: `${headline * 100}%` }} aria-hidden />
      </button>
      {(isSel || open) && (
        <div className="path-branch-detail">
          <div className="path-bands font-mono">
            <span title="Best simulated outcome">▲ {node.outcomeBands.best}</span>
            <span title="Median simulated outcome">● {node.outcomeBands.median}</span>
            <span title="Worst simulated outcome">▼ {node.outcomeBands.worst}</span>
            {onCaseStudy && (
              <button type="button" className="path-link path-case-btn" onClick={() => onCaseStudy(node)} data-testid="case-study">
                Case study
              </button>
            )}
          </div>
          <ol className="path-toppaths">
            {node.topPaths.slice(0, 3).map((p, i) => (
              <li key={i} className={p.reachedVision ? "" : "is-stalled"} title={p.reachedVision ? "Reached the vision" : `Stalled at ${p.stalledAtStage ? STAGE_LABELS[p.stalledAtStage] : "an earlier stage"}`}>
                <span className="font-mono muted">{odds(p.share, node.runs)}</span>
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
                <Branch key={c.label} node={c} selected={selected} onSelect={onSelect} onCaseStudy={onCaseStudy} depth={depth + 1} />
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

// One evidence chip per card: the precedent round the investor was in, else its next event.
function Evidence({ card }: { card: InvestorAction }) {
  if (card.precedent) {
    return (
      <a
        className="path-precedent-chip"
        href={card.precedent.companyCalaId ? calaEntityHref(card.precedent.companyCalaId) : undefined}
        target="_blank"
        rel="noreferrer"
        title={`${card.precedent.led ? "Led" : "Joined"} ${card.precedent.company}'s ${card.precedent.round}${card.precedent.date ? ` · ${card.precedent.date}` : ""}`}
      >
        {card.precedent.led ? "led" : "joined"} {card.precedent.company}
      </a>
    );
  }
  const e = card.events?.[0];
  if (e) {
    return (
      <span className="path-event" title={e.date ? `${e.name} · ${e.date}` : e.name}>
        ▦ {e.name}
      </span>
    );
  }
  return null;
}

function Action({ card }: { card: InvestorAction }) {
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
        <Evidence card={card} />
      </div>
      <div className="path-action-btns">
        <a className="btn is-primary" href={card.mailto} title={`${card.emailDraft.subject} · opens a draft in your mail app; nothing is sent`} data-testid="draft-intro">
          Draft intro
        </a>
        <button type="button" className="btn" onClick={copy} title="Copy the draft">
          {copied ? "Copied" : "Copy"}
        </button>
        <button type="button" className="btn" onClick={() => setShowSources((v) => !v)} aria-expanded={showSources}>
          Sources
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

type Leads = { key: string; actions: InvestorAction[]; unknown: string[]; error?: string };

export default function NextMoves({ tree, selected, onSelect, onCaseStudy, leadIds, docId }: NextMovesProps) {
  const [leads, setLeads] = useState<Leads | undefined>();
  const branches = [...tree.children].sort((a, b) => (b.nextRound?.share ?? 0) - (a.nextRound?.share ?? 0) || b.reachVisionShare - a.reachVisionShare);
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

  const leadsSection = leadIds.length > 0 && !!docId;
  return (
    <section className="path-moves" aria-label="Best next moves" data-testid="next-moves">
      <header className="path-section-head">
        <span>Next moves</span>
      </header>
      <ul className="path-branches" data-testid="tree">
        {branches.map((b) => (
          <Branch key={b.label} node={b} selected={selected} onSelect={onSelect} onCaseStudy={onCaseStudy} depth={1} />
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
            <Action key={a.investorId} card={a} />
          ))}
        </ul>
      )}
    </section>
  );
}
