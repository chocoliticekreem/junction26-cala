"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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

export default function TopBar({ inbox, subtitle, tools, onReplay, replaying, micState = "idle", onMic, showFixtureBanner }: TopBarProps) {
  const pathname = usePathname();
  return (
    <header className="topbar">
      <div className="topbar-row">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          <span className="brand-name">Room</span>
          {subtitle && <span className="brand-sub">{subtitle}</span>}
        </div>
        <RoleSwitcher />
        <Link href="/path" className={`path-nav ${pathname?.startsWith("/path") ? "is-active" : ""}`} data-testid="nav-path">
          Path
        </Link>
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
