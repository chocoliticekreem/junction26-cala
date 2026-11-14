// Real Cala ingest: London investors -> data/raw/investors/*.json -> data/investors.json.
//
//   npx tsx scripts/ingest.ts --dry-run          plan only, no network
//   npx tsx scripts/ingest.ts --limit 5          discover (once) + fetch/classify 5 investors
//   npx tsx scripts/ingest.ts                    all candidates, resumable via the checkpoint
//   npx tsx scripts/ingest.ts --build            raw -> data/investors.json (no network)
//   --max-calls N  stop scheduling new investors past N Cala calls (default 1200)
//   --concurrency N  parallel investors and Cala requests (default 4)
//
// Per investor: 1 entity retrieve (INVESTED_IN edges with sources, WORKS_AT people, website),
// 1 knowledge/query (dated rounds since 2024-05), 1 knowledge/search (stated thesis + cited
// deal sources), plus Haiku classification. Resolving a name with no entity id costs 1 more.
import { promises as fs } from "node:fs";
import path from "node:path";
import { haikuTool, getAnthropic } from "../lib/anthropic";
import {
  companyKey,
  createCalaClient,
  dedupeDeals,
  dedupeSources,
  diskCache,
  entitySources,
  investorKey,
  normaliseDate,
  normaliseRound,
  originToSource,
  parseAmountUsd,
  searchSources,
  slugify,
  toSource,
  type CalaEntity,
  type CalaEntityMention,
  type CalaQueryResponse,
  type CalaSearchResponse,
} from "../lib/cala";
import { finalizeInvestor } from "../lib/revealed";
import { ALL_SECTORS, SECTORS, STAGES, isSector, isStage, type Sector, type Stage } from "../lib/taxonomy";
import type { Deal, Door, Investor, InvestorKind, Partner, Source } from "../lib/types";

const ROOT = path.resolve(__dirname, "..");
const RAW = path.join(ROOT, "data/raw");
const RAW_INV = path.join(RAW, "investors");
const CANDIDATES = path.join(RAW, "candidates.json");
const SECTOR_CACHE = path.join(RAW, "sector-cache.json");
const CHECKPOINT = path.join(ROOT, "data/.ingest-checkpoint.json");
const LOG = path.join(RAW, "ingest.log");
const OUT = path.join(ROOT, "data/investors.json");
const DEALS_SINCE = "2024-05-01";

try {
  process.loadEnvFile(path.join(ROOT, ".env.local"));
} catch {
  // no .env.local: --dry-run and --build still work
}

const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const num = (f: string, d: number) => {
  const i = args.indexOf(f);
  return i >= 0 ? Number(args[i + 1]) : d;
};
const DRY = flag("--dry-run");
const BUILD_ONLY = flag("--build");
const LIMIT = num("--limit", Infinity);
const MAX_CALLS = num("--max-calls", 1200);
const CONCURRENCY = num("--concurrency", 4);

async function log(msg: string) {
  const line = `${new Date().toISOString()} ${msg}`;
  console.log(line);
  await fs.mkdir(RAW, { recursive: true });
  await fs.appendFile(LOG, line + "\n");
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

const writeJson = async (file: string, v: unknown) => {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(v, null, 2));
};

// ---------- discovery ----------

type Candidate = { name: string; kind: InvestorKind; calaId?: string; description?: string; via: string };

