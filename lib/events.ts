// Server-only. Events from Cala with their attendee lists: one data/events/<id>.json per Cala Event
// entity that has incoming PARTICIPATES_IN_EVENT edges. Whatever files exist are the events shown.
import { readdirSync, readFileSync } from "node:fs";
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

export type EventInfo = EventTag & { source: CalaEvent["source"]; attendees: number };

type Loaded = { event: CalaEvent; ids: Set<string>; names: Set<string> };

let loaded: Loaded[] | undefined;

function load(): Loaded[] {
  if (loaded) return loaded;
  const dir = path.join(process.cwd(), "data", "events");
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    files = [];
  }
  loaded = files
    .flatMap((f) => {
      try {
        const event = JSON.parse(readFileSync(path.join(dir, f), "utf8")) as CalaEvent;
        if (!event?.id || !Array.isArray(event.attendees) || event.attendees.length === 0) return [];
        return [{ event, ids: new Set(event.attendees.map((a) => a.id)), names: new Set(event.attendees.map((a) => a.name.trim().toLowerCase())) }];
      } catch {
        return [];
      }
    })
    .sort((a, b) => a.event.date.localeCompare(b.event.date));
  return loaded;
}

function tagOf(e: CalaEvent): EventTag {
  return { id: e.id, name: e.name, date: e.date, place: e.place };
}

// Every event with an attendee list, soonest first.
export function listEvents(): EventInfo[] {
  return load().map(({ event }) => ({ ...tagOf(event), source: event.source, attendees: event.attendees.length }));
}

// The events a company attends, matched by Cala entity id, else by exact name (an attendee list can
// hold a sibling entity of the company we hold).
export function eventsFor(company: { id: string; name: string }): EventTag[] {
  const name = company.name.trim().toLowerCase();
  return load()
    .filter((l) => l.ids.has(company.id) || l.names.has(name))
    .map((l) => tagOf(l.event));
}

export function eventFor(company: { id: string; name: string }): EventTag | undefined {
  return eventsFor(company)[0];
}
