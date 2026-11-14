"use client";

import { useEffect, useRef, useState } from "react";
import type { SavedCompany } from "@/lib/myCompanies";
import type { TranscriptToken } from "@/lib/usePitch";
import type { CompanyCandidate } from "./types";

export type InterviewStep = "company" | "pitch" | "vision" | "ready";

type MicState = "idle" | "listening" | "unsupported";

export type InterviewProps = {
  step: InterviewStep;
  busy: boolean;
  companyName: string;
  onCompanyName: (v: string) => void;
  candidates: CompanyCandidate[];
  // Candidate the resolve route says can be picked without asking (website or sole exact-name match).
  autoPick?: string;
  resolving: boolean;
  resolveError?: string;
  company: CompanyCandidate | null;
  // The founder confirmed one of several candidates (or none); the list collapses to one line.
  picked: boolean;
  onPick: (c: CompanyCandidate | null) => void;
  onChangeCompany: () => void;
  saved: SavedCompany[];
  onLoadSaved: (s: SavedCompany) => void;
  onNewCompany: () => void;
  pitchTokens: TranscriptToken[];
  pitchText: string;
  onPitchText: (v: string) => void;
  // One short line: what the engine read from the pitch so far.
  pitchRead?: string;
  micState: MicState;
  onMic: () => void;
  onReplay: () => void;
  replaying: boolean;
  visionTokens: TranscriptToken[];
  visionText: string;
  onVisionText: (v: string) => void;
  visionMicState: MicState;
  onVisionMic: () => void;
  // The engine's keyword read of the vision (lib/sim/vision); the run's visionBasis replaces it.
  visionTarget?: string;
  onSimulate: () => void;
};

const VISION_EXAMPLES = ["We become a unicorn", "Series B with 80 people", "£10m ARR, profitable"];

// Spoken words flow inside the input area itself, interim ones dimmed, the newest brightest.
function Words({ tokens }: { tokens: TranscriptToken[] }) {
  const words = tokens.flatMap((t) => t.text.split(/\s+/).filter(Boolean).map((w) => ({ w, final: t.final })));
  if (!words.length) return null;
  const cutoff = words.length - 6;
  return (
    <p className="path-words" aria-live="polite" data-testid="spoken-words">
      {words.map((x, i) => (
        <span key={i} className={i >= cutoff ? "is-new" : x.final ? "" : "is-interim"}>
          {x.w}{" "}
        </span>
      ))}
    </p>
  );
}

function MicButton({ state, onClick, testId }: { state: MicState; onClick: () => void; testId: string }) {
  return (
    <button
      type="button"
      className={`path-mic ${state === "listening" ? "is-live" : ""}`}
      onClick={onClick}
      disabled={state === "unsupported"}
      title={state === "unsupported" ? "Speech recognition needs Chrome" : state === "listening" ? "Stop listening" : "Speak"}
      aria-label={state === "listening" ? "Stop listening" : "Speak"}
      data-testid={testId}
    >
      <i aria-hidden />
      {state === "listening" ? "Listening" : "Speak"}
    </button>
  );
}