const DISCOVERY: { kind: InvestorKind; input: string }[] = [
  { kind: "fund", input: "venture capital firms headquartered in London investing in seed stage startups" },
  { kind: "fund", input: "venture capital funds based in London that invest at pre-seed stage" },
  { kind: "fund", input: "London-based Series A venture capital firms investing in European startups" },
  { kind: "fund", input: "London venture capital firms investing in biotech and life sciences startups" },
  { kind: "fund", input: "London venture capital firms investing in fintech startups" },
  { kind: "fund", input: "London venture capital firms investing in climate tech and energy startups" },
  { kind: "fund", input: "London venture capital firms investing in deep tech and hardware startups" },
  { kind: "fund", input: "London venture capital firms investing in AI startups" },
  { kind: "fund", input: "London venture capital firms investing in healthtech and digital health startups" },
  { kind: "fund", input: "London venture capital firms investing in consumer and marketplace startups" },
  { kind: "angel_network", input: "angel networks and angel investor syndicates based in London" },
  { kind: "accelerator", input: "startup accelerators and incubators in London that invest in startups" },
  { kind: "cvc", input: "corporate venture capital arms based in London investing in startups" },
  { kind: "fund", input: "UK university spinout investors and venture funds based in London" },
];

// Names only, to widen coverage past what discovery queries return. Every fact about them
// still comes from Cala; a name Cala cannot resolve is dropped.
const SEED_NAMES: [string, InvestorKind][] = [
  ["Seedcamp", "fund"], ["LocalGlobe", "fund"], ["Balderton Capital", "fund"], ["Index Ventures", "fund"],
  ["Kindred Capital", "fund"], ["Atomico", "fund"], ["Accel", "fund"], ["Northzone", "fund"],
  ["Hoxton Ventures", "fund"], ["Octopus Ventures", "fund"], ["Notion Capital", "fund"], ["MMC Ventures", "fund"],
  ["Episode 1 Ventures", "fund"], ["Firstminute Capital", "fund"], ["Ada Ventures", "fund"], ["Fuel Ventures", "fund"],
  ["Concept Ventures", "fund"], ["Playfair Capital", "fund"], ["Passion Capital", "fund"], ["Connect Ventures", "fund"],
  ["Crane Venture Partners", "fund"], ["Mosaic Ventures", "fund"], ["Felix Capital", "fund"], ["Creandum", "fund"],
  ["Entrepreneur First", "accelerator"], ["Speedinvest", "fund"], ["Frontline Ventures", "fund"], ["Dawn Capital", "fund"],
  ["Molten Ventures", "fund"], ["Augmentum Fintech", "fund"], ["Anthemis", "fund"], ["Fintech Collective", "fund"],
  ["Outward VC", "fund"], ["Talis Capital", "fund"], ["Eka Ventures", "fund"], ["Stride VC", "fund"],
  ["Forward Partners", "fund"], ["Haatch", "fund"], ["Ascension", "fund"], ["Love Ventures", "fund"],
  ["Pact VC", "fund"], ["JamJar Investments", "fund"], ["Backed VC", "fund"], ["Form Ventures", "fund"],
  ["Plural", "fund"], ["Air Street Capital", "fund"], ["Amadeus Capital Partners", "fund"], ["IQ Capital", "fund"],
  ["Oxford Science Enterprises", "fund"], ["Cambridge Innovation Capital", "fund"], ["SV Health Investors", "fund"],
  ["Syncona", "fund"], ["Advent Life Sciences", "fund"], ["Sofinnova Partners", "fund"], ["Medicxi", "fund"],
  ["F-Prime Capital", "fund"], ["Pentech Ventures", "fund"], ["Sapphire Ventures", "fund"], ["Lightspeed Venture Partners", "fund"],
  ["General Catalyst", "fund"], ["Highland Europe", "fund"], ["Smedvig Capital", "fund"], ["Beringea", "fund"],
  ["Mercia Ventures", "fund"], ["Foresight Group", "fund"], ["Pembroke VCT", "fund"], ["Downing Ventures", "fund"],
  ["Calculus Capital", "fund"], ["Blackfinch Ventures", "fund"], ["Triple Point Ventures", "fund"], ["Guinness Ventures", "fund"],
  ["Hambro Perks", "fund"], ["Crowdcube", "angel_network"], ["Seedrs", "angel_network"], ["Angel Academe", "angel_network"],
  ["Envestors", "angel_network"], ["London Business Angels", "angel_network"], ["Cambridge Angels", "angel_network"],
  ["Angel Investment Network", "angel_network"], ["Clean Growth Fund", "fund"], ["Pale Blue Dot", "fund"],
  ["Extantia Capital", "fund"], ["Systemiq Capital", "fund"], ["Kiko Ventures", "fund"], ["Zero Carbon Capital", "fund"],
  ["Founders Factory", "accelerator"], ["Techstars London", "accelerator"], ["Antler", "accelerator"],
  ["Zinc", "accelerator"], ["Conception X", "accelerator"], ["Carbon13", "accelerator"], ["Barclays Eagle Labs", "accelerator"],
  ["Plug and Play", "accelerator"], ["EWOR", "accelerator"], ["Y Combinator", "accelerator"], ["Bethnal Green Ventures", "accelerator"],
  ["Collider", "accelerator"], ["Google Ventures", "cvc"], ["Salesforce Ventures", "cvc"], ["BP Ventures", "cvc"],
  ["Shell Ventures", "cvc"], ["Octopus Energy Ventures", "cvc"], ["Santander InnoVentures", "cvc"], ["HSBC Ventures", "cvc"],
  ["Lloyds Banking Group Ventures", "cvc"], ["BT Ventures", "cvc"], ["Unilever Ventures", "cvc"], ["Samsung Next", "cvc"],
  ["Mundi Ventures", "fund"], ["Fly Ventures", "fund"], ["Seraphim Space", "fund"], ["Expeditions Fund", "fund"],
  ["Cavalry Ventures", "fund"], ["Jigsaw VC", "fund"], ["Nauta Capital", "fund"], ["Edge Ventures", "fund"],
  ["Fair by Design", "fund"], ["Twin Path Ventures", "fund"], ["Sie Ventures", "fund"], ["Kembara", "fund"],
  ["Visionaries Club", "fund"], ["20VC", "fund"], ["Point Nine", "fund"], ["Project A", "fund"], ["Redalpine", "fund"],
  ["Red Sea Ventures", "fund"], ["Latitude Ventures", "fund"], ["Emerge Education", "fund"], ["Brighteye Ventures", "fund"],
  ["Blossom Capital", "fund"], ["Elaia", "fund"], ["Lakestar", "fund"], ["Earlybird", "fund"], ["Partech", "fund"],
];

