"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type TranscriptRailProps = {
  tokens: { text: string; final: boolean }[];
  live: boolean;
  highlightWords?: number;
  triggers?: Record<string, string>;
};

const TRIGGER_FLASH_MS = 1800;

const norm = (w: string) => w.toLowerCase().replace(/^[^\p{L}\p{N}£$€]+|[^\p{L}\p{N}%]+$/gu, "");

// Index range of the latest occurrence of a (possibly multi-word) phrase in the word list.
function lastOccurrence(words: string[], phrase: string): [number, number] | null {
  const parts = phrase.split(/\s+/).map(norm).filter(Boolean);
  if (!parts.length) return null;
  for (let i = words.length - parts.length; i >= 0; i--) {
    let ok = true;
    for (let j = 0; j < parts.length; j++) {
      if (words[i + j] !== parts[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return [i, i + parts.length - 1];
  }
  return null;
}

export default function TranscriptRail({ tokens, live, highlightWords = 6, triggers = {} }: TranscriptRailProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const seenTriggers = useRef(new Set<string>());
  const timers = useRef(new Set<number>());
  const [flashing, setFlashing] = useState<string[]>([]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const id of pending) window.clearTimeout(id);
    };
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [tokens]);

  const words = useMemo(
    () => tokens.flatMap((t, ti) => t.text.split(/\s+/).filter(Boolean).map((w, wi) => ({ w, key: `${ti}-${wi}`, final: t.final }))),
    [tokens],
  );
  const cutoff = words.length - highlightWords;

  const triggerSig = Object.entries(triggers)
    .map(([k, v]) => `${k}=${v}`)
    .join("|");

  useEffect(() => {
    if (!triggerSig) {
      seenTriggers.current.clear();
      return;
    }
    const fresh = triggerSig.split("|").filter((s) => !seenTriggers.current.has(s));
    if (!fresh.length) return;
    for (const s of fresh) seenTriggers.current.add(s);
    const phrases = fresh.map((s) => s.slice(s.indexOf("=") + 1));
    setFlashing((prev) => [...prev, ...phrases]);
    // Each flash clears on its own timer; a cleanup here would cancel it whenever the
    // next trigger lands inside the flash window.
    const id = window.setTimeout(() => {
      timers.current.delete(id);
      setFlashing((prev) => prev.filter((p) => !phrases.includes(p)));
    }, TRIGGER_FLASH_MS);
    timers.current.add(id);
  }, [triggerSig]);

  const flashed = useMemo(() => {
    const set = new Set<number>();
    if (!flashing.length) return set;
    const normed = words.map((x) => norm(x.w));
    for (const phrase of flashing) {
      const range = lastOccurrence(normed, phrase);
      if (!range) continue;
      for (let i = range[0]; i <= range[1]; i++) set.add(i);
    }
    return set;
  }, [flashing, words]);

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
          words.map((x, i) => {
            const base = i >= cutoff ? "tok tok-new" : x.final ? "tok" : "tok tok-interim";
            return (
              <span key={x.key} className={flashed.has(i) ? `${base} tok-trigger` : base} data-trigger={flashed.has(i) || undefined}>
                {x.w}{" "}
              </span>
            );
          })
        )}
      </div>
    </section>
  );
}
