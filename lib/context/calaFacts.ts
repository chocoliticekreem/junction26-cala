// Cala side of the account memory: company resolve ("Is this you?") and the graph facts for the
// context doc. Pure assembly functions are exported for tests; fetchers take the cached client.
import {
  CalaBudgetError,
  FX_TO_USD,
  companyKey,
  normaliseDate,
  normaliseRound,
  type CalaClient,
  type CalaEdge,
  type CalaEntity,
  type CalaEntityMention,
  type CalaProjection,
  type CalaRawSource,
} from "@/lib/cala";
import { pickRoundDate } from "@/lib/rounds";
import type {
  CalaFacts,
  CompanyCandidate,
  Confidence,
  ContextInvestor,
  ContextPerson,
  ContextRound,
  RankedSource,
  ResolveResult,
  SourceRank,
} from "./types";

// One projection for resolve and build, so the build reads what resolve already cached.
export const PROFILE_PROJECTION: CalaProjection = {
  properties: [
    "name",
    "website",
    "description",
    "founding_date",
    "headquarters_address",
    "funding_stage",
    "employee_count_range",
  ],
  relationships: {
    outgoing: { PARTICIPATES_IN_FUNDING_ROUND: { limit: 20 } },
    incoming: { FOUNDED: { limit: 10 }, IS_CEO_OF: { limit: 3 }, INVESTED_IN: { limit: 30 } },
  },
};

// Byte-identical to the ingest's round projection, so rounds the ingest fetched are cache hits.
export const ROUND_PROJECTION: CalaProjection = {
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

const MAX_RESOLVE_RETRIEVALS = 4;
const MAX_SIBLING_RETRIEVALS = 3;
const MAX_ROUNDS = 6;
const RANKS: SourceRank[] = ["FILING", "PRIMARY", "PRESS", "AGGREGATOR"];

// ---------- pure helpers ----------

export function domainOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const s = url.trim().toLowerCase();
  if (!s) return undefined;
  try {
    const host = new URL(/^https?:\/\//.test(s) ? s : `https://${s}`).hostname;
    return host.replace(/^www\./, "") || undefined;
  } catch {
    return undefined;
  }
}

export function rankedSource(s: CalaRawSource & { source_rank?: unknown }): RankedSource | undefined {
  const url =
    typeof s.document === "string" && /^https?:\/\//.test(s.document)
      ? s.document
      : typeof s.url === "string" && /^https?:\/\//.test(s.url)
        ? s.url
        : undefined;
  const name = typeof s.name === "string" && s.name.trim() ? s.name.trim() : url ? new URL(url).hostname : undefined;
  if (!name) return undefined;
  const out: RankedSource = { name };
  if (url) out.url = url;
  if (typeof s.date === "string" && s.date) out.date = s.date;
  if (typeof s.source_rank === "string" && (RANKS as string[]).includes(s.source_rank)) out.rank = s.source_rank as SourceRank;
  return out;
}

// Best citable source: one with a URL, preferring filings and the company's own pages.
export function bestSource(raw: unknown): RankedSource | undefined {
  if (!Array.isArray(raw)) return undefined;
  const all = raw.map((s) => rankedSource(s as CalaRawSource)).filter((s): s is RankedSource => !!s);
  const order = (s: RankedSource) => (s.url ? 0 : 10) + (s.rank ? RANKS.indexOf(s.rank) : 5);
  return all.sort((a, b) => order(a) - order(b))[0];
}

function text(v: unknown): string | undefined {
  if (typeof v === "string") return v.trim() || undefined;
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) {
    const parts = v.map(text).filter(Boolean);
    return parts.length ? parts.join(", ") : undefined;
  }
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const parts = ["city", "locality", "region", "country"].map((k) => text(o[k])).filter(Boolean);
    return parts.length ? parts.join(", ") : text(o.value ?? o.name ?? o.address);
  }
  return undefined;
}

function prop(e: CalaEntity, key: string): string | undefined {
  return text(e.properties?.[key]?.value);
}

function propSource(e: CalaEntity, key: string): RankedSource | undefined {
  return bestSource(e.properties?.[key]?.sources);
}

export function headcountText(v: unknown): string | undefined {
  if (!Array.isArray(v)) return text(v);
  const nums = v.filter((x): x is number => typeof x === "number");
  if (nums.length === 1) return String(nums[0]);
  if (nums.length >= 2) return `${nums[0]}–${nums[1]}`;
  return undefined;
}