function rowName(r: Record<string, unknown>): string | undefined {
  for (const k of ["name", "Firm", "firm", "investor", "Investor", "fund", "Fund", "company", "accelerator", "Name"]) {
    if (typeof r[k] === "string" && (r[k] as string).trim()) return (r[k] as string).trim();
  }
  const first = Object.values(r).find((v) => typeof v === "string");
  return typeof first === "string" ? first.trim() : undefined;
}

function rowDescription(r: Record<string, unknown>, name: string): string | undefined {
  const parts = Object.values(r).filter((v): v is string => typeof v === "string" && v !== name);
  return parts.length ? parts.join(" · ").slice(0, 300) : undefined;
}

function mentionFor(name: string, ents: CalaEntityMention[] | null): CalaEntityMention | undefined {
  const k = investorKey(name);
  return (ents ?? []).find(
    (e) => ["Organization", "Company"].includes(e.entity_type) && (investorKey(e.name) === k || (e.mentions ?? []).some((m) => investorKey(m) === k)),
  );
}

const NOT_INVESTOR = /trade body|association|directory|marketplace only|not an investor/i;

async function discover(cala: ReturnType<typeof createCalaClient>): Promise<Candidate[]> {
  const found: Candidate[] = [];
  await Promise.all(DISCOVERY.map(async (d) => {
    try {
      const r = await cala.query(d.input);
      let n = 0;
      for (const row of r.results) {
        if ("error" in row) continue;
        const name = rowName(row);
        if (!name || name.length > 80) continue;
        const description = rowDescription(row, name);
        if (description && NOT_INVESTOR.test(description)) continue;
        const m = mentionFor(name, r.entities);
        found.push({ name, kind: d.kind, calaId: m?.id, description, via: `query: ${d.input}` });
        n++;
      }
      await log(`discover "${d.input}" -> ${n}`);
    } catch (e) {
      await log(`discover failed "${d.input}": ${(e as Error).message}`);
    }
  }));
  for (const [name, kind] of SEED_NAMES) found.push({ name, kind, via: "seed list" });
  return dedupeCandidates(found);
}

