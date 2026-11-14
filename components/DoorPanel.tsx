import type { Door, DoorKind } from "@/lib/types";

export type DoorPanelProps = { doors: Door[] };

const ORDER: DoorKind[] = ["programme", "office_hours", "scout", "warm_intro", "room"];
const KIND_LABEL: Record<DoorKind, string> = {
  programme: "Programme",
  office_hours: "Office hours",
  scout: "Scout",
  warm_intro: "Warm intro",
  room: "Room",
};

export default function DoorPanel({ doors }: DoorPanelProps) {
  const ordered = [...doors].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  return (
    <section className="panel-block" aria-label="Easiest door" data-testid="door-panel">
      <h3>Easiest door</h3>
      {ordered.length === 0 && <p className="muted">No open door yet. Ask to be considered for a room.</p>}
      <ol className="doors">
        {ordered.map((d, i) => (
          <li key={`${d.kind}-${i}`} className={i === 0 ? "door door-first" : "door"}>
            <span className="door-kind font-mono">{KIND_LABEL[d.kind]}</span>
            <span className="door-body">
              {d.url ? (
                <a href={d.url} target="_blank" rel="noreferrer">
                  {d.label}
                </a>
              ) : (
                d.label
              )}
              {d.via && d.via.length > 0 && <span className="door-via">via {d.via.join(" → ")}</span>}
            </span>
            {i === 0 && <span className="tag tag-accent">easiest</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}