function yearOf(date: string | undefined): string | undefined {
  return date?.match(/\b(19|20)\d{2}\b/)?.[0];
}

export function scoreCandidate(
  input: { name: string; website?: string; hq?: string },
  c: { name: string; website?: string; hq?: string },
): { confidence: Confidence; score: number } {
  const want = domainOf(input.website);
  if (want && domainOf(c.website) === want) return { confidence: "website", score: 1 };
  const exact = companyKey(input.name) === companyKey(c.name);
  const hqMatch = !!input.hq && !!c.hq && c.hq.toLowerCase().includes(input.hq.trim().toLowerCase());
  if (exact && hqMatch) return { confidence: "name_hq", score: 0.7 };
  return { confidence: "name", score: exact ? 0.5 : 0.3 };
}

// Never auto-picks on name alone when several candidates exist.
export function pickCandidate(cands: CompanyCandidate[]): string | undefined {
  const byWebsite = cands.filter((c) => c.confidence === "website");
  if (byWebsite.length) return byWebsite[0].calaId;
  if (cands.length === 1 && cands[0].score >= 0.5) return cands[0].calaId;
  return undefined;
}

export function rankMentions(name: string, mentions: CalaEntityMention[]): CalaEntityMention[] {
  const key = companyKey(name);
  const lower = name.trim().toLowerCase();
  const order = (m: CalaEntityMention) =>
    companyKey(m.name) === key ? 0 : m.name.toLowerCase().startsWith(lower) ? 1 : 2;
  return [...mentions].sort((a, b) => order(a) - order(b) || a.name.length - b.name.length);
}

function shortDescription(d: string | null | undefined): string | undefined {
  if (!d) return undefined;
  return d.length > 160 ? d.slice(0, 157).trimEnd() + "..." : d;
}

export function candidateFromEntity(
  input: { name: string; website?: string; hq?: string },
  e: CalaEntity | undefined,
  m: CalaEntityMention,
): CompanyCandidate {
  const website = e ? prop(e, "website") : undefined;
  const hq = e ? prop(e, "headquarters_address") : undefined;
  const foundingDate = e ? yearOf(prop(e, "founding_date")) : undefined;
  const { confidence, score } = scoreCandidate(input, { name: m.name, website, hq });
  const c: CompanyCandidate = { calaId: m.id, name: m.name, confidence, score };
  if (website) c.website = website;
  if (hq) c.hq = hq;
  if (foundingDate) c.foundingDate = foundingDate;
  const description = shortDescription(e?.description ?? m.description);
  if (description) c.description = description;
  return c;
}

export function groupSiblings(cands: CompanyCandidate[]): CompanyCandidate[] {
  return cands.map((c) => {
    const d = domainOf(c.website);
    const siblings = d ? cands.filter((o) => o.calaId !== c.calaId && domainOf(o.website) === d).map((o) => o.calaId) : [];
    return siblings.length ? { ...c, siblingIds: siblings } : c;
  });
}

function edges(e: CalaEntity, dir: "incoming" | "outgoing", rel: string): CalaEdge[] {
  return e.relationships?.[dir]?.[rel] ?? [];
}

export function issuerRoundIds(e: CalaEntity): string[] {
  return edges(e, "outgoing", "PARTICIPATES_IN_FUNDING_ROUND")
    .filter((r) => (r.properties?.role ?? "ISSUER") === "ISSUER")
    .map((r) => r.id);
}

function amountOf(r: CalaEntity): { amountUsd?: number; amountText?: string } {
  const raw = r.properties?.transaction_value?.value;
  const units = text(r.properties?.transaction_value_units?.value)?.toUpperCase();
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.replace(/,/g, "")) : NaN;
  if (!Number.isFinite(n) || n <= 0) return {};
  const fx = units && units in FX_TO_USD ? FX_TO_USD[units as keyof typeof FX_TO_USD] : units ? undefined : 1;
  const out: { amountUsd?: number; amountText?: string } = { amountText: `${units ?? "USD"} ${n.toLocaleString("en-GB")}` };
  if (fx !== undefined) out.amountUsd = Math.round(n * fx);
  return out;
}