function dedupeCandidates(found: Candidate[]): Candidate[] {
  const by = new Map<string, Candidate>();
  for (const c of found) {
    const k = investorKey(c.name);
    const prev = by.get(k);
    if (!prev) by.set(k, c);
    else
      by.set(k, {
        ...prev,
        name: prev.name.length <= c.name.length && prev.name !== prev.name.toUpperCase() ? prev.name : c.name,
        calaId: prev.calaId ?? c.calaId,
        description: prev.description ?? c.description,
        kind: prev.via === "seed list" ? c.kind : prev.kind,
      });
  }
  return [...by.values()];
}

// ---------- per-investor fetch ----------

type RawInvestor = {
  slug: string;
  candidate: Candidate;
  fetchedAt: string;
  entity?: CalaEntity;
  resolvedFrom?: string;
  deals?: CalaQueryResponse;
  thesis?: CalaSearchResponse;
  classified?: Thesis;
  error?: string;
};

type Thesis = {
  summary: string;
  sectors: Partial<Record<Sector, number>>;
  stages: Partial<Record<Stage, number>>;
  partners: { name: string; role?: string }[];
};

function pickEntity(name: string, candidates: CalaEntityMention[]): CalaEntityMention | undefined {
  const k = investorKey(name);
  const same = candidates.filter((c) => investorKey(c.name) === k);
  if (!same.length) return undefined;
  const london = same.filter((c) => /london|united kingdom|\bu\.?k\.?\b|england|britain/i.test(c.description ?? ""));
  const pool = london.length ? london : same;
  return pool.find((c) => c.entity_type === "Organization" && c.name !== c.name.toUpperCase()) ?? pool[0];
}

const dealsQuery = (name: string) =>
  `funding_rounds.investors=${name}.date>=${DEALS_SINCE}.return(company, round_type, date, amount, sector).order_by=date DESC.limit=40`;

const thesisSearch = (name: string) =>
  `What does ${name} (London investor) say it invests in: which sectors, stages and cheque sizes? Who are its partners, and which startups has it backed since 2025?`;

async function fetchInvestor(cala: ReturnType<typeof createCalaClient>, c: Candidate): Promise<RawInvestor> {
  const raw: RawInvestor = { slug: slugify(c.name), candidate: c, fetchedAt: new Date().toISOString() };
  let id = c.calaId;
  if (!id) {
    const { entities } = await cala.searchEntities(c.name, ["Organization", "Company"]);
    const e = pickEntity(c.name, entities);
    if (!e) return { ...raw, error: "no matching Cala entity" };
    id = e.id;
    raw.resolvedFrom = `${e.name} (${e.entity_type})`;
  }
  const [entity, deals, thesis] = await Promise.all([
    cala.retrieve(id, {
      properties: ["name", "description", "website"],
      relationships: { outgoing: { INVESTED_IN: { limit: 300 } }, incoming: { WORKS_AT: { limit: 25 } } },
    }),
    cala.query(dealsQuery(c.name)),
    cala.search(thesisSearch(c.name)),
  ]);
  return { ...raw, entity, deals, thesis };
}

// ---------- Haiku classification ----------

