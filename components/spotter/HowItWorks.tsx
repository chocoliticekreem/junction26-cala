"use client";

import { useEffect, useRef, useState } from "react";
import type { SpotterResponse } from "./types";

// The method, evidence counts and as-of date live here, behind one (i) button.
export default function HowItWorks({ data }: { data: SpotterResponse }) {
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!host.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const { investor, considered, asOf } = data;
  return (
    <div className="sp-how" ref={host} onClick={(e) => e.stopPropagation()}>
      <button type="button" className={`sp-how-btn ${open ? "is-on" : ""}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} data-testid="spotter-how">
        <i aria-hidden>i</i> How this works
      </button>
      {open && (
        <div className="sp-how-pop" role="dialog" aria-label="How this works" data-testid="spotter-how-pop">
          <ol>
            <li>
              <b>Your taste.</b> Sectors, stages, round sizes, lead share and co-investors from the {investor.rounds} real rounds {investor.name} sat on in Cala.
            </li>
            <li>
              <b>Your lane.</b> Companies with a first round in the last 36 months that fit that taste and are not in your portfolio: {considered.candidates} considered.
            </li>
            <li>
              <b>Path shape.</b> Each one&rsquo;s first rounds against companies that became unicorns and ones that stalled. The closest are the precedents you see.
            </li>
            <li>
              <b>Futures.</b> The best {considered.simulated} are simulated forward from their last real round: unicorn-like odds, and how often you show up as the next lead or a participant.
            </li>
          </ol>
          <p className="font-mono">
            {considered.roundsInCohort} real rounds in Cala · as of {asOf} · evidence, not a forecast
          </p>
        </div>
      )}
    </div>
  );
}
