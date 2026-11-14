// Deal history from Cala's entity graph: FundingRound entities with lead flags and ranked sources,
// merged into data/investors.json.
//
//   npx tsx scripts/ingest-rounds.ts --dry-run        plan and cost estimate, no network
//   npx tsx scripts/ingest-rounds.ts --event-investors --limit 0
//                                    round lists for participants of events fetched by
//                                    scripts/ingest-events.ts that name themselves as investors or
//                                    match one of ours by name
//   npx tsx scripts/ingest-rounds.ts --limit 15       list + retrieve rounds for the first 15
//   npx tsx scripts/ingest-rounds.ts --ids zinc,4bio-capital
//   npx tsx scripts/ingest-rounds.ts --merge          checkpoint -> data/investors.json (no network)
//   --budget N       total live Cala call attempts across runs (default 426: the 400-success cap
//                    plus the 26 failed attempts counted when it was set; counted in
//                    data/raw/rounds/usage.json; delete it to reset)
//   --concurrency N  parallel requests (default 2, max 6; 4 drew sustained 429s)
//   --pace MS        minimum gap between request starts (default 5000)
//
// Order: the demo pitch's ranking (lib/data loadReplay -> mergeProfile -> rankInvestors), so the
// top-15 come first and the rest follow by score. Per investor: 1 retrieve listing its outgoing
// PARTICIPATES_IN_FUNDING_ROUND (role, is_lead, sources) and PARTICIPATES_IN_CORPORATE_EVENT edges, then 1 retrieve per INVESTOR round with a source dated since
// DEALS_SINCE (properties + incoming participants: issuer, all investors, is_lead). A retrieved
// round adds a deal to every investor of ours that participates in it, not only the one listed.
import { promises as fs } from "node:fs";
import path from "node:path";
import { haikuTool, getAnthropic } from "../lib/anthropic";
import {
  CalaBudgetError,
  CalaError,
  companyKey,
  createCalaClient,
  dedupeDeals,
  diskCache,
  fileBudget,
  tieredCache,
  valkeyCache,
  type CalaEdge,
  type CalaEntity,
  type CalaProjection,
} from "../lib/cala";
import { DATA_AS_OF, loadDebriefs, loadReplay } from "../lib/data";
import { emptyProfile, mergeProfile } from "../lib/mergeProfile";
import { finalizeInvestor } from "../lib/revealed";
import {
  dealFromRound,
  dedupeFinancings,
  matchEventParticipants,
  mergeGraphDeals,
  parseFundingRound,
  type ParsedRound,
  type EventMatch,
} from "../lib/rounds";
import { rankInvestors } from "../lib/scoring";
import { ALL_SECTORS, isSector, type Sector } from "../lib/taxonomy";
import type { Deal, Extraction, Investor } from "../lib/types";
import { closeValkey } from "../lib/valkey";

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "data/investors.json");
const DIR = path.join(ROOT, "data/raw/rounds");
const CHECKPOINT = path.join(DIR, "checkpoint.json");
const USAGE = path.join(DIR, "usage.json");
const SECTOR_CACHE = path.join(ROOT, "data/raw/sector-cache.json");
const DEALS_SINCE = "2024-05-01";
const EVENTS_DIR = path.join(ROOT, "data/raw/events"); // written by scripts/ingest-events.ts

try {
  process.loadEnvFile(path.join(ROOT, ".env.local"));
} catch {
  // no .env.local: --dry-run and --merge still work
}

const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const opt = (f: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const DRY = flag("--dry-run");
const MERGE_ONLY = flag("--merge");
const EVENT_INVESTORS = flag("--event-investors");
const LIMIT = Number(opt("--limit") ?? Infinity);
const IDS = opt("--ids")?.split(",").map((s) => s.trim()).filter(Boolean);
const BUDGET = Number(opt("--budget") ?? 426);
const CONCURRENCY = Math.min(6, Number(opt("--concurrency") ?? 2));
const PACE_MS = Number(opt("--pace") ?? 5000);

type ListedEdge = { roundId: string; name: string; role?: string; isLead: boolean; newestSource?: string };
type Checkpoint = {
  listed: Record<string, { calaId: string; rounds: ListedEdge[]; financingEvents: number }>;
  rounds: Record<string, CalaEntity>;
  // Event participants that are ours under another entity id (name match) or name themselves as
  // investors; their round lists, keyed by participant entity id.
  eventInvestors?: Record<string, { name: string; description?: string; investorId?: string; rounds: ListedEdge[] }>;
  sectors: Record<string, Sector>; // companyKey -> sector, from Haiku when no other source had it
};

// Participant names that say "investor". Event edges carry names only, so this is the cheap first
// cut; the retrieved description is the check.
const INVESTOR_NAME =
  /\b(capital|ventures?|vc|partners|funds?|angels?|investments?|investors?|invest|accelerator|syndicate|family office)\b/i;

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(file: string, v: unknown, pretty = false) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, pretty ? JSON.stringify(v, null, 2) : JSON.stringify(v));
}