export function roundFromEntity(r: CalaEntity): ContextRound {
  const label = prop(r, "name") ?? r.name;
  const labelCode = prop(r, "round_label")?.replace(/_/g, " ");
  const stage = normaliseRound(label) ?? "unknown";
  const stageFromCode = labelCode ? normaliseRound(labelCode) : undefined;
  const date = pickRoundDate(prop(r, "event_date"), prop(r, "announcement_date"), prop(r, "event_date__precision")).date;
  const parts = edges(r, "incoming", "PARTICIPATES_IN_FUNDING_ROUND").filter((p) => p.properties?.role !== "ISSUER");
  const sources: RankedSource[] = [];
  for (const p of parts) {
    const s = bestSource(p.properties?.sources);
    if (s && !sources.some((x) => x.url === s.url && x.name === s.name)) sources.push(s);
  }
  for (const key of ["transaction_value", "announcement_date", "name"]) {
    const s = propSource(r, key);
    if (s && !sources.some((x) => x.url === s.url && x.name === s.name)) sources.push(s);
  }
  return {
    id: r.id,
    label,
    stage: stage === "unknown" && stageFromCode ? stageFromCode : stage,
    ...(date ? { date } : {}),
    ...amountOf(r),
    leads: parts.filter((p) => p.properties?.is_lead === true).map((p) => p.name),
    investors: parts.map((p) => p.name),
    sources: sources.slice(0, 4),
  };
}

function splitNames(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(text).filter((s): s is string => !!s);
  const s = text(v);
  return s ? s.split(/\s*[,;]\s*/).filter(Boolean) : [];
}

// Rows of `funding_rounds.company=<name>.return(...)`. The query answer has no per-row URL.
export function roundsFromQuery(rows: Record<string, unknown>[]): ContextRound[] {
  const out: ContextRound[] = [];
  for (const row of rows) {
    const label = text(row.round_type ?? row.round ?? row.name);
    if (!label) continue;
    const amountText = text(row.amount);
    const amount = typeof row.amount === "number" ? row.amount : undefined;
    const date = normaliseDate(text(row.date)).date;
    const leads = splitNames(row.lead_investors);
    const investors = [...new Set([...leads, ...splitNames(row.investors)])];
    out.push({
      label,
      stage: normaliseRound(label) ?? "unknown",
      ...(date ? { date } : {}),
      ...(amountText ? { amountText } : {}),
      ...(amount ? { amountUsd: amount } : {}),
      leads,
      investors,
      sources: [{ name: "Cala knowledge query" }],
    });
  }
  return out;
}

function people(es: CalaEntity[], rel: string, role?: string): ContextPerson[] {
  const out: ContextPerson[] = [];
  for (const e of es)
    for (const p of edges(e, "incoming", rel)) {
      if (out.some((o) => o.name.toLowerCase() === p.name.toLowerCase())) continue;
      const src = bestSource(p.properties?.sources);
      out.push({ name: p.name, calaId: p.id, ...(role ? { role } : {}), ...(src ? { source: src } : {}) });
    }
  return out;
}