export default function Interview(p: InterviewProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menuOpen]);

  const name = p.company?.name || p.companyName.trim();
  const several = p.candidates.length > 1 && !p.picked;
  const changeable = p.candidates.length > 1 && p.picked;
  const visionSpoken = p.visionTokens.map((t) => t.text).join(" ").trim();
  const canSimulate = p.step === "ready" && !p.busy;

  return (
    <section className="path-hero" data-testid="interview" data-step={p.step}>
      <div className="path-q">
        <p className="hero-kicker">Scalaxy · founder path</p>
        <h1 className="path-title">Where does {name || "your company"} go from here?</h1>
        <p className="path-sub">Thousands of futures, simulated through real rounds in Cala&apos;s graph.</p>
      </div>

      <form
        className="path-cta glass"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSimulate) p.onSimulate();
        }}
      >
        <div className="path-field" data-testid="field-company">
          <label className="path-label" htmlFor="company-name">
            Your company
          </label>
          <div className="path-field-row" ref={menuRef}>
            <input
              id="company-name"
              className="path-input"
              value={p.companyName}
              onChange={(e) => p.onCompanyName(e.target.value)}
              placeholder="Company name"
              autoComplete="off"
              autoFocus
              data-testid="company-name"
            />
            <button
              type="button"
              className={`path-dropdown-btn ${menuOpen ? "is-open" : ""}`}
              onClick={() => setMenuOpen((v) => !v)}
              aria-haspopup="listbox"
              aria-expanded={menuOpen}
              title="My companies"
              data-testid="my-companies"
            >
              My companies
              <i aria-hidden />
            </button>
            {menuOpen && (
              <ul className="path-dropdown glass" role="listbox" aria-label="My companies" data-testid="my-companies-menu">
                {p.saved.map((s) => (
                  <li key={s.name}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={s.name.toLowerCase() === p.companyName.trim().toLowerCase()}
                      onClick={() => {
                        p.onLoadSaved(s);
                        setMenuOpen(false);
                      }}
                      data-testid="my-company"
                    >
                      <b>{s.name}</b>
                      <span className="muted">{s.candidate ? "in Cala" : "from pitch"}</span>
                    </button>
                  </li>
                ))}
                <li>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    className="path-dropdown-new"
                    onClick={() => {
                      p.onNewCompany();
                      setMenuOpen(false);
                    }}
                    data-testid="new-company"
                  >
                    + New company
                  </button>
                </li>
              </ul>
            )}
          </div>
          {p.resolving && <p className="path-line muted">Looking in Cala&apos;s graph…</p>}
          {!p.resolving && p.resolveError && (
            <p className="path-line muted" data-testid="resolve-error">
              {p.resolveError} · starting from your pitch instead
            </p>
          )}
          {!p.resolving && !p.resolveError && p.company && !several && (
            <p className="path-line" data-testid="company-found">
              Found <b>{p.company.name}</b> in Cala
              {p.company.foundingDate && <> · founded {p.company.foundingDate.slice(0, 4)}</>}
              {p.company.hq && <> · {p.company.hq}</>}
              {changeable && (
                <>
                  {" "}
                  <button type="button" className="path-link" onClick={p.onChangeCompany} data-testid="change-company">
                    Change
                  </button>
                </>
              )}
            </p>
          )}
          {!p.resolving && !p.resolveError && !p.company && changeable && (
            <p className="path-line muted" data-testid="company-none">
              Starting from your pitch{" "}
              <button type="button" className="path-link" onClick={p.onChangeCompany} data-testid="change-company">
                Change
              </button>
            </p>
          )}
          {!p.resolving && !p.resolveError && several && (
            <div className="path-candidates" data-testid="candidates">
              <p className="path-line muted">Is this you?</p>
              <ul>
                {p.candidates.map((c) => {
                  const on = c.calaId === p.company?.calaId;
                  return (
                    <li key={c.calaId}>
                      <button type="button" className={`path-candidate ${on ? "is-auto" : ""}`} onClick={() => p.onPick(c)} aria-pressed={on} data-testid="candidate">
                        <span className="path-candidate-name">{c.name}</span>
                        <span className="path-candidate-meta muted">{[c.hq, c.foundingDate?.slice(0, 4)].filter(Boolean).join(" · ")}</span>
                        <span className="path-candidate-conf font-mono">{on ? "selected" : c.calaId === p.autoPick ? "match" : c.confidence.replace("_", "+")}</span>
                      </button>
                    </li>
                  );
                })}
                <li>
                  <button type="button" className={`path-candidate ${p.company === null && p.candidates.length ? "is-none" : ""}`} onClick={() => p.onPick(null)} data-testid="not-listed">
                    <span className="path-candidate-name">None of these</span>
                    <span className="path-candidate-meta muted">start from the pitch</span>
                  </button>
                </li>
              </ul>
            </div>
          )}
          {!p.resolving && !p.resolveError && p.candidates.length === 0 && p.companyName.trim().length >= 2 && !p.company && (
            <p className="path-line muted" data-testid="no-candidates">
              Not in Cala&apos;s graph yet · starting from your pitch
            </p>
          )}
        </div>

        <div className="path-field" data-testid="field-pitch">
          <label className="path-label" htmlFor="pitch-text">
            Your pitch
          </label>
          <div className={`path-area ${p.micState === "listening" ? "is-live" : ""}`}>
            <textarea
              id="pitch-text"
              className="path-textarea"
              value={p.pitchText}
              onChange={(e) => p.onPitchText(e.target.value)}
              placeholder={p.micState === "listening" ? "Listening…" : "What you do, for whom, and where you are. Speak or type."}
              rows={3}
              data-testid="pitch-text"
            />
            <Words tokens={p.pitchTokens} />
            <div className="path-area-tools">
              <MicButton state={p.micState} onClick={p.onMic} testId="mic" />
              <button type="button" className={`path-link ${p.replaying ? "is-busy" : ""}`} onClick={p.onReplay} data-testid="replay">
                Replay demo pitch
              </button>
            </div>
          </div>
          {p.pitchRead && (
            <p className="path-line" data-testid="pitch-read">
              <span className="muted">Read as</span> {p.pitchRead}
            </p>
          )}
        </div>

        <div className="path-field" data-testid="field-vision">
          <label className="path-label" htmlFor="vision-text">
            Where are you in five years?
          </label>
          <div className={`path-area path-area-line ${p.visionMicState === "listening" ? "is-live" : ""}`}>
            <input
              id="vision-text"
              className="path-textarea"
              value={p.visionText}
              onChange={(e) => p.onVisionText(e.target.value)}
              placeholder={p.visionMicState === "listening" ? "Listening…" : visionSpoken || "In five years, we are…"}
              data-testid="vision-text"
            />
            <MicButton state={p.visionMicState} onClick={p.onVisionMic} testId="vision-mic" />
          </div>
          <div className="path-examples">
            {VISION_EXAMPLES.map((ex) => (
              <button key={ex} type="button" className="chip path-example" onClick={() => p.onVisionText(ex)} data-testid="vision-example">
                <span className="chip-value">{ex}</span>
              </button>
            ))}
          </div>
          {p.visionTarget && (
            <p className="path-line" data-testid="vision-basis">
              <span className="muted">Judged as</span> {p.visionTarget}
            </p>
          )}
        </div>

        <div className="path-cta-actions">
          <button type="submit" className={`hero-btn hero-btn-primary path-simulate ${p.busy ? "is-busy" : ""}`} disabled={!canSimulate} data-testid="simulate">
            {p.busy ? "Simulating…" : "Simulate"}
          </button>
          <span className="muted path-cta-hint">5,000 runs · real rounds · nothing invented</span>
        </div>
      </form>
    </section>
  );
}
