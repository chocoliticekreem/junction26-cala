"use client";

import { useEffect, useRef, useState } from "react";
import type { SavedCompany } from "@/lib/myCompanies";
import type { TranscriptToken } from "@/lib/usePitch";
import type { CompanyCandidate } from "./types";

export type InterviewStep = "company" | "pitch" | "vision" | "ready";
export type CompanyMode = "existing" | "new";

type MicState = "idle" | "listening" | "unsupported";

export type InterviewProps = {
  step: InterviewStep;
  busy: boolean;
  mode: CompanyMode;
  onMode: (m: CompanyMode) => void;
  companyName: string;
  onCompanyName: (v: string) => void;
  website: string;
  onWebsite: (v: string) => void;
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
  // The engine's short read of the vision ("Unicorn · 5 yrs"); the run's visionBasis replaces it.
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

// What the company field says under itself: the resolve state in one line, or the "Is this you?"
// picker when Cala has several matches.
function CompanyStatus(p: InterviewProps) {
  const several = p.candidates.length > 1 && !p.picked;
  const changeable = p.candidates.length > 1 && p.picked;
  if (p.mode === "new") return null;
  if (p.resolving) return <p className="path-line muted">Looking in Cala&apos;s graph…</p>;
  if (p.resolveError) {
    return (
      <p className="path-line muted" data-testid="resolve-error">
        {p.resolveError} · starting from your pitch instead
      </p>
    );
  }
  if (several) {
    return (
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
    );
  }
  if (p.company) {
    return (
      <p className="path-line" data-testid="company-found">
        Found <b>{p.company.name}</b> in Cala
        {p.company.foundingDate && <> · {p.company.foundingDate.slice(0, 4)}</>}
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
    );
  }
  if (changeable) {
    return (
      <p className="path-line muted" data-testid="company-none">
        Starting from your pitch{" "}
        <button type="button" className="path-link" onClick={p.onChangeCompany} data-testid="change-company">
          Change
        </button>
      </p>
    );
  }
  if (p.candidates.length === 0 && p.companyName.trim().length >= 2) {
    return (
      <p className="path-line muted" data-testid="no-candidates">
        New to Cala&apos;s graph · starting from your pitch{p.website.trim() ? " and website" : ""}
      </p>
    );
  }
  return null;
}

export default function Interview(p: InterviewProps) {
  const [focused, setFocused] = useState(false);
  const [siteOpen, setSiteOpen] = useState(false);
  const fieldRef = useRef<HTMLDivElement>(null);

  // A website that arrived with a saved company stays visible; the link only hides an empty field.
  const showSite = p.mode === "existing" && (siteOpen || p.website.trim().length > 0);

  useEffect(() => {
    if (!focused) return;
    const close = (e: PointerEvent) => {
      if (!fieldRef.current?.contains(e.target as Node)) setFocused(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [focused]);

  const typed = p.companyName.trim().toLowerCase();
  const recent = p.saved.filter((s) => !typed || (s.name.toLowerCase().startsWith(typed) && s.name.toLowerCase() !== typed));
  const menuOpen = focused && recent.length > 0;
  const name = p.company?.name || p.companyName.trim();
  const visionSpoken = p.visionTokens.map((t) => t.text).join(" ").trim();
  // A run that starts mid-lookup would miss the Cala match; the button waits for the answer.
  const canSimulate = p.step === "ready" && !p.busy && !p.resolving;

  return (
    <form
      className="fx-cta"
      data-testid="interview"
      data-step={p.step}
      onSubmit={(e) => {
        e.preventDefault();
        if (canSimulate) p.onSimulate();
      }}
    >
      <div className="path-field" data-testid="field-company">
        <div className="fx-field-head">
          <div className="fx-seg" role="radiogroup" aria-label="Company">
            <button type="button" role="radio" aria-checked={p.mode === "existing"} className={p.mode === "existing" ? "is-active" : ""} onClick={() => p.onMode("existing")} data-testid="mode-existing">
              Existing company
            </button>
            <button type="button" role="radio" aria-checked={p.mode === "new"} className={p.mode === "new" ? "is-active" : ""} onClick={() => p.onMode("new")} data-testid="mode-new">
              New idea
            </button>
          </div>
          {p.mode === "existing" && !showSite && (
            <button type="button" className="path-link" onClick={() => setSiteOpen(true)} data-testid="add-website">
              add website
            </button>
          )}
        </div>
        <div className="path-field-row" ref={fieldRef}>
          <input
            id="company-name"
            className="path-input"
            value={p.companyName}
            onChange={(e) => {
              p.onCompanyName(e.target.value);
              setFocused(true);
            }}
            onFocus={() => setFocused(true)}
            placeholder={p.mode === "existing" ? "Company name" : "Name your idea (optional)"}
            aria-label={p.mode === "existing" ? "Company name" : "Idea name"}
            autoComplete="off"
            autoFocus
            data-testid="company-name"
          />
          {showSite && (
            <input
              className="path-input path-input-site"
              value={p.website}
              onChange={(e) => p.onWebsite(e.target.value)}
              placeholder="website, e.g. cala.ai"
              aria-label="Website (optional)"
              autoComplete="off"
              spellCheck={false}
              autoFocus={siteOpen}
              data-testid="company-website"
            />
          )}
          {menuOpen && (
            <ul className="path-dropdown glass" role="listbox" aria-label="Recent companies" data-testid="my-companies-menu">
              <li className="path-dropdown-head muted">Recent</li>
              {recent.map((s) => (
                <li key={s.name}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      p.onLoadSaved(s);
                      setFocused(false);
                    }}
                    data-testid="my-company"
                  >
                    <b>{s.name}</b>
                    <span className="muted">{s.candidate ? "in Cala" : s.website ? s.website : "from pitch"}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <CompanyStatus {...p} />
      </div>

      <div className="path-field" data-testid="field-pitch">
        <label className="path-label" htmlFor="pitch-text">
          Pitch
        </label>
        <div className={`path-area ${p.micState === "listening" ? "is-live" : ""}`}>
          <textarea
            id="pitch-text"
            className="path-textarea"
            value={p.pitchText}
            onChange={(e) => p.onPitchText(e.target.value)}
            placeholder={p.micState === "listening" ? "Listening…" : `What ${name || "you"} ${name ? "does" : "do"}, for whom, and where you are.`}
            rows={2}
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
          In five years
        </label>
        <div className={`path-area path-area-line ${p.visionMicState === "listening" ? "is-live" : ""}`}>
          <input
            id="vision-text"
            className="path-textarea"
            value={p.visionText}
            onChange={(e) => p.onVisionText(e.target.value)}
            placeholder={p.visionMicState === "listening" ? "Listening…" : visionSpoken || "We are…"}
            data-testid="vision-text"
          />
          <MicButton state={p.visionMicState} onClick={p.onVisionMic} testId="vision-mic" />
        </div>
        <div className="fx-vision-foot">
          <div className="path-examples">
            {VISION_EXAMPLES.map((ex) => (
              <button key={ex} type="button" className="chip path-example" onClick={() => p.onVisionText(ex)} data-testid="vision-example">
                <span className="chip-value">{ex}</span>
              </button>
            ))}
          </div>
          {p.visionTarget && (
            <p className="path-line" data-testid="vision-basis">
              <span className="muted">Read as</span> {p.visionTarget}
            </p>
          )}
        </div>
      </div>

      <div className="path-cta-actions">
        <button type="submit" className={`hero-btn hero-btn-primary path-simulate ${p.busy ? "is-busy" : ""}`} disabled={!canSimulate} data-testid="simulate">
          {p.busy ? "Simulating…" : "Simulate"}
        </button>
      </div>
    </form>
  );
}
