"use client";

import { useState } from "react";
import ProfileChips from "../ProfileChips";
import type { TranscriptToken } from "@/lib/usePitch";
import type { FounderProfile } from "@/lib/types";
import type { CompanyCandidate, CompanyState } from "./types";

export type InterviewStep = "company" | "pitch" | "vision";

export type InterviewProps = {
  step: InterviewStep;
  companyName: string;
  onCompanyName: (v: string) => void;
  candidates: CompanyCandidate[];
  resolving: boolean;
  onPick: (c: CompanyCandidate | null) => void;
  company?: CompanyState;
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
  visionBasis?: string;
  onSimulate: () => void;
  demo: boolean;
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
              if (p.candidates[0]) p.onPick(p.candidates[0]);
              else if (!p.companyName.trim()) p.onPick(null);
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
          {(p.candidates.length > 0 || p.resolving) && (
            <div className="path-candidates" data-testid="candidates">
              <p className="path-candidates-head">
                {p.resolving ? "Looking in Cala's graph…" : "Is this you?"}
                {p.demo && <span className="path-demo-tag">demo data</span>}
              </p>
              <ul>
                {p.candidates.map((c) => (
                  <li key={c.calaId}>
                    <button type="button" className="path-candidate" onClick={() => p.onPick(c)} data-testid="candidate">
                      <span className="path-candidate-name">{c.name}</span>
                      <span className="path-candidate-meta muted">{[c.hq, c.foundingDate].filter(Boolean).join(" · ")}</span>
                      {c.description && <span className="path-candidate-desc">{c.description}</span>}
                      <span className="path-candidate-conf font-mono">{Math.round(c.confidence * 100)}%</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {p.step === "pitch" && (
        <div className="path-q">
          <p className="hero-kicker">1 / 2</p>
          <h1 className="path-title">Tell us what {name} does.</h1>
          {p.company?.found && (
            <p className="path-found" data-testid="company-found">
              Found <b>{p.company.name}</b> in Cala&apos;s graph
              {p.company.founded && <> · founded {p.company.founded}</>}
              {p.company.hq && <> · {p.company.hq}</>}
              {p.company.backers.length > 0 && <> · backed by {p.company.backers.map((b) => b.name).join(", ")}</>}
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
          {vision && p.visionBasis && (
            <p className="path-vision-basis" data-testid="vision-basis">
              <b>{p.visionBasis.split(".")[0]}</b>
              <span className="muted" title={p.visionBasis}>
                {" "}
                · how it is judged
              </span>
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
