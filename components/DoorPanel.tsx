import { publicDoors } from "@/lib/doors";
import type { Door, DoorKind } from "@/lib/types";

export type DoorPanelProps = { doors: Door[] };

const ORDER: DoorKind[] = ["programme", "office_hours", "scout"];
const KIND_LABEL: Partial<Record<DoorKind, string>> = {
  programme: "Programme",
  office_hours: "Office hours",
  scout: "Scout",
};

// Only real public routes in (lib/doors.ts publicDoors); nothing to show means no section.
export default function DoorPanel({ doors }: DoorPanelProps) {
  const ordered = publicDoors(doors).sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  if (ordered.length === 0) return null;
  return (
    <section className="panel-block" aria-label="Easiest door" data-testid="door-panel">
      <h3>Easiest door</h3>
      <ol className="doors">
        {ordered.map((d, i) => (
          <li key={`${d.kind}-${i}`} className={i === 0 ? "door door-first" : "door"}>
            <span className="door-kind font-mono">{KIND_LABEL[d.kind]}</span>
            <span className="door-body">
              <a href={d.url} target="_blank" rel="noreferrer">
                {d.label}
              </a>
            </span>
            {i === 0 && <span className="tag tag-accent">easiest</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}
