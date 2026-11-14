"use client";

import type { ReactNode } from "react";
import FixtureBanner from "./FixtureBanner";
import RoleSwitcher from "./RoleSwitcher";

export type TopBarProps = {
  inbox: ReactNode;
  subtitle?: string;
  tools?: ReactNode;
  onReplay?: () => void;
  replaying?: boolean;
  micState?: "idle" | "listening" | "unsupported";
  onMic?: () => void;
  showFixtureBanner: boolean;
};

// Comet on an orbit: the Scalaxy mark, a nod to Cala Comets.
function CometMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 28 28" aria-hidden>
      <defs>
        <linearGradient id="comet-tail" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="var(--accent)" stopOpacity="0" />
          <stop offset="1" stopColor="var(--accent)" />
        </linearGradient>
      </defs>
      <ellipse cx="14" cy="15" rx="11.5" ry="4.5" fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1" transform="rotate(-24 14 15)" />
      <path d="M4 21 Q13 16 20 8" stroke="url(#comet-tail)" strokeWidth="2.6" strokeLinecap="round" fill="none" />
      <circle cx="20.5" cy="7.5" r="3" fill="var(--founder)" />
    </svg>
  );
}

export default function TopBar({ inbox, subtitle, tools, onReplay, replaying, micState = "idle", onMic, showFixtureBanner }: TopBarProps) {
  return (
    <header className="topbar">
      <div className="topbar-row">
        <div className="brand">
          <CometMark />
          <span className="brand-name" aria-label="Scalaxy">
            <span aria-hidden>s</span>
            <span className="brand-cala" aria-hidden>
              CALA
            </span>
            <span aria-hidden>xy</span>
          </span>
          {subtitle && <span className="brand-sub">{subtitle}</span>}
        </div>
        <RoleSwitcher />
        <div className="topbar-actions">
          {inbox}
          {tools}
          {onReplay && (
            <button type="button" className={`btn ${replaying ? "is-busy" : ""}`} onClick={onReplay} data-testid="replay" title="Replay the demo pitch (R)">
              Replay <kbd>R</kbd>
            </button>
          )}
          {onMic && (
            <button
              type="button"
              className={`btn btn-mic ${micState === "listening" ? "is-live" : ""}`}
              onClick={onMic}
              disabled={micState === "unsupported"}
              title={micState === "unsupported" ? "Speech recognition needs Chrome" : micState === "listening" ? "Stop listening" : "Start listening"}
              data-testid="mic"
            >
              <i aria-hidden />
              {micState === "listening" ? "Listening" : micState === "unsupported" ? "No mic API" : "Mic"}
            </button>
          )}
        </div>
      </div>
      <FixtureBanner show={showFixtureBanner} />
    </header>
  );
}
