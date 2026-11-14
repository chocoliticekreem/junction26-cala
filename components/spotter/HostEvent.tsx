"use client";

import { calaEntityHref } from "@/components/path/api";
import { eventTag, sectorColor } from "./format";
import type { SpotterHost } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// One row per event this fund could host, and who would be in the room.
export function HostRow({ host, open, onToggle }: { host: SpotterHost; open: boolean; onToggle: () => void }) {
  const color = sectorColor(host.sector);
  return (
    <button type="button" className={`sp-host ${open ? "is-on" : ""}`} onClick={onToggle} aria-expanded={open} data-testid="spotter-host">
      <i className="dot" style={{ color, background: color }} aria-hidden />
      <span className="sp-host-name">{host.name}</span>
      <span className="sp-host-meta font-mono">
        {host.count} fit{host.attending > 0 ? ` · ${host.attending} attend` : ""}
      </span>
      <span className="sp-host-arrow" aria-hidden>
        ›
      </span>
    </button>
  );
}

// The invite list, in the pick card's container on the map.
export function HostCard({ host, onClose }: { host: SpotterHost; onClose: () => void }) {
  const color = sectorColor(host.sector);
  return (
    <aside className="sp-detail" data-testid="spotter-host-card" onClick={(e) => e.stopPropagation()}>
      <div className="sp-detail-head">
        <div className="min-w-0">
          <div className="profile-kind">Host your own</div>
          <h2>{host.name}</h2>
          <div className="sp-pick-chips">
            <span className="sp-chip">
              <i className="dot" style={{ color, background: color }} aria-hidden />
              {host.count} fit
            </span>
            {host.attending > 0 && <span className="sp-chip sp-event-tag">{host.attending} attend an event</span>}
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
            {c.events.map((e) => (
              <span key={e.id} className="sp-chip sp-event-tag" data-testid="spotter-invite-event">
                {eventTag(e)}
              </span>
            ))}
          </li>
        ))}
      </ol>
    </aside>
  );
}
