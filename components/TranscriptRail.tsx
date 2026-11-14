"use client";

import { useEffect, useRef } from "react";

export type TranscriptRailProps = {
  tokens: { text: string; final: boolean }[];
  live: boolean;
  highlightWords?: number;
};

export default function TranscriptRail({ tokens, live, highlightWords = 6 }: TranscriptRailProps) {
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [tokens]);

  const words = tokens.flatMap((t, ti) => t.text.split(/\s+/).filter(Boolean).map((w, wi) => ({ w, key: `${ti}-${wi}`, final: t.final })));
  const cutoff = words.length - highlightWords;

  return (
    <section className="rail-card" aria-label="Live transcript" data-testid="transcript">
      <header className="rail-head">
        <span>Transcript</span>
        <span className={`listening ${live ? "is-live" : ""}`} aria-live="polite">
          <i aria-hidden />
          {live ? "listening" : "paused"}
        </span>
      </header>
      <div ref={scroller} className="transcript-body font-mono" data-testid="transcript-body">
        {words.length === 0 ? (
          <span className="muted">Say your pitch. Investors move as you speak.</span>
        ) : (
          words.map((x, i) => (
            <span key={x.key} className={i >= cutoff ? "tok tok-new" : x.final ? "tok" : "tok tok-interim"}>
              {x.w}{" "}
            </span>
          ))
        )}
      </div>
    </section>
  );
}