const SECTOR_TOOL = {
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

const THESIS_TOOL = {
  name: "record_stated_thesis",
  description: "Record what the investor SAYS it invests in, from the provided text only.",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "One or two sentences, the investor's own stated focus" },
      sector_agnostic: { type: "boolean", description: "True if the investor calls itself sector-agnostic or generalist" },
      sectors: {
        type: "array",
        items: {
          type: "object",
          properties: { label: { type: "string", enum: [...ALL_SECTORS] }, weight: { type: "number" } },
          required: ["label", "weight"],
        },
      },
      stages: {
        type: "array",
        items: {
          type: "object",
          properties: { label: { type: "string", enum: [...STAGES] }, weight: { type: "number" } },
          required: ["label", "weight"],
        },
      },
      partners: {
        type: "array",
        items: {
          type: "object",
          properties: { name: { type: "string" }, role: { type: "string" } },
          required: ["name"],
        },
      },
    },
    required: ["summary", "sector_agnostic", "sectors", "stages", "partners"],
  },
};

async function classifySectors(companies: { company: string; hint?: string }[], cache: Record<string, Sector>) {
  const todo = companies.filter((c) => !(companyKey(c.company) in cache) || (cache[companyKey(c.company)] === "other" && c.hint));
  for (let i = 0; i < todo.length; i += 40) {
    const batch = todo.slice(i, i + 40);
    const list = batch.map((c, j) => `${j}. ${c.company}${c.hint ? ` (${c.hint})` : ""}`).join("\n");
    try {
      const out = (await haikuTool({
        system: `Classify startups into one of: ${ALL_SECTORS.join("; ")}. Use "other" only when nothing fits. Use the hint text; if unknown, infer from the name cautiously and prefer "other" over guessing.`,
        user: list,
        tool: SECTOR_TOOL,
        maxTokens: 2000,
      })) as { items?: { i: number; sector: string }[] } | null;
      for (const it of out?.items ?? []) {
        const c = batch[it.i];
        if (c && isSector(it.sector)) cache[companyKey(c.company)] = it.sector;
      }
    } catch (e) {
      await log(`sector classify failed: ${(e as Error).message}`);
    }
  }
}

function weights<K extends string>(items: { label: string; weight: number }[] | undefined, ok: (x: string) => x is K) {
  const out: Partial<Record<K, number>> = {};
  let total = 0;
  for (const it of items ?? []) {
    if (!ok(it.label) || !(it.weight > 0)) continue;
    out[it.label] = (out[it.label] ?? 0) + it.weight;
    total += it.weight;
  }
  if (total > 0) for (const k of Object.keys(out) as K[]) out[k] = out[k]! / total;
  return out;
}

async function classifyThesis(name: string, text: string): Promise<Thesis | undefined> {
  const out = (await haikuTool({
    system: `From text about a venture investor, record only what the investor states as its focus (not a list of past deals). Sectors from: ${SECTORS.join("; ")}. Stages from: ${STAGES.join(", ")}. Weights are relative emphasis. Leave sectors empty if the investor says it is sector-agnostic. Partners: only people the text names as partners, founders or investment team members of ${name}.`,
    user: `Investor: ${name}\n\n${text.slice(0, 6000)}`,
    tool: THESIS_TOOL,
    maxTokens: 800,
  })) as { summary?: string; sector_agnostic?: boolean; sectors?: { label: string; weight: number }[]; stages?: { label: string; weight: number }[]; partners?: { name: string; role?: string }[] } | null;
  if (!out) return undefined;
  return {
    summary: typeof out.summary === "string" ? out.summary : "",
    // A generalist names many sectors; treating that list as a thesis would invent contradictions.
    sectors: out.sector_agnostic ? {} : weights(out.sectors, isSector),
    stages: weights(out.stages, isStage),
    partners: (out.partners ?? []).filter((p) => typeof p?.name === "string" && text.includes(p.name)),
  };
}

// ---------- build ----------

const str = (x: unknown) => (typeof x === "string" && x.trim() && !/^[—–-]+$/.test(x.trim()) ? x.trim() : undefined);

