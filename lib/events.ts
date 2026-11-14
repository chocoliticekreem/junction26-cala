// Server-only. Events from Cala with their attendee lists (data/events/*.json, written once from
// the Cala Event entity's incoming PARTICIPATES_IN_EVENT edges). Today: Slush 2026.
import { readFileSync } from "node:fs";
import path from "node:path";

export type CalaEvent = {
  id: string;
  name: string;
  date: string;
  place: string;
  source: { name: string; url: string; asOf: string };
  attendees: { id: string; name: string }[];
};

export type EventTag = { id: string; name: string; date: string; place: string };

let slush: { event: CalaEvent; ids: Set<string>; names: Set<string> } | null | undefined;

function loadSlush() {
  if (slush !== undefined) return slush;
  try {
    const event = JSON.parse(readFileSync(path.join(process.cwd(), "data", "events", "slush-2026.json"), "utf8")) as CalaEvent;
    slush = {
      event,
      ids: new Set(event.attendees.map((a) => a.id)),
      names: new Set(event.attendees.map((a) => a.name.trim().toLowerCase())),
    };
  } catch {
    slush = null;
  }
  return slush;
}

// The event a company attends, matched by Cala entity id, else by exact name (the attendee list can
// hold a sibling entity of the company we hold).
export function eventFor(company: { id: string; name: string }): EventTag | undefined {
  const s = loadSlush();
  if (!s) return undefined;
  if (!s.ids.has(company.id) && !s.names.has(company.name.trim().toLowerCase())) return undefined;
  const { id, name, date, place } = s.event;
  return { id, name, date, place };
}
