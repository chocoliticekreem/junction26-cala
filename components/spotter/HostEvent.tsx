"use client";

import { useState } from "react";
import { calaEntityHref } from "@/components/path/api";
import { sectorColor, sectorLabel } from "./format";
import type { SpotterHost } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// One line under the picks: the event this fund could host, and who would be in the room.
export function HostRow({ host, open, onToggle }: { host: SpotterHost; open: boolean; onToggle: () => void }) {
  const color = sectorColor(host.sector);
  return (
    <button type="button" className={`sp-host ${open ? "is-on" : ""}`} onClick={onToggle} aria-expanded={open} data-testid="spotter-host">
      <span className="sp-host-k">Host</span>
      <i className="dot" style={{ color, background: color }} aria-hidden />
      <span className="sp-host-name">{host.name.replace(/ · Slush week$/, "")}</span>
      <span className="sp-host-meta font-mono">
        {host.count} fit · {host.atSlush} at Slush
      </span>
      <span className="sp-host-arrow" aria-hidden>
        ›
      </span>
    </button>
  );
}

// The invite list, in the pick card's container on the map.
export function HostCard({ hosts, onClose }: { hosts: SpotterHost[]; onClose: () => void }) {
  const [i, setI] = useState(0);
  const host = hosts[Math.min(i, hosts.length - 1)];
  const color = sectorColor(host.sector);
  return (
    <aside className="sp-detail" data-testid="spotter-host-card" onClick={(e) => e.stopPropagation()}>
      <div className="sp-detail-head">
        <div className="min-w-0">
          <div className="profile-kind">Host · Slush week</div>
          <h2>{host.name.replace(/ · Slush week$/, "")}</h2>
          <div className="sp-pick-chips">
            <span className="sp-chip">
              <i className="dot" style={{ color, background: color }} aria-hidden />
              {host.count} fit
            </span>
            <span className="sp-chip sp-event-tag">{host.atSlush} at Slush</span>
            {hosts.length > 1 && (
              <button type="button" className="sp-chip sp-host-alt" onClick={() => setI((cur) => (cur + 1) % hosts.length)} data-testid="spotter-host-alt">
                or {sectorLabel(hosts[(i + 1) % hosts.length].sector)} · {hosts[(i + 1) % hosts.length].count}
              </button>
            )}
          </div>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      <ol className="sp-invites" data-testid="spotter-invites">
        {host.companies.map((c) => (
          <li key={c.id} className="sp-invite">
            {UUID.test(c.id) ? (
              <a href={calaEntityHref(c.id)} target="_blank" rel="noreferrer">
                {c.name} ↗
              </a>
            ) : (
              <b>{c.name}</b>
            )}
            <span>
              {c.stage}
              {c.year ? ` · ${c.year}` : ""}
            </span>
            {c.atSlush && (
              <span className="sp-chip sp-event-tag" data-testid="spotter-invite-slush">
                At Slush
              </span>
            )}
          </li>
        ))}
      </ol>
    </aside>
  );
}