// Query rows that describe the investor's own news rather than a portfolio round.
const NON_DEAL = /\b(own fund|fund raise|fund close|partnership|announced|launch(ed)?|acquisition of|exit)\b/i;

function buildDeals(r: RawInvestor, sectorCache: Record<string, Sector>): Deal[] {
  const edges = new Map<string, { id: string; sources: Source[] }>();
  for (const e of r.entity?.relationships?.outgoing?.INVESTED_IN ?? []) {
    const k = companyKey(e.name);
    const prev = edges.get(k);
    const sources = (e.properties?.sources ?? []).map(toSource).filter((s): s is Source => !!s);
    edges.set(k, { id: prev?.id ?? e.id, sources: dedupeSources([...(prev?.sources ?? []), ...sources], 4) });
  }
  const knowbits = r.thesis?.context ?? [];
  const byKey = new Map<string, Deal & { approx: boolean }>();
  for (const row of r.deals?.results ?? []) {
    if ("error" in row) continue;
    const company = str(row.company);
    if (!company || NON_DEAL.test(company) || investorKey(company) === investorKey(r.candidate.name)) continue;
    const round = normaliseRound(row.round_type);
    if (round === null) continue;
    const { date, approximate } = normaliseDate(row.date);
    const k = companyKey(company);
    const mention = mentionFor(company, r.deals?.entities ?? null) ??
      (r.deals?.entities ?? []).find((e) => (e.mentions ?? []).includes(company));
    const edge = edges.get(k) ?? (mention ? edges.get(companyKey(mention.name)) : undefined);
    const lower = company.toLowerCase();
    const cited = knowbits
      .filter((kb) => kb.content.toLowerCase().includes(lower))
      .flatMap((kb) => kb.origins.map(originToSource));
    let sources = dedupeSources([...(edge?.sources ?? []), ...cited], 4);
    if (!sources.length) sources = [{ name: "Cala knowledge query", date: r.fetchedAt.slice(0, 10) }];
    const deal: Deal & { approx: boolean } = {
      company,
      round,
      sector: sectorCache[k] ?? "other",
      sources,
      approx: approximate,
    };
    const calaId = mention?.id ?? edge?.id;
    if (calaId) deal.companyCalaId = calaId;
    if (date) deal.date = date;
    const amount = str(row.amount);
    if (amount && !/undisclosed|unknown|n\/a/i.test(amount)) {
      deal.amount = amount;
      const usd = parseAmountUsd(amount);
      if (usd) deal.amountUsd = usd;
    }
    const dk = `${k}|${round}`;
    const prev = byKey.get(dk);
    // Same company and round listed twice: keep the more precise date.
    if (!prev || (prev.approx && !approximate) || (!prev.date && date)) byKey.set(dk, deal);
  }
  const deals = [...byKey.values()].map((d) => {
    const { approx, ...deal } = d;
    void approx;
    return deal;
  });
  // The company+round key above misses a copy whose round came back "unknown".
  return dedupeDeals(deals).sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}

function buildPartners(r: RawInvestor): Partner[] {
  const out = new Map<string, Partner>();
  for (const e of r.entity?.relationships?.incoming?.WORKS_AT ?? []) {
    if (e.entity_type === "Person" && !/&/.test(e.name)) out.set(e.name.toLowerCase(), { calaId: e.id, name: e.name });
  }
  const people = (r.thesis?.entities ?? []).filter((e) => e.entity_type === "Person");
  for (const p of r.classified?.partners ?? []) {
    const ent = people.find((e) => e.name.toLowerCase() === p.name.toLowerCase() || (e.mentions ?? []).includes(p.name));
    if (!ent) continue;
    const prev = out.get(ent.name.toLowerCase());
    out.set(ent.name.toLowerCase(), { calaId: ent.id, name: ent.name, ...(p.role ? { role: p.role } : prev?.role ? { role: prev.role } : {}) });
  }
  return [...out.values()].slice(0, 8);
}

