// Cala Event entities -> `events` on data/investors.json: an investor gets an event when it is in
// the event's incoming PARTICIPATES_IN_EVENT (by Cala id, else a strict name match).
//
//   npx tsx scripts/ingest-events.ts --event <id> [--event <id> ...]   fetch + merge
//   npx tsx scripts/ingest-events.ts --merge                            cached events -> investors.json
//   --budget N   live Cala call attempts across runs, shared with ingest-rounds
//                (data/raw/rounds/usage.json, default 426)
//
// Per event: 1 introspection, 1 retrieve of its name and date properties, then 1 retrieve per
// 1000 participants (the API's maximum relationship limit), paged with offset. Raw participants are
// kept in data/raw/events/<id>.json (gitignored) for scripts/ingest-rounds.ts --event-investors.
import { promises as fs } from "node:fs";
import path from "node:path";
import { createCalaClient, diskCache, fileBudget, tieredCache, valkeyCache, type CalaEdge } from "../lib/cala";
import { matchEventParticipants } from "../lib/rounds";
import type { Investor, InvestorEvent } from "../lib/types";
import { closeValkey } from "../lib/valkey";

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "data/investors.json");
const EVENTS_DIR = path.join(ROOT, "data/raw/events");
const PAGE = 1000;

try {
  process.loadEnvFile(path.join(ROOT, ".env.local"));
} catch {
  // no .env.local: --merge still works
}

type EventCache = { id: string; name: string; date?: string; pages: number; participants: CalaEdge[] };

const args = process.argv.slice(2);
const opt = (f: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const EVENT_IDS = args.flatMap((a, i) => (args[i - 1] === "--event" ? [a] : []));
const BUDGET = Number(opt("--budget") ?? 426);

const isoDay = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : undefined);

async function fetchEvent(id: string): Promise<EventCache> {
  const cala = createCalaClient({
    cache: tieredCache(valkeyCache(), diskCache(path.join(ROOT, "data/cala-cache"))),
    budget: fileBudget(path.join(ROOT, "data/raw/rounds/usage.json"), BUDGET),
    concurrency: 1,
    maxRetries: 4,
    log: console.warn,
  });
  const intro = await cala.introspect(id);
  const wanted = intro.properties.filter((p) => p === "name" || /date/.test(p));
  const props = await cala.retrieve(id, { properties: wanted });
  const dateProp = ["start_date", "event_date", "date"].find((p) => isoDay(props.properties?.[p]?.value));
  const participants: CalaEdge[] = [];
  let pages = 0;
  for (let offset = 0; ; offset += PAGE) {
    const e = await cala.retrieve(id, {
      properties: ["name"],
      relationships: { incoming: { PARTICIPATES_IN_EVENT: { limit: PAGE, offset } } },
    });
    pages++;
    const page = e.relationships?.incoming?.PARTICIPATES_IN_EVENT ?? [];
    participants.push(...page);
    if (page.length < PAGE) break;
  }
  const name = typeof props.properties?.name?.value === "string" ? props.properties.name.value : props.name;
  const out: EventCache = { id, name, pages, participants };
  const date = dateProp ? isoDay(props.properties[dateProp].value) : undefined;
  if (date) out.date = date;
  console.log(`${name} (${id}): ${participants.length} participants in ${pages} pages; date ${date ?? "not in Cala"} | Cala ok ${cala.stats.ok}, cache hits ${cala.stats.cacheHits}`);
  return out;
}

async function readEventCaches(): Promise<EventCache[]> {
  const files = await fs.readdir(EVENTS_DIR).catch(() => [] as string[]);
  return Promise.all(files.filter((f) => f.endsWith(".json")).map(async (f) => JSON.parse(await fs.readFile(path.join(EVENTS_DIR, f), "utf8")) as EventCache));
}

async function main() {
  for (const id of EVENT_IDS) {
    const ev = await fetchEvent(id);
    await fs.mkdir(EVENTS_DIR, { recursive: true });
    await fs.writeFile(path.join(EVENTS_DIR, `${id}.json`), JSON.stringify(ev));
  }
  const events = await readEventCaches();
  const investors = JSON.parse(await fs.readFile(OUT, "utf8")) as Investor[];
  const byInvestor = new Map<string, InvestorEvent[]>();
  for (const ev of events) {
    const matches = matchEventParticipants(ev.participants, investors);
    for (const [invId, m] of matches) {
      const entry: InvestorEvent = { id: ev.id, name: ev.name };
      if (ev.date) entry.date = ev.date;
      if (m.source) entry.source = m.source;
      byInvestor.set(invId, [...(byInvestor.get(invId) ?? []), entry]);
    }
    const names = [...matches].map(([invId, m]) => `${invId} (${m.via})`);
    console.log(`${ev.name}: ${matches.size} of ${investors.length} investors: ${names.join(", ") || "none"}`);
  }
  const out = investors.map((inv) => {
    const next: Investor = { ...inv };
    delete next.events;
    const evs = byInvestor.get(inv.id);
    if (evs) next.events = evs.sort((a, b) => (a.date ?? a.id).localeCompare(b.date ?? b.id));
    return next;
  });
  await fs.writeFile(OUT, JSON.stringify(out, null, 2));
  console.log(`wrote ${path.relative(ROOT, OUT)} (${events.length} events)`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.stack : e);
    process.exitCode = 1;
  })
  .finally(() => closeValkey());
