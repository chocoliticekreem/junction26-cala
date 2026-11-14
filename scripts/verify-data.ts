// Verification pass over the Cala-derived data: every claim (deal, cohort round, the demo
// company's own facts) gets a trust level, persisted to data/verify.json and Valkey.
//
//   npm run verify-data                      title checks for all claims, page checks for the sample
//   npm run verify-data -- --sample 60       claims to page-check (default 60; Cala's own first)
//   npm run verify-data -- --no-pages        title checks only, no network
//   npm run verify-data -- --cohort <path>   cohort file (default data/cohort.json, else the fixture)
//   --haiku N        Haiku calls for borderline pages (default 60, counted in data/verify-cache/usage.json)
//   --context-dev N  Context.dev scrapes for pages a plain fetch cannot read (default 0, max 40)
//   --cala N         live Cala calls for the demo company's entities (default 10; cached calls are free)
//
// Incremental: fetched pages are cached in data/verify-cache/ (gitignored) and Haiku verdicts with
// them, so a re-run only spends on new URLs. LinkedIn is never fetched (link only).
import { createHash } from "node:crypto";
import { promises as fs, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { haikuTool } from "../lib/anthropic";
import {
  companyKey,
  createCalaClient,
  diskCache,
  fileBudget,
  investorKey,
  normaliseDate,
  normaliseRound,
  type CalaEdge,
  type CalaEntity,
} from "../lib/cala";
import { PROFILE_PROJECTION, ROUND_PROJECTION, issuerRoundIds } from "../lib/context/calaFacts";
import { scrapePage } from "../lib/context/website";
import { DATA_AS_OF } from "../lib/data";
import type { Cohort } from "../lib/sim/types";
import { pickRoundDate, roundStage } from "../lib/rounds";
import type { Investor } from "../lib/types";
import { closeValkey, valkeySetJson } from "../lib/valkey";
import { isBorderline, pageCheck } from "../lib/verify/checks";
import {
  cohortRoundClaim,
  ctxFounderId,
  ctxHeadcountId,
  ctxInvestorId,
  ctxRoundId,
  dealClaim,
  entityWarning,
} from "../lib/verify/claims";
import { excerptAround, htmlToText } from "../lib/verify/mention";
import { assessTrust, isInvestorProfileUrl, isSpecificUrl, sameRound, splitLeads, type RoundRef } from "../lib/verify/rules";
import { titleChecks } from "../lib/verify/store";
import type { Claim, ClaimSource, SourceCheck, Trust, TrustLevel, VerifyFile } from "../lib/verify/types";

const ROOT = path.resolve(__dirname, "..");
const CACHE = path.join(ROOT, "data/verify-cache");
const OUT = path.join(ROOT, "data/verify.json");
const USAGE = path.join(CACHE, "usage.json");
const VALKEY_KEY = "room:verify:v1";

// The demo company. Two Cala entities: "Cala" (founders, INVESTED_IN) and "Cala AI" (the round).
const DEMO_COMPANY = { name: "Cala", ids: ["2bdea5e8-a630-4098-9fb1-3f84bbaa77a2", "81cfdabc-53f7-426a-b358-a942e159ca0f"] };

try {
  process.loadEnvFile(path.join(ROOT, ".env.local"));
} catch {
  // no .env.local: --no-pages still works
}

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
}
function argStr(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

type Usage = { haiku: number; pageFetches: number; contextDev: number; cala: number };
async function readUsage(): Promise<Usage> {
  try {
    return { haiku: 0, pageFetches: 0, contextDev: 0, cala: 0, ...JSON.parse(await fs.readFile(USAGE, "utf8")) };
  } catch {
    return { haiku: 0, pageFetches: 0, contextDev: 0, cala: 0 };
  }
}

// ---------- page cache ----------

type CachedPage = { url: string; fetchedAt: string; status: number; via: "fetch" | "context.dev" | "skipped"; title?: string; text: string; haiku?: Record<string, HaikuVerdict> };
type HaikuVerdict = { mentionsSubject: boolean; statesRound: boolean; namesInvestor: boolean; note: string };

const pageFile = (url: string) => path.join(CACHE, createHash("sha1").update(url).digest("hex") + ".json");

async function readPage(url: string): Promise<CachedPage | undefined> {
  try {
    return JSON.parse(await fs.readFile(pageFile(url), "utf8")) as CachedPage;
  } catch {
    return undefined;
  }
}
async function writePage(p: CachedPage) {
  await fs.mkdir(CACHE, { recursive: true });
  await fs.writeFile(pageFile(p.url), JSON.stringify(p));
}

const isLinkedIn = (url: string) => /(^|\.)linkedin\.com$/i.test(new URL(url).hostname);

async function getPage(url: string, usage: Usage, contextDevLimit: number): Promise<CachedPage> {
  const hit = await readPage(url);
  if (hit && (hit.text.length >= 200 || hit.via !== "fetch" || usage.contextDev >= contextDevLimit)) return hit;
  if (isLinkedIn(url)) {
    const p: CachedPage = { url, fetchedAt: new Date().toISOString(), status: 0, via: "skipped", text: "" };
    await writePage(p);
    return p;
  }
  let page: CachedPage = hit ?? { url, fetchedAt: new Date().toISOString(), status: 0, via: "fetch", text: "" };
  if (!hit) {
    usage.pageFetches++;
    try {
      const res = await fetch(url, {
        headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/130 Safari/537.36", accept: "text/html,*/*" },
        redirect: "follow",
        signal: AbortSignal.timeout(20_000),
      });
      const type = res.headers.get("content-type") ?? "";
      const body = res.ok && /html|text|xml|json/.test(type) ? await res.text() : "";
      const { title, text } = htmlToText(body);
      page = { url, fetchedAt: new Date().toISOString(), status: res.status, via: "fetch", ...(title ? { title } : {}), text: text.slice(0, 80_000) };
    } catch (e) {
      page = { url, fetchedAt: new Date().toISOString(), status: 599, via: "fetch", text: "", title: e instanceof Error ? e.name : "error" };
    }
  }
  const worthScraping = ![404, 410].includes(page.status) && !/\.pdf(\?|$)|\/document\b/i.test(url) && !isInvestorProfileUrl(url);
  if (page.text.length < 200 && worthScraping && usage.contextDev < contextDevLimit) {
    usage.contextDev++;
    const s = await scrapePage(url);
    if (s?.markdown) page = { url, fetchedAt: new Date().toISOString(), status: 200, via: "context.dev", ...(s.title ? { title: s.title } : {}), text: s.markdown };
  }
  await writePage(page);
  return page;
}

// ---------- Haiku for borderline pages ----------

const VERDICT_TOOL = {
  name: "record_verdict",
  description: "Record whether the page excerpt supports the claim.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      mentions_subject: { type: "boolean", description: "The excerpt is about the named company (not a different company with a similar name)." },
      states_round: { type: "boolean", description: "The excerpt reports this funding round or its amount (or, for a person claim, the person's founder/CEO role at the company). False for a passing mention or a different round." },
      names_investor: { type: "boolean", description: "The excerpt names at least one of the claim's investors as taking part. False if no investor of the claim is named." },
      note: { type: "string", description: "One short sentence: what the page actually says about the company." },
    },
    required: ["mentions_subject", "states_round", "names_investor", "note"],
  },
};

function describe(c: Claim): string {
  if (c.kind === "founder") return `${c.person} founded or runs ${c.subject}.`;
  if (c.kind === "investor") return `${c.investors?.join(", ")} invested in ${c.subject}.`;
  if (c.kind === "headcount") return `${c.subject} headcount.`;
  const bits = [`${c.subject} raised a ${c.stage ?? "funding"} round`];
  if (c.amountText ?? c.amountUsd) bits.push(`of ${c.amountText ?? `$${c.amountUsd}`}`);
  if (c.date) bits.push(`around ${c.date}`);
  if (c.investors?.length) bits.push(`with ${c.investors.slice(0, 5).join(", ")}`);
  return bits.join(" ") + ".";
}

async function haikuVerdict(c: Claim, page: CachedPage, usage: Usage, limit: number): Promise<HaikuVerdict | undefined> {
  const key = createHash("sha1").update(`v2 ${describe(c)}`).digest("hex").slice(0, 12);
  if (page.haiku?.[key]) return page.haiku[key];
  if (usage.haiku >= limit) return undefined;
  usage.haiku++;
  const names = [c.subject, ...(c.person ? [c.person] : [])];
  try {
    const raw = (await haikuTool({
      system: "You check whether a web page supports a factual claim about a startup. Judge only from the excerpt. Be strict: a passing mention or a different company with a similar name does not support the claim.",
      user: `Claim: ${describe(c)}\nPage: ${page.url}\nTitle: ${page.title ?? ""}\n\nExcerpt:\n${excerptAround(page.text, names, 3000)}`,
      tool: VERDICT_TOOL,
      maxTokens: 300,
      strict: true,
    })) as { mentions_subject?: boolean; states_round?: boolean; names_investor?: boolean; note?: string } | null;
    if (!raw) return undefined;
    const v: HaikuVerdict = {
      mentionsSubject: !!raw.mentions_subject,
      statesRound: !!raw.states_round,
      namesInvestor: !!raw.names_investor,
      note: String(raw.note ?? "").slice(0, 200),
    };
    page.haiku = { ...(page.haiku ?? {}), [key]: v };
    await writePage(page);
    return v;
  } catch (e) {
    console.warn("haiku:", e instanceof Error ? e.message : e);
    return undefined;
  }
}

// ---------- the demo company's claims, from its raw entities (every edge source) ----------

type RawSource = { name?: unknown; document?: unknown; date?: unknown; source_rank?: unknown };
function claimSources(raw: unknown): ClaimSource[] {
  if (!Array.isArray(raw)) return [];
  const out: ClaimSource[] = [];
  for (const s of raw as RawSource[]) {
    const url = typeof s.document === "string" && /^https?:\/\//.test(s.document) ? s.document : undefined;
    const name = typeof s.name === "string" && s.name.trim() ? s.name.trim() : url;
    if (!name) continue;
    const rank = s.source_rank === "FILING" || s.source_rank === "PRIMARY" || s.source_rank === "PRESS" || s.source_rank === "AGGREGATOR" ? s.source_rank : undefined;
    if (out.some((o) => o.url === url && o.name === name)) continue;
    out.push({ name, ...(url ? { url } : {}), ...(typeof s.date === "string" ? { date: s.date } : {}), ...(rank ? { rank } : {}) });
  }
  return out;
}

const val = (e: CalaEntity, k: string) => e.properties?.[k]?.value;
const edgesOf = (e: CalaEntity, dir: "incoming" | "outgoing", rel: string): CalaEdge[] => e.relationships?.[dir]?.[rel] ?? [];

async function demoCompanyClaims(calaLimit: number, usage: Usage): Promise<{ claims: Claim[]; notes: string[] }> {
  const budget = fileBudget(path.join(CACHE, "cala-usage.json"), calaLimit);
  const cala = createCalaClient({ cache: diskCache(path.join(ROOT, "data/cala-cache")), budget, concurrency: 1, maxRetries: 3 });
  const notes: string[] = [];
  const entities: CalaEntity[] = [];
  for (const id of DEMO_COMPANY.ids) {
    try {
      entities.push(await cala.retrieve(id, PROFILE_PROJECTION));
    } catch (e) {
      notes.push(`could not read ${id}: ${e instanceof Error ? e.message : e}`);
    }
  }
  const roundIds = [...new Set(entities.flatMap(issuerRoundIds))];
  const rounds: CalaEntity[] = [];
  for (const id of roundIds) {
    try {
      rounds.push(await cala.retrieve(id, ROUND_PROJECTION));
    } catch (e) {
      notes.push(`could not read round ${id}: ${e instanceof Error ? e.message : e}`);
    }
  }
  usage.cala += cala.stats.ok;
  const name = DEMO_COMPANY.name;
  const claims: Claim[] = [];
  for (const r of rounds) {
    const parts = edgesOf(r, "incoming", "PARTICIPATES_IN_FUNDING_ROUND");
    const investors = parts.filter((p) => p.properties?.role !== "ISSUER");
    const value = Number(val(r, "transaction_value"));
    const units = String(val(r, "transaction_value_units") ?? "USD").toUpperCase();
    const fx = units === "EUR" ? 1.08 : units === "GBP" ? 1.27 : 1;
    const event = typeof val(r, "event_date") === "string" ? String(val(r, "event_date")).slice(0, 10) : undefined;
    const announced = typeof val(r, "announcement_date") === "string" ? String(val(r, "announcement_date")).slice(0, 10) : undefined;
    const picked = pickRoundDate(event, announced, val(r, "event_date__precision"));
    const sources = claimSources([
      ...parts.flatMap((p) => (p.properties?.sources as unknown[]) ?? []),
      ...["transaction_value", "announcement_date", "event_date"].flatMap((k) => (r.properties?.[k]?.sources as unknown[]) ?? []),
    ]);
    const label = String(val(r, "name") ?? r.name);
    // The claim as the app states it today (lib/context/calaFacts.ts roundFromEntity).
    claims.push({
      id: ctxRoundId(name, { id: r.id, label }),
      kind: "round",
      subject: name,
      investors: investors.map((p) => p.name),
      leads: investors.filter((p) => p.properties?.is_lead === true).map((p) => p.name),
      stage: roundStage(val(r, "round_label"), label) ?? "unknown",
      label,
      ...(picked.date ? { date: picked.date } : {}),
      ...(picked.precision ? { datePrecision: picked.precision } : {}),
      ...(event && announced ? { announcementDate: announced } : {}),
      ...(Number.isFinite(value) && value > 0 ? { amountUsd: Math.round(value * fx), amountText: `${units} ${value.toLocaleString("en-GB")}` } : {}),
      sources,
    });
  }
  // Investors: round participants and INVESTED_IN edges, every source each edge carries.
  const inv = new Map<string, { name: string; sources: unknown[] }>();
  const addInv = (n: string, s: unknown) => {
    const k = ctxInvestorId(name, n);
    const cur = inv.get(k) ?? { name: n, sources: [] };
    cur.sources.push(...((s as unknown[]) ?? []));
    inv.set(k, cur);
  };
  for (const r of rounds)
    for (const p of edgesOf(r, "incoming", "PARTICIPATES_IN_FUNDING_ROUND")) if (p.properties?.role !== "ISSUER") addInv(p.name, p.properties?.sources);
  for (const e of entities) for (const p of edgesOf(e, "incoming", "INVESTED_IN")) addInv(p.name, p.properties?.sources);
  for (const [id, v] of inv) claims.push({ id, kind: "investor", subject: name, investors: [v.name], sources: claimSources(v.sources) });
  // Founders and CEO.
  const people = new Map<string, { name: string; sources: unknown[] }>();
  for (const e of entities)
    for (const rel of ["FOUNDED", "IS_CEO_OF"])
      for (const p of edgesOf(e, "incoming", rel)) {
        const id = ctxFounderId(name, p.name);
        const cur = people.get(id) ?? { name: p.name, sources: [] };
        cur.sources.push(...((p.properties?.sources as unknown[]) ?? []));
        people.set(id, cur);
      }
  // Round reports usually name the founders, so they are checked as extra sources for each person.
  const roundSources = claims.filter((c) => c.kind === "round").flatMap((c) => c.sources.filter((s) => s.rank && isSpecificUrl(s.url)));
  for (const [id, v] of people) {
    const own = claimSources(v.sources);
    const extra = roundSources.filter((s) => !own.some((o) => o.url === s.url));
    claims.push({ id, kind: "founder", subject: name, person: v.name, sources: [...own, ...extra] });
  }
  const hc = entities.find((e) => e.properties?.employee_count_range);
  if (hc) claims.push({ id: ctxHeadcountId(name), kind: "headcount", subject: name, sources: claimSources(hc.properties.employee_count_range.sources) });
  return { claims, notes };
}

// ---------- sample selection ----------

function specificUrls(c: Claim, max: number): string[] {
  const rankScore = (s: ClaimSource) =>
    ({ FILING: 0, PRIMARY: 1, PRESS: 2, AGGREGATOR: 3 })[s.rank ?? "AGGREGATOR"] + (s.rank ? 0 : 0.5) + (isInvestorProfileUrl(s.url) ? 10 : 0);
  return [...new Set(c.sources.filter((s) => isSpecificUrl(s.url) && !isLinkedIn(s.url!)).sort((a, b) => rankScore(a) - rankScore(b)).map((s) => s.url!))].slice(0, max);
}

// Deterministic: Cala's own claims, then graph deals, query deals with a URL, cohort rounds with a
// URL, interleaved and spread across investors by a stable hash.
function pickSample(demo: Claim[], deals: Claim[], rounds: Claim[], n: number): Claim[] {
  const h = (s: string) => createHash("sha1").update(s).digest("hex");
  const stable = (xs: Claim[]) => xs.filter((c) => specificUrls(c, 1).length).sort((a, b) => h(a.id).localeCompare(h(b.id)));
  const graph = stable(deals.filter((c) => !c.fromQuery));
  const query = stable(deals.filter((c) => c.fromQuery));
  const cohort = stable(rounds);
  const out = [...demo];
  const quota = Math.max(0, n - out.length);
  const take = (xs: Claim[], k: number) => xs.slice(0, k);
  out.push(...take(graph, Math.round(quota * 0.3)), ...take(query, Math.round(quota * 0.45)), ...take(cohort, quota - Math.round(quota * 0.3) - Math.round(quota * 0.45)));
  return out;
}

// ---------- cross-query lead consistency ----------

// One answer about who led a round: a cached knowledge/query row (lead_investors text), the
// FundingRound entity (is_lead flags, as carried by graph deals), or a cohort round.
type LeadAnswer = RoundRef & { origin: string; leads: string[]; fromQuery: boolean };

// "Theker Robotics" and "Theker" are the same company in different answers: index under the full
// key and a distinctive first word. sameRound (date, stage, label) guards against false pairs.
function companyKeys(name: string): string[] {
  const full = companyKey(name);
  const first = companyKey(name.trim().split(/\s+/)[0] ?? "");
  return first.length >= 4 && first !== full ? [full, first] : [full];
}

async function buildLeadIndex(investors: Investor[], cohort: Cohort): Promise<Map<string, LeadAnswer[]>> {
  const index = new Map<string, LeadAnswer[]>();
  const add = (company: string, a: LeadAnswer) => {
    if (!a.leads.length) return;
    for (const key of companyKeys(company)) {
      const list = index.get(key) ?? [];
      if (!list.some((x) => x.origin === a.origin)) list.push(a);
      index.set(key, list);
    }
  };
  const dir = path.join(ROOT, "data/cala-cache");
  for (const f of existsSync(dir) ? await fs.readdir(dir) : []) {
    if (!f.endsWith(".json")) continue;
    let j: { key?: string; value?: { results?: Record<string, unknown>[] } };
    try {
      j = JSON.parse(await fs.readFile(path.join(dir, f), "utf8"));
    } catch {
      continue;
    }
    if (!j.key?.startsWith("POST /v1/knowledge/query")) continue;
    for (const [i, row] of (j.value?.results ?? []).entries()) {
      if (!row || typeof row.company !== "string" || !("lead_investors" in row || "lead_investor" in row)) continue;
      const stage = normaliseRound(row.round_type);
      if (stage === null) continue;
      const label = typeof row.round_type === "string" ? row.round_type : undefined;
      add(row.company, { origin: `query:${j.key}#${i}`, stage, label, date: normaliseDate(row.date).date, leads: splitLeads(row.lead_investors ?? row.lead_investor), fromQuery: true });
    }
  }
  const graph = new Map<string, { company: string; ref: RoundRef; leads: string[] }>();
  for (const inv of investors)
    for (const d of inv.deals) {
      if (!d.roundId || d.isLead !== true) continue;
      const g = graph.get(d.roundId) ?? { company: d.company, ref: { stage: d.round, date: d.date }, leads: [] };
      g.leads.push(inv.name);
      graph.set(d.roundId, g);
    }
  for (const [id, g] of graph) add(g.company, { origin: `graph:${id}`, ...g.ref, leads: g.leads, fromQuery: false });
  for (const r of Object.values(cohort.rounds)) {
    const co = cohort.companies[r.companyId];
    const leads = r.participants.filter((p) => p.isLead).map((p) => p.name);
    if (co) add(co.name, { origin: `cohort:${r.id}`, stage: r.stage, label: r.label, date: r.date, leads, fromQuery: r.id.startsWith("q:") });
  }
  return index;
}

// A query-built claim whose leads exactly equal a cached query row may be that same row read
// twice, so identical query answers are dropped for query claims; graph answers always count.
function attachLeadAnswers(claims: Claim[], index: Map<string, LeadAnswer[]>): { checked: number } {
  let checked = 0;
  for (const c of claims) {
    if (!c.leads?.length) continue;
    const self = c.id.startsWith("round:") ? `cohort:${c.id.slice(6)}` : c.id.includes(":round:") ? `graph:${c.id.split(":round:")[1]}` : undefined;
    const mine = new Set(c.leads.map((n) => investorKey(n)));
    const same = (a: LeadAnswer) => a.leads.length === mine.size && a.leads.every((n) => mine.has(investorKey(n)));
    const answers = [...new Map(companyKeys(c.subject).flatMap((k) => index.get(k) ?? []).map((a) => [a.origin, a])).values()]
      .filter((a) => a.origin !== self && sameRound(a, c))
      .filter((a) => !(a.fromQuery && c.leadFrom === "query" && same(a)))
      .filter((a) => !(c.kind === "deal" && a.origin === `graph:${c.id.split(":")[2]}`));
    if (answers.length) {
      c.leadAnswers = answers.map((a) => a.leads);
      checked++;
    }
  }
  return { checked };
}

// ---------- main ----------

async function main() {
  const sampleN = arg("sample", 60);
  const haikuLimit = arg("haiku", 60);
  const contextDevLimit = Math.min(40, arg("context-dev", 0));
  const calaLimit = arg("cala", 10);
  const pages = !flag("no-pages");
  await fs.mkdir(CACHE, { recursive: true });
  const usage = await readUsage();
  const start = { ...usage };

  const investors = JSON.parse(readFileSync(path.join(ROOT, "data/investors.json"), "utf8")) as Investor[];
  const snapshot = JSON.parse(readFileSync(path.join(ROOT, "data/cala-snapshot.json"), "utf8")) as { entities: Record<string, { description?: string }> };
  const cohortPath = argStr("cohort") ?? (existsSync(path.join(ROOT, "data/cohort.json")) ? path.join(ROOT, "data/cohort.json") : path.join(ROOT, "data/cohort.fixture.json"));
  const cohort = JSON.parse(readFileSync(cohortPath, "utf8")) as Cohort;

  const dealClaims = investors.flatMap((inv) => {
    const w = entityWarning(snapshot.entities[inv.calaId]?.description, "investor");
    return inv.deals.map((d) => dealClaim(inv, d, { entityWarnings: w ? [w] : [] }));
  });
  const roundClaims = Object.values(cohort.rounds).map((r) => cohortRoundClaim(cohort, r));
  const { claims: demo, notes } = await demoCompanyClaims(calaLimit, usage);
  for (const n of notes) console.warn(n);
  const leadIndex = await buildLeadIndex(investors, cohort);
  const leadStats = attachLeadAnswers([...demo, ...dealClaims, ...roundClaims], leadIndex);
  console.log(`lead answers: ${[...leadIndex.values()].reduce((n, l) => n + l.length, 0)} answers naming a lead across ${leadIndex.size} companies, ${leadStats.checked} claims cross-checked`);
  const all = [...demo, ...dealClaims, ...roundClaims];
  console.log(`claims: ${demo.length} demo company, ${dealClaims.length} deals, ${roundClaims.length} cohort rounds (${path.relative(ROOT, cohortPath)})`);

  const evidence: Record<string, SourceCheck[]> = {};
  if (pages) {
    const sample = pickSample(demo, dealClaims, roundClaims, sampleN);
    console.log(`page-checking ${sample.length} claims`);
    for (const c of sample) {
      const checks: SourceCheck[] = [];
      for (const url of specificUrls(c, c.kind === "deal" || c.kind === "round" ? 2 : 4)) {
        const page = await getPage(url, usage, contextDevLimit);
        let chk = pageCheck(c, url, page.text ? page : undefined);
        if (page.via === "skipped") chk = { url, method: "page", status: "unreachable", note: "LinkedIn is not fetched" };
        if (isBorderline(c, chk)) {
          const v = await haikuVerdict(c, page, usage, haikuLimit);
          if (v)
            chk = {
              ...chk,
              method: "haiku",
              mentionsSubject: c.person ? chk.mentionsSubject === true || v.mentionsSubject : v.mentionsSubject,
              ...(c.person ? { mentionsPerson: v.statesRound } : { mentionsAmount: v.statesRound, mentionsInvestor: v.namesInvestor }),
              note: v.note,
            };
        }
        checks.push(chk);
      }
      evidence[c.id] = checks;
    }
  }

  const asOf = DATA_AS_OF.toISOString();
  const trust: Record<string, Trust> = {};
  const summary: VerifyFile["summary"] = {};
  const blank = (): Record<TrustLevel, number> => ({ verified: 0, corroborated: 0, single_source: 0, unverified: 0, conflict: 0 });
  for (const c of all) {
    const t = assessTrust(c, [...(evidence[c.id] ?? []), ...titleChecks(c)], asOf);
    trust[c.id] = t;
    const group = c.id.startsWith("ctx:") ? "demo_company" : c.kind === "deal" ? (c.fromQuery ? "deals_query" : "deals_graph") : c.fixture ? "cohort_fixture" : "cohort";
    (summary[group] ??= blank())[t.level]++;
    if (t.fields?.lead) (summary.lead_field ??= blank())[t.fields.lead]++;
  }
  const file: VerifyFile = { version: 1, generatedAt: new Date().toISOString(), asOf, summary, evidence, trust };
  await fs.writeFile(OUT, JSON.stringify(file));
  await fs.writeFile(USAGE, JSON.stringify(usage));
  await valkeySetJson(VALKEY_KEY, file).catch(() => undefined);
  await closeValkey().catch(() => undefined);

  console.log("\nsummary (claims by trust level):");
  console.table(summary);
  console.log("\ndemo company:");
  for (const c of demo) console.log(`  ${trust[c.id].level.padEnd(13)} ${c.id}  ${trust[c.id].reasons.join("; ")}`);
  const spent = Object.fromEntries(Object.entries(usage).map(([k, v]) => [k, v - start[k as keyof Usage]]));
  console.log(`\nthis run: ${JSON.stringify(spent)}  cumulative: ${JSON.stringify(usage)}`);
  console.log(`wrote ${path.relative(ROOT, OUT)} (${Object.keys(trust).length} claims, ${Object.keys(evidence).length} with page evidence)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
