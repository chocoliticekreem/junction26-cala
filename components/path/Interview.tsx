"use client";

import { useState } from "react";
import ProfileChips from "../ProfileChips";
import type { TranscriptToken } from "@/lib/usePitch";
import type { FounderProfile } from "@/lib/types";
import type { CompanyCandidate } from "./types";

export type InterviewStep = "company" | "pitch" | "vision";

export type InterviewProps = {
  step: InterviewStep;
  companyName: string;
  onCompanyName: (v: string) => void;
  candidates: CompanyCandidate[];
  // Candidate the resolve route says can be picked without asking (website or sole exact-name match).
  autoPick?: string;
  resolving: boolean;
  resolveError?: string;
  onPick: (c: CompanyCandidate | null) => void;
  company?: CompanyCandidate;
  pitchTokens: TranscriptToken[];
  pitchText: string;
  onPitchText: (v: string) => void;
  profile: FounderProfile;
  triggers: Record<string, string>;
  micState: "idle" | "listening" | "unsupported";
  onMic: () => void;
  onReplay: () => void;
  replaying: boolean;
  onNext: () => void;
  visionTokens: TranscriptToken[];
  visionText: string;
  onVisionText: (v: string) => void;
  visionMicState: "idle" | "listening" | "unsupported";
  onVisionMic: () => void;
  // The engine's keyword read of the vision (lib/sim/vision); the run's visionBasis replaces it.
  visionTarget?: string;
  onSimulate: () => void;
};

const VISION_EXAMPLES = ["We become a unicorn", "Series B with 80 people", "£10m ARR, profitable"];

function Words({ tokens, placeholder }: { tokens: TranscriptToken[]; placeholder: string }) {
  const words = tokens.flatMap((t) => t.text.split(/\s+/).filter(Boolean).map((w) => ({ w, final: t.final })));
  if (!words.length) return <p className="path-words is-empty">{placeholder}</p>;
  const cutoff = words.length - 6;
  return (
    <p className="path-words" aria-live="polite">
      {words.map((x, i) => (
        <span key={i} className={i >= cutoff ? "is-new" : x.final ? "" : "is-interim"}>
          {x.w}{" "}
        </span>
      ))}
    </p>
  );
}

