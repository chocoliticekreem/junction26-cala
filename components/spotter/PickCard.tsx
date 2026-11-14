"use client";

import { useState } from "react";
import { roundLabel, sectorColor, sectorLabel } from "./format";
import type { SpotterPick } from "./types";

type Props = { pick: SpotterPick; rank: number; onClose: () => void };

const SCORE_ROWS: { key: keyof SpotterPick["scores"]; label: string; accent?: boolean }[] = [
  { key: "fit", label: "Fit to you" },
  { key: "shape", label: "Path shape" },
  { key: "unicornOdds", label: "Unicorn odds" },
  { key: "youOnPath", label: "You on path", accent: true },
];

export default function PickCard({ pick, rank, onClose }: Props) {
  const [watching, setWatching] = useState(false);
  const [open, setOpen] = useState<"file" | "co" | null>(null);
  const color = sectorColor(pick.company.sector);
  const c = pick.company;

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
        <div className="flex items-start gap-2">
          <div className="sp-detail-score font-mono">
            {pick.scores.total}
            <small>total</small>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
      </div>

      <div className="sp-block">
        <h3>
          Precedents
          <span className="muted">
            same depth · n={pick.sampleSize}
            {pick.lowConfidence && (
              <span className="sp-lowconf" title={`Low confidence: only ${pick.sampleSize} comparable paths`} data-testid="spotter-lowconf">
                {" "}
                <i aria-hidden>!</i> low
              </span>
            )}
          </span>
        </h3>
        <div className="sp-precedents" data-testid="spotter-precedents">
          {pick.precedents.map((p) => (
            <span key={p.id} className={`sp-precedent ${p.outcome === "stalled" ? "is-stalled" : ""}`} title={p.steps.join(" → ")}>
              {p.outcome === "stalled" ? "⚠ " : ""}
              {p.name}
              <small>
                {p.steps.length} step{p.steps.length === 1 ? "" : "s"}
                {p.outcome === "stalled" ? " · stalled" : ""}
              </small>
            </span>
          ))}
          {pick.precedents.length === 0 && <span className="muted text-[12px]">No precedent at this depth yet.</span>}
        </div>
        <p className="sp-steps">
          {pick.line}
          <br />
          Its path: {c.path}
        </p>
      </div>

      <div className="sp-block">
        <h3>Scores</h3>
        <div className="sp-scores">
          {SCORE_ROWS.map((row) => (
            <div key={row.key} className="sp-bar">
              <span>{row.label}</span>
              <i>
                <b style={{ width: `${pick.scores[row.key]}%`, background: row.accent ? "#FF6A3D" : "rgb(233 236 244 / 0.55)" }} />
              </i>
              <span className="font-mono">{pick.scores[row.key]}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="sp-block">
        <h3>Act</h3>
        <div className="sp-actions">
          <button type="button" className={`sp-action ${open === "file" ? "is-on" : ""}`} onClick={() => setOpen((o) => (o === "file" ? null : "file"))}>
            <b>Company file</b>
            <small>{c.investors.length} investors on record</small>
          </button>
          <button type="button" className={`sp-action ${open === "co" ? "is-on" : ""}`} onClick={() => setOpen((o) => (o === "co" ? null : "co"))} data-testid="spotter-coinvestors">
            <b>Shared co-investors</b>
            <small>{pick.actions.sharedCoInvestors.length ? pick.actions.sharedCoInvestors.join(", ") : "none yet"}</small>
          </button>
          <button type="button" className={`sp-action is-primary ${watching ? "is-on" : ""}`} onClick={() => setWatching((w) => !w)} aria-pressed={watching} data-testid="spotter-watch">
            <b>{watching ? "Watching" : "Watch"}</b>
            <small>{watching ? "next round pings you" : "ping me on the next round"}</small>
          </button>
        </div>
        {open === "file" && (
          <div className="sp-meta-row">
            {c.city && <span>{c.city}</span>}
            <span>{roundLabel(c.latestRound)}</span>
            {c.investors.map((n) => (
              <span key={n}>{n}</span>
            ))}
          </div>
        )}
        {open === "co" && (
          <div className="sp-meta-row">
            {pick.actions.sharedCoInvestors.length ? pick.actions.sharedCoInvestors.map((n) => <span key={n}>{n}</span>) : <span>No shared co-investor yet.</span>}
          </div>
        )}
      </div>
    </aside>
  );
}