function demoOrder(investors: Investor[]): Investor[] {
  let p = emptyProfile();
  for (const ev of loadReplay()) if (ev.kind === "profile" && ev.extraction) p = mergeProfile(p, ev.extraction as Extraction);
  const byId = new Map(investors.map((i) => [i.id, i]));
  return rankInvestors(p, investors, loadDebriefs()).map((m) => byId.get(m.investorId) as Investor);
}

const LIST_PROJECTION: CalaProjection = {
  properties: ["name"],
  relationships: {
    outgoing: {
      PARTICIPATES_IN_FUNDING_ROUND: { limit: 100 },
      PARTICIPATES_IN_CORPORATE_EVENT: { limit: 50 },
    },
  },
};

const ROUND_PROJECTION: CalaProjection = {
  properties: [
    "name",
    "round_label",
    "instrument",
    "transaction_value",
    "transaction_value_units",
    "announcement_date",
    "event_date",
    "event_date__precision",
  ],
  relationships: { incoming: { PARTICIPATES_IN_FUNDING_ROUND: { limit: 50 } } },
};

function listedEdges(e: CalaEntity): ListedEdge[] {
  return (e.relationships?.outgoing?.PARTICIPATES_IN_FUNDING_ROUND ?? []).map((edge) => {
    const dates = (edge.properties?.sources ?? []).map((s) => s.date).filter((d): d is string => !!d).sort();
    const role = edge.properties?.role;
    return {
      roundId: edge.id,
      name: edge.name,
      role: typeof role === "string" ? role : undefined,
      isLead: edge.properties?.is_lead === true,
      newestSource: dates[dates.length - 1],
    };
  });
}

// Equity rounds worth a retrieve: INVESTOR role, and a source dated inside the deal window (a
// round with an undated source is kept; its own dates decide later).
const wanted = (e: ListedEdge) => e.role === "INVESTOR" && (!e.newestSource || e.newestSource >= DEALS_SINCE);

async function classifyMissing(companies: string[], cp: Checkpoint) {
  if (!companies.length || !getAnthropic()) return;
  const tool = {
    name: "classify_companies",
    description: "Assign each startup to exactly one sector label.",
    input_schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: { i: { type: "integer" }, sector: { type: "string", enum: [...ALL_SECTORS] } },
            required: ["i", "sector"],
          },
        },
      },
      required: ["items"],
    },
  };
  for (let i = 0; i < companies.length; i += 40) {
    const batch = companies.slice(i, i + 40);
    let out: { items?: { i: number; sector: string }[] } | null;
    try {
      out = (await haikuTool({
        system: `Classify startups into one of: ${ALL_SECTORS.join("; ")}. Use "other" only when nothing fits. If unknown, infer from the name cautiously and prefer "other" over guessing.`,
        user: batch.map((c, j) => `${j}. ${c}`).join("\n"),
        tool,
        maxTokens: 2000,
      })) as typeof out;
    } catch (e) {
      // Same fallback as scripts/ingest.ts: an unclassified company stays sector "other".
      console.warn(`sector classify failed, ${batch.length} companies stay "other": ${(e as Error).message.slice(0, 120)}`);
      return;
    }
    for (const it of out?.items ?? []) if (batch[it.i] && isSector(it.sector)) cp.sectors[companyKey(batch[it.i])] = it.sector;
  }
}

type EventCache = { id: string; name: string; participants: CalaEdge[] };

async function readEvents(): Promise<EventCache[]> {
  const files = await fs.readdir(EVENTS_DIR).catch(() => [] as string[]);
  return Promise.all(files.filter((f) => f.endsWith(".json")).map((f) => readJson<EventCache>(path.join(EVENTS_DIR, f), { id: f, name: f, participants: [] })));
}