function buildInvestor(r: RawInvestor, sectorCache: Record<string, Sector>, now: Date): Investor | undefined {
  if (!r.entity || r.error) return undefined;
  const e = r.entity;
  const deals = buildDeals(r, sectorCache);
  const partners = buildPartners(r);
  const doors: Door[] = [];
  if (partners.length)
    doors.push({ kind: "warm_intro", label: `Warm intro to ${partners[0].name}`, via: partners.slice(0, 3).map((p) => p.name) });
  doors.push({ kind: "room", label: "Ask to be considered for a room" });
  const website = typeof e.properties?.website?.value === "string" ? (e.properties.website.value as string) : undefined;
  const thesisText = r.classified?.summary?.trim() ?? "";
  const inv = finalizeInvestor(
    {
      id: r.slug,
      calaId: e.id,
      name: r.candidate.name,
      kind: r.candidate.kind,
      description: e.description ?? r.candidate.description,
      ...(website ? { website: website.startsWith("http") ? website : `https://${website}` } : {}),
      statedThesis: {
        text: thesisText,
        sectors: thesisText ? (r.classified?.sectors ?? {}) : {},
        stages: thesisText ? (r.classified?.stages ?? {}) : {},
        sources: r.thesis ? searchSources(r.thesis, 6) : entitySources(e, 3),
      },
      deals,
      partners,
      doors,
    },
    now,
  );
  return inv;
}

async function build() {
  const files = (await fs.readdir(RAW_INV).catch(() => [] as string[])).filter((f) => f.endsWith(".json"));
  const sectorCache = await readJson<Record<string, Sector>>(SECTOR_CACHE, {});
  const now = new Date();
  const investors: Investor[] = [];
  const seenCala = new Set<string>();
  for (const f of files.sort()) {
    const r = await readJson<RawInvestor | null>(path.join(RAW_INV, f), null);
    if (!r) continue;
    const inv = buildInvestor(r, sectorCache, now);
    if (!inv || seenCala.has(inv.calaId)) continue;
    // An investor with no deals at all and no stated thesis carries nothing to rank on.
    if (!inv.deals.length && !inv.statedThesis.text) continue;
    seenCala.add(inv.calaId);
    investors.push(inv);
  }
  investors.sort((a, b) => b.revealed.dealCount24m - a.revealed.dealCount24m || a.name.localeCompare(b.name));
  await writeJson(OUT, investors);
  const deals = investors.flatMap((i) => i.deals);
  const pct = (n: number) => `${Math.round((100 * n) / Math.max(1, deals.length))}%`;
  await log(
    `build: ${investors.length} investors, ${deals.length} deals, dated ${pct(deals.filter((d) => d.date).length)}, ` +
      `amount ${pct(deals.filter((d) => d.amountUsd).length)}, round known ${pct(deals.filter((d) => d.round !== "unknown").length)}, ` +
      `url-sourced ${pct(deals.filter((d) => d.sources.some((s) => s.url)).length)}, thin ${investors.filter((i) => i.thinHistory).length}, ` +
      `contradiction lines ${investors.filter((i) => i.contradictionLine).length}`,
  );
}

// ---------- main ----------

type Checkpoint = { done: string[]; failed: Record<string, string>; calls: number };