export default function Interview(p: InterviewProps) {
  const [typingPref, setTyping] = useState<boolean | undefined>();
  const [visionTypingPref, setVisionTyping] = useState<boolean | undefined>();
  const typing = typingPref ?? p.micState === "unsupported";
  const visionTyping = visionTypingPref ?? p.visionMicState === "unsupported";

  const name = p.company?.name || p.companyName.trim() || "your company";
  const heard = Object.keys(p.profile.sectors).length > 0 || !!p.profile.stage || p.pitchTokens.length > 0 || p.pitchText.trim().length > 0;
  const visionSpoken = p.visionTokens.map((t) => t.text).join(" ");
  const vision = p.visionText.trim() || visionSpoken.trim();

  return (
    <div className="path-interview" data-testid="interview" data-step={p.step}>
      {p.step === "company" && (
        <div className="path-q path-q-company">
          <p className="hero-kicker">Room · Path</p>
          <h1 className="path-title">Where does your company go from here?</h1>
          <p className="path-sub">Say your pitch and your five-year vision. Room simulates thousands of futures through real London rounds.</p>
          <form
            className="path-company-form"
            onSubmit={(e) => {
              e.preventDefault();
              const auto = p.candidates.find((c) => c.calaId === p.autoPick);
              if (auto) p.onPick(auto);
              else if (p.candidates[0]) p.onPick(p.candidates[0]);
              else if (!p.resolving) p.onPick(null);
            }}
          >
            <input
              className="path-input"
              value={p.companyName}
              onChange={(e) => p.onCompanyName(e.target.value)}
              placeholder="Company name (if it exists)"
              autoFocus
              data-testid="company-name"
              aria-label="Company name"
            />
            <button type="button" className="hero-btn" onClick={() => p.onPick(null)} data-testid="not-listed">
              Not listed / early idea
            </button>
          </form>
          {(p.candidates.length > 0 || p.resolving || p.resolveError) && (
            <div className="path-candidates" data-testid="candidates">
              <p className="path-candidates-head">{p.resolving ? "Looking in Cala's graph…" : p.resolveError ? p.resolveError : "Is this you?"}</p>
              {p.resolveError && !p.resolving && (
                <p className="muted path-candidates-hint" data-testid="resolve-error">
                  Continue without a Cala match: Room starts from your pitch instead.
                </p>
              )}
              <ul>
                {p.candidates.map((c) => (
                  <li key={c.calaId}>
                    <button type="button" className={`path-candidate ${c.calaId === p.autoPick ? "is-auto" : ""}`} onClick={() => p.onPick(c)} data-testid="candidate">
                      <span className="path-candidate-name">{c.name}</span>
                      <span className="path-candidate-meta muted">{[c.hq, c.foundingDate].filter(Boolean).join(" · ")}</span>
                      {c.description && <span className="path-candidate-desc">{c.description}</span>}
                      <span className="path-candidate-conf font-mono" title={`Matched on ${c.confidence.replace("_", " + ")}`}>
                        {c.calaId === p.autoPick ? "match" : c.confidence.replace("_", "+")}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!p.resolving && !p.resolveError && p.candidates.length === 0 && p.companyName.trim().length >= 2 && (
            <p className="muted path-candidates-hint" data-testid="no-candidates">
              Not in Cala&apos;s graph. Press Enter to continue from your pitch.
            </p>
          )}
        </div>
      )}

      {p.step === "pitch" && (
        <div className="path-q">
          <p className="hero-kicker">1 / 2</p>
          <h1 className="path-title">Tell us what {name} does.</h1>
          {p.company && (
            <p className="path-found" data-testid="company-found">
              Found <b>{p.company.name}</b> in Cala&apos;s graph
              {p.company.foundingDate && <> · founded {p.company.foundingDate.slice(0, 4)}</>}
              {p.company.hq && <> · {p.company.hq}</>}
            </p>
          )}
          <div className="path-listen">
            <Words tokens={p.pitchTokens} placeholder={p.micState === "listening" ? "Listening…" : "Press the mic and speak, or type."} />
            {typing && <textarea className="path-textarea" value={p.pitchText} onChange={(e) => p.onPitchText(e.target.value)} placeholder="Type the pitch" rows={3} data-testid="pitch-text" autoFocus />}
          </div>
          <div className="path-chips">
            <ProfileChips profile={p.profile} triggers={p.triggers} />
          </div>
          <div className="hero-actions">
            <button type="button" className={`hero-btn ${p.micState === "listening" ? "is-live" : ""}`} onClick={p.onMic} disabled={p.micState === "unsupported"} data-testid="mic">
              <i aria-hidden /> {p.micState === "listening" ? "Listening" : "Speak"}
            </button>
            <button type="button" className="hero-btn" onClick={() => setTyping(!typing)}>
              Type
            </button>
            <button type="button" className={`hero-btn ${p.replaying ? "is-busy" : ""}`} onClick={p.onReplay} data-testid="replay">
              Replay demo pitch
            </button>
            <button type="button" className="hero-btn hero-btn-primary" onClick={p.onNext} disabled={!heard} data-testid="next">
              Next
            </button>
          </div>
        </div>
      )}

      {p.step === "vision" && (
        <div className="path-q">
          <p className="hero-kicker">2 / 2</p>
          <h1 className="path-title">Where is {name} in five years?</h1>
          <div className="path-listen">
            <Words tokens={p.visionTokens} placeholder={p.visionMicState === "listening" ? "Listening…" : "Say it, or pick an example."} />
            {visionTyping && <textarea className="path-textarea" value={p.visionText} onChange={(e) => p.onVisionText(e.target.value)} placeholder="In 5 years, the company is…" rows={2} data-testid="vision-text" autoFocus />}
          </div>
          <div className="path-examples">
            {VISION_EXAMPLES.map((ex) => (
              <button key={ex} type="button" className="chip path-example" onClick={() => p.onVisionText(ex)} data-testid="vision-example">
                <span className="chip-value">{ex}</span>
              </button>
            ))}
          </div>
          {vision && p.visionTarget && (
            <p className="path-vision-basis" data-testid="vision-basis">
              <b>{p.visionTarget}</b>
              <span className="muted"> · the run states how it is judged</span>
            </p>
          )}
          <div className="hero-actions">
            <button type="button" className={`hero-btn ${p.visionMicState === "listening" ? "is-live" : ""}`} onClick={p.onVisionMic} disabled={p.visionMicState === "unsupported"} data-testid="vision-mic">
              <i aria-hidden /> {p.visionMicState === "listening" ? "Listening" : "Speak"}
            </button>
            <button type="button" className="hero-btn" onClick={() => setVisionTyping(!visionTyping)}>
              Type
            </button>
            <button type="button" className="hero-btn hero-btn-primary" onClick={p.onSimulate} disabled={!vision} data-testid="simulate">
              Simulate
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