// Our investors' other Cala entity ids, from name matches among event participants.
async function eventAltIds(investors: Investor[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (const ev of await readEvents())
    for (const [invId, m] of matchEventParticipants(ev.participants, investors) as Map<string, EventMatch>)
      if (m.via === "name") out.set(invId, [...new Set([...(out.get(invId) ?? []), m.attendeeId])]);
  return out;
}

async function merge(investors: Investor[], cp: Checkpoint) {
  const rounds: ParsedRound[] = Object.values(cp.rounds).map(parseFundingRound);
  const known = new Map<string, Sector>();
  // Sectors classified for the knowledge-query deals; a graph deal's "other" fallback must not
  // count as known, so a later run with Haiku back can classify it.
  for (const inv of investors)
    for (const d of inv.deals) {
      if (d.roundId && d.sector === "other") continue;
      if (d.companyCalaId) known.set(d.companyCalaId, d.sector);
      known.set(companyKey(d.company), d.sector);
    }
  const fileSectors = await readJson<Record<string, Sector>>(SECTOR_CACHE, {});
  const sectorOf = (r: ParsedRound): Sector | undefined =>
    known.get(r.issuer!.id) ?? known.get(companyKey(r.issuer!.name)) ?? fileSectors[companyKey(r.issuer!.name)] ?? cp.sectors[companyKey(r.issuer!.name)];
  const inWindow = (r: ParsedRound) => !!r.date && r.date >= DEALS_SINCE && Date.parse(r.date) <= DATA_AS_OF.getTime();

  const altIds = await eventAltIds(investors);
  const ours = new Set([...investors.map((i) => i.calaId).filter(Boolean), ...[...altIds.values()].flat()]);
  const relevant = rounds.filter((r) => r.issuer && r.stage !== null && inWindow(r) && r.participants.some((p) => ours.has(p.id)));
  const unclassified = [...new Set(relevant.filter((r) => !sectorOf(r)).map((r) => r.issuer!.name))];
  await classifyMissing(unclassified, cp);
  const stillOther = unclassified.filter((n) => !cp.sectors[companyKey(n)]);
  if (stillOther.length) console.log(`no sector for ${stillOther.length} issuers (sector "other"): ${stillOther.join(", ")}`);
  await writeJson(CHECKPOINT, cp);

  const stats = { graphDeals: 0, replaced: 0, added: 0, leadKnown: 0, led: 0, investorsWithGraph: 0 };
  const out = investors.map((inv) => {
    const next: Investor = { ...inv };
    if (!inv.calaId) return next;
    // A name-matched event participant is the same investor under another Cala entity, so its
    // rounds count as this investor's.
    const ids = new Set([inv.calaId, ...(altIds.get(inv.id) ?? [])]);
    const graph = dedupeFinancings(
      relevant.map((r) => dealFromRound(r, ids, sectorOf(r) ?? "other")).filter((d): d is Deal => !!d),
    );
    if (!graph.length) return next;
    stats.investorsWithGraph++;
    stats.graphDeals += graph.length;
    for (const g of graph)
      if (g.isLead !== undefined) {
        stats.leadKnown++;
        if (g.isLead) stats.led++;
      }
    const merged = mergeGraphDeals(inv.deals, graph);
    stats.replaced += merged.replaced;
    stats.added += merged.added;
    const raw: Record<string, unknown> = { ...next, deals: dedupeDeals(merged.deals) };
    for (const k of ["revealed", "contradiction", "contradictionLine", "thinHistory"]) delete raw[k];
    return finalizeInvestor(raw as Parameters<typeof finalizeInvestor>[0], DATA_AS_OF);
  });
  await writeJson(OUT, out, true);
  const lines = [
    `rounds retrieved ${rounds.length}; in window with one of our investors ${relevant.length}`,
    `investors with graph deals ${stats.investorsWithGraph}; graph deals ${stats.graphDeals} (replaced ${stats.replaced} query deals, added ${stats.added})`,
    `lead status known ${stats.leadKnown}/${stats.graphDeals} (${stats.graphDeals ? Math.round((100 * stats.leadKnown) / stats.graphDeals) : 0}%), led ${stats.led}`,
    `wrote ${path.relative(ROOT, OUT)}`,
  ];
  for (const l of lines) console.log(l);
}

async function main() {
  const investors = JSON.parse(await fs.readFile(OUT, "utf8")) as Investor[];
  const cp = await readJson<Checkpoint>(CHECKPOINT, { listed: {}, rounds: {}, sectors: {} });
  cp.sectors ??= {};
  let order = demoOrder(investors).filter((i) => i.calaId);
  if (IDS) order = order.filter((i) => IDS.includes(i.id));
  order = order.slice(0, LIMIT);

  if (DRY) {
    const listedRounds = Object.values(cp.listed);
    const perInv = listedRounds.length ? listedRounds.reduce((a, l) => a + l.rounds.filter(wanted).length, 0) / listedRounds.length : NaN;
    const todo = order.filter((i) => !cp.listed[i.id]);
    console.log(`would list ${todo.length} investors (${order.length - todo.length} already listed); ${Object.keys(cp.rounds).length} rounds in checkpoint`);
    console.log(`measured ${perInv.toFixed(2)} wanted rounds per listed investor (${listedRounds.length} listed) -> ~${Math.round(todo.length * (1 + perInv))} calls before round overlap`);
    console.log(`first: ${order.slice(0, 15).map((i) => i.id).join(", ")}`);
    return;
  }
  if (MERGE_ONLY) return merge(investors, cp);

  const budget = fileBudget(USAGE, BUDGET);
  const cala = createCalaClient({
    cache: tieredCache(valkeyCache(), diskCache(path.join(ROOT, "data/cala-cache"))),
    budget,
    concurrency: CONCURRENCY,
    maxRetries: 3,
    log: console.warn,
  });
  let stopped = false;
  // Requests start at least PACE_MS apart: bursts of ~10 drew 429s that outlast the retries, and
  // every retry counts against the budget.
  let nextStart = 0;
  const pace = async () => {
    const wait = nextStart - Date.now();
    nextStart = Math.max(Date.now(), nextStart) + PACE_MS;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  };
  const guard = async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
    if (stopped) return undefined;
    await pace();
    if (stopped) return undefined;
    try {
      return await fn();
    } catch (e) {
      if (e instanceof CalaBudgetError) {
        stopped = true;
        console.warn(`budget of ${BUDGET} live calls reached; stopping`);
        return undefined;
      }
      // Still rate-limited after the retries: stop here and merge; a re-run resumes.
      if (e instanceof CalaError && e.status === 429) {
        stopped = true;
        console.warn("rate-limited after retries; stopping (re-run to resume)");
        return undefined;
      }
      throw e;
    }
  };

  try {
    if (EVENT_INVESTORS) {
      cp.eventInvestors ??= {};
      const matched = new Map([...(await eventAltIds(investors))].flatMap(([invId, ids]) => ids.map((id) => [id, invId] as const)));
      const ourIds = new Set(investors.map((i) => i.calaId));
      const seen = new Set<string>();
      const candidates = (await readEvents())
        .flatMap((ev) => ev.participants)
        .filter((a) => !seen.has(a.id) && seen.add(a.id) && !ourIds.has(a.id) && (matched.has(a.id) || INVESTOR_NAME.test(a.name)));
      for (const a of candidates) {
        if (stopped) break;
        if (!cp.eventInvestors[a.id]) {
          const e = await guard(() =>
            cala.retrieve(a.id, { ...LIST_PROJECTION, properties: ["name", "description"] }),
          );
          if (!e) break;
          const description = typeof e.properties?.description?.value === "string" ? e.properties.description.value : undefined;
          cp.eventInvestors[a.id] = { name: a.name, description, investorId: matched.get(a.id), rounds: listedEdges(e) };
        }
        const si = cp.eventInvestors[a.id];
        // Ours: every equity round, as for any investor. Others: recent rounds they led.
        const todo = si.rounds.filter((r) => wanted(r) && (si.investorId || r.isLead) && !cp.rounds[r.roundId]);
        await Promise.all(
          todo.map(async (r) => {
            const ent = await guard(() => cala.retrieve(r.roundId, ROUND_PROJECTION));
            if (ent) cp.rounds[r.roundId] = ent;
          }),
        );
        console.log(`event participant ${a.name}${si.investorId ? ` (= ${si.investorId})` : ""}: ${si.rounds.length} round edges, ${si.rounds.filter((r) => r.isLead && wanted(r)).length} recent led`);
        await writeJson(CHECKPOINT, cp);
      }
    }

    for (const inv of order) {
      if (stopped) break;
      if (!cp.listed[inv.id]) {
        const e = await guard(() => cala.retrieve(inv.calaId, LIST_PROJECTION));
        if (!e) break;
        const out = e.relationships?.outgoing ?? {};
        cp.listed[inv.id] = {
          calaId: inv.calaId,
          rounds: listedEdges(e),
          financingEvents: (out.PARTICIPATES_IN_CORPORATE_EVENT ?? []).length,
        };
      }
      const todo = cp.listed[inv.id].rounds.filter((r) => wanted(r) && !cp.rounds[r.roundId]);
      todo.sort((a, b) => (b.newestSource ?? "").localeCompare(a.newestSource ?? ""));
      await Promise.all(
        todo.map(async (r) => {
          const ent = await guard(() => cala.retrieve(r.roundId, ROUND_PROJECTION));
          if (ent) cp.rounds[r.roundId] = ent;
        }),
      );
      const listed = cp.listed[inv.id];
      console.log(
        `${inv.id}: ${listed.rounds.length} round edges (${listed.rounds.filter(wanted).length} wanted, ${listed.rounds.filter((r) => r.isLead).length} led), ${listed.financingEvents} financing events`,
      );
      await writeJson(CHECKPOINT, cp);
    }
  } finally {
    await writeJson(CHECKPOINT, cp);
    const used = await budget.usage();
    console.log(`Cala this run: ok ${cala.stats.ok}, sent ${cala.stats.calls}, cache hits ${cala.stats.cacheHits} | total live calls counted ${used.used}/${used.limit}`);
  }
  await merge(investors, cp);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.stack : e);
    process.exitCode = 1;
  })
  .finally(() => closeValkey());