async function main() {
  if (BUILD_ONLY) return build();

  const candidatesExist = await readJson<Candidate[] | null>(CANDIDATES, null);
  if (DRY) {
    const n = Math.min(LIMIT, candidatesExist?.length ?? DISCOVERY.length * 15 + SEED_NAMES.length);
    console.log(
      `dry run: ${candidatesExist ? `${candidatesExist.length} cached candidates` : `discovery = ${DISCOVERY.length} knowledge/query calls + ${SEED_NAMES.length} seed names`}; ` +
        `would fetch ${n} investors at ~3-4 Cala calls each (~${n * 4} max), cap ${MAX_CALLS}. No network used.`,
    );
    return;
  }
  if (!process.env.CALA_API_KEY) throw new Error("CALA_API_KEY missing: add it to .env.local (see BLOCKED.md)");
  if (!getAnthropic()) await log("ANTHROPIC_API_KEY missing: sectors fall back to 'other' and stated thesis stays empty");

  const cala = createCalaClient({
    cache: diskCache(path.join(ROOT, "data/cala-cache")),
    concurrency: CONCURRENCY,
    log: (m) => void log(m),
  });
  const cp = await readJson<Checkpoint>(CHECKPOINT, { done: [], failed: {}, calls: 0 });
  const callsBefore = cp.calls;

  let candidates = candidatesExist;
  if (!candidates) {
    candidates = await discover(cala);
    await writeJson(CANDIDATES, candidates);
    await log(`discovered ${candidates.length} candidates`);
  }
  const done = new Set(cp.done);
  const queue = candidates.filter((c) => !done.has(slugify(c.name))).slice(0, LIMIT);
  await log(`fetching ${queue.length} investors (${done.size} already done)`);

  const sectorCache = await readJson<Record<string, Sector>>(SECTOR_CACHE, {});
  let stopped = false;
  const saveCheckpoint = () => writeJson(CHECKPOINT, { ...cp, done: [...done], calls: callsBefore + cala.stats.ok });

  async function worker() {
    for (;;) {
      const c = queue.shift();
      if (!c) return;
      if (callsBefore + cala.stats.ok >= MAX_CALLS) {
        if (!stopped) await log(`call cap ${MAX_CALLS} reached; stopping`);
        stopped = true;
        return;
      }
      const slug = slugify(c.name);
      try {
        const raw = await fetchInvestor(cala, c);
        if (!raw.error) {
          const rows = (raw.deals?.results ?? []).filter((x) => !("error" in x));
          const bits = raw.thesis?.context ?? [];
          const hintFor = (company: string, sector?: string) => {
            const lower = company.toLowerCase();
            const kb = bits.find((b) => b.content.toLowerCase().includes(lower));
            const i = kb ? kb.content.toLowerCase().indexOf(lower) : -1;
            const snippet = kb ? kb.content.slice(Math.max(0, i - 40), i + 160).replace(/\s+/g, " ") : undefined;
            return [sector, snippet].filter(Boolean).join(" | ") || undefined;
          };
          await classifySectors(
            rows
              .map((x) => ({ company: String(x.company ?? ""), hint: hintFor(String(x.company ?? ""), str(x.sector)) }))
              .filter((x) => x.company),
            sectorCache,
          );
          await writeJson(SECTOR_CACHE, sectorCache);
          if (raw.thesis?.content) raw.classified = await classifyThesis(c.name, raw.thesis.content);
        }
        await writeJson(path.join(RAW_INV, `${slug}.json`), raw);
        done.add(slug);
        delete cp.failed[slug];
        await log(
          `ok ${c.name}${raw.error ? ` (${raw.error})` : `: ${(raw.deals?.results ?? []).length} rows, ${raw.entity?.relationships?.outgoing?.INVESTED_IN?.length ?? 0} edges`} [calls ${callsBefore + cala.stats.ok}]`,
        );
      } catch (e) {
        cp.failed[slug] = (e as Error).message;
        await log(`FAIL ${c.name}: ${(e as Error).message}`);
      }
      await saveCheckpoint();
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await saveCheckpoint();
  await log(`fetch done: successful calls this run ${cala.stats.ok}, requests incl. retries ${cala.stats.calls} (${JSON.stringify(cala.stats.byEndpoint)}), cache hits ${cala.stats.cacheHits}, retries ${cala.stats.retries}`);
  await build();
}

main().catch(async (e) => {
  await log(`fatal: ${(e as Error).stack ?? e}`);
  process.exit(1);
});
