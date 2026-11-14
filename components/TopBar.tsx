"use client";

import FixtureBanner from "./FixtureBanner";
import RoleSwitcher from "./RoleSwitcher";

export type TopBarProps = {
  inboxCount: number;
  onInbox: () => void;
  onReplay: () => void;
  replaying?: boolean;
  micState: "idle" | "listening" | "unsupported";
  onMic: () => void;
  showFixtureBanner: boolean;
};

export default function TopBar({ inboxCount, onInbox, onReplay, replaying, micState, onMic, showFixtureBanner }: TopBarProps) {
  return (
    <header className="topbar">
      <div className="topbar-row">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          <span className="brand-name">Room</span>
          <span className="brand-sub">London investors, ranked by what they did</span>
        </div>
        <RoleSwitcher />
        <div className="topbar-actions">
          <button type="button" className="btn" onClick={onInbox} aria-label={`Requests, ${inboxCount} new`} data-testid="inbox">
            Requests
            {inboxCount > 0 && <span className="badge font-mono">{inboxCount}</span>}
          </button>
          <button type="button" className={`btn ${replaying ? "is-busy" : ""}`} onClick={onReplay} data-testid="replay" title="Replay the demo pitch (R)">
            Replay <kbd>R</kbd>
          </button>
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
        </div>
      </div>
      <FixtureBanner show={showFixtureBanner} />
    </header>
  );
}