// Merges a primary entity, same-company siblings and their rounds into one fact set.
export function assembleCalaFacts(primary: CalaEntity, siblings: CalaEntity[], rounds: ContextRound[]): CalaFacts {
  const all = [primary, ...siblings];
  const first = (key: string) => all.map((e) => prop(e, key)).find(Boolean);
  const firstSrc = (key: string) => all.map((e) => propSource(e, key)).find(Boolean);

  const founders = people(all, "FOUNDED");
  for (const ceo of people(all, "IS_CEO_OF", "CEO")) {
    const f = founders.find((x) => x.name.toLowerCase() === ceo.name.toLowerCase());
    if (f) f.role = f.role ?? "CEO";
    else founders.push(ceo);
  }

  const sorted = [...rounds].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const investors: ContextInvestor[] = [];
  const add = (inv: ContextInvestor) => {
    const i = investors.findIndex((x) => companyKey(x.name) === companyKey(inv.name));
    if (i < 0) investors.push(inv);
    else investors[i] = { ...inv, ...investors[i], lead: investors[i].lead || inv.lead, round: investors[i].round ?? inv.round };
  };
  for (const r of sorted) for (const name of r.investors) add({ name, round: r.label, lead: r.leads.includes(name), source: r.sources[0] });
  for (const e of all)
    for (const p of edges(e, "incoming", "INVESTED_IN")) {
      const src = bestSource(p.properties?.sources);
      add({ name: p.name, calaId: p.id, ...(src ? { source: src } : {}) });
    }

  const hcEntity = all.find((e) => e.properties?.employee_count_range);
  const hc = hcEntity ? headcountText(hcEntity.properties.employee_count_range.value) : undefined;
  const hcSrc = hcEntity ? propSource(hcEntity, "employee_count_range") : undefined;
  const founded = first("founding_date");

  const facts: CalaFacts = {
    calaIds: all.map((e) => e.id),
    name: primary.name,
    founders,
    investors,
    rounds: sorted,
  };
  const website = first("website");
  if (website) facts.website = website;
  const hq = first("headquarters_address");
  if (hq) facts.hq = hq;
  const year = yearOf(founded);
  if (year) facts.founded = year;
  const description = all.map((e) => e.description).find(Boolean);
  if (description) facts.description = description;
  const stage = first("funding_stage");
  if (stage) facts.fundingStage = stage;
  if (hc) facts.headcount = { value: hc, ...(hcSrc ? { source: hcSrc } : {}) };
  const src = firstSrc("website") ?? firstSrc("description") ?? firstSrc("name");
  if (src) facts.source = src;
  return facts;
}

// ---------- fetchers ----------

async function soft<T>(p: Promise<T>): Promise<T | undefined> {
  try {
    return await p;
  } catch (e) {
    if (!(e instanceof CalaBudgetError)) console.warn("context cala:", e instanceof Error ? e.message : e);
    return undefined;
  }
}

export async function resolveCompany(
  cala: CalaClient,
  input: { name: string; website?: string; hq?: string },
): Promise<ResolveResult> {
  let mentions: CalaEntityMention[];
  try {
    mentions = (await cala.searchEntities(input.name, ["Company"])).entities ?? [];
  } catch (e) {
    if (e instanceof CalaBudgetError) return { candidates: [], budgetExhausted: true };
    throw e;
  }
  const ranked = rankMentions(input.name, mentions);
  const top = ranked.slice(0, MAX_RESOLVE_RETRIEVALS);
  const entities = await Promise.all(top.map((m) => soft(cala.retrieve(m.id, PROFILE_PROJECTION))));
  const cands = groupSiblings(top.map((m, i) => candidateFromEntity(input, entities[i], m))).sort((a, b) => b.score - a.score);
  const autoPick = pickCandidate(cands);
  return { candidates: cands, ...(autoPick ? { autoPick } : {}) };
}

export async function fetchCalaFacts(cala: CalaClient, calaId: string): Promise<CalaFacts> {
  const primary = await cala.retrieve(calaId, PROFILE_PROJECTION);
  const siblings: CalaEntity[] = [];
  const site = domainOf(prop(primary, "website"));
  // A brand and its legal entity can be separate Company entities, with the rounds on only one.
  if (issuerRoundIds(primary).length === 0) {
    const found = await soft(cala.searchEntities(primary.name, ["Company"]));
    const others = rankMentions(primary.name, found?.entities ?? [])
      .filter((m) => m.id !== primary.id)
      .slice(0, MAX_SIBLING_RETRIEVALS);
    for (const m of others) {
      const e = await soft(cala.retrieve(m.id, PROFILE_PROJECTION));
      if (!e) continue;
      const d = domainOf(prop(e, "website"));
      const same = site && d ? site === d : companyKey(e.name) === companyKey(primary.name);
      if (same) siblings.push(e);
    }
  }
  const ids = [...new Set([primary, ...siblings].flatMap(issuerRoundIds))].slice(0, MAX_ROUNDS);
  const roundEntities = await Promise.all(ids.map((id) => soft(cala.retrieve(id, ROUND_PROJECTION))));
  let rounds = roundEntities.filter((r): r is CalaEntity => !!r).map(roundFromEntity);
  if (rounds.length === 0) {
    const q = await soft(
      cala.query(`funding_rounds.company=${primary.name}.return(round_type, date, amount, valuation, lead_investors, investors)`),
    );
    rounds = roundsFromQuery(q?.results ?? []);
  }
  return assembleCalaFacts(primary, siblings, rounds);
}
