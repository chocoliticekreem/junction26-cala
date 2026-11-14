"use client";

import { useEffect, useRef, useState } from "react";
import { KIND_COLOR, KIND_LABEL } from "./PathMap";
import type { InvestorKind, SimulateResponse } from "./types";

const KINDS: InvestorKind[] = ["fund", "angel", "accelerator", "cvc"];

// Every explanation the founder flow used to print inline lives behind this one (i): what the
// vision was judged as, where the evidence comes from, how many runs, the map legend.
export default function HowThisWorks({ result, vision, networkError }: { result?: SimulateResponse; vision: string; networkError?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  return (
    <div className="fx-how" ref={ref}>
      <button type="button" className={`btn fx-how-btn ${open ? "is-open" : ""}`} onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="dialog" title="How this works" data-testid="how-this-works">
        <i aria-hidden>i</i>
        How this works
      </button>
      {open && (
        <div className="fx-how-pop glass" role="dialog" aria-label="How this works" data-testid="how-popover">
          <section>
            <h3>Method</h3>
            <p className="font-mono" data-testid="honesty">
              {result ? (
                <>
                  Evidence from {result.tree.sampleSize} real rounds in Cala, not a forecast · {result.runs.toLocaleString()} runs · as of {result.asOf}
                </>
              ) : (
                <>5,000 runs through real rounds in Cala&apos;s graph. Nothing invented.</>
              )}
            </p>
            <p>Every simulated path is stitched from real round-to-round transitions of companies in the cohort. Each lead on a path led a real round of that shape.</p>
          </section>
          {result && (
            <section>
              <h3>Vision</h3>
              <p data-testid="vision-line" title={result.visionBasis.text}>
                <b>{result.vision.interpretation ?? result.visionBasis.text}</b>
                <span className="muted"> · {vision}</span>
                {result.analysis === "keyword_fallback" && (
                  <span className="muted path-fallback" data-testid="keyword-fallback" title={result.analysisDetail?.fallbackReasons?.join("; ") || "The AI reader was unavailable; keyword rules read the text."}>
                    {" "}
                    · keyword fallback
                  </span>
                )}
              </p>
              {result.vision.interpretation && <p className="muted">{result.visionBasis.text}</p>}
            </section>
          )}
          <section>
            <h3>Map</h3>
            <ul className="fx-legend" aria-label="Legend">
              {KINDS.map((k) => (
                <li key={k}>
                  <i style={{ background: KIND_COLOR[k] }} /> {KIND_LABEL[k]}
                </li>
              ))}
              <li>
                <i className="path-legend-you" /> You
              </li>
            </ul>
            <p className="muted">Star size = rounds led. Particles flow along the highways the futures take most often; pick a reality to light its route.</p>
            {networkError && (
              <p className="muted" data-testid="network-error">
                investor map: {networkError}
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
