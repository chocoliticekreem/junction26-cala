// Action layer: for each chosen investor, the evidence (precedent, partner, events) and a warm path:
// founders the investor already backed, to ask about the investor and for the intro.
import {
  CALA_CACHE_DIR,
  MemoryLRU,
  createCalaClient,
  diskCache,
  sessionBudget,
  tieredCache,
  valkeyCache,
  UUID_RE,
  type CalaClient,
  type CalaProjection,
} from "@/lib/cala";
import { eventFor, type EventTag } from "@/lib/events";
import { STAGE_LABELS, stageIndex, type Stage } from "@/lib/taxonomy";
import type { Investor, Sector, Source } from "@/lib/types";
import type { CohortLite } from "./cohortRead";
import type { ContextDoc, EventRef, InvestorAction, Precedent, WarmFounder } from "./types";

export function findInvestor(investors: Investor[], id: string): Investor | undefined {
  return investors.find((i) => i.id === id || i.calaId === id);
}

// ---------- precedent ----------

type Candidate = Precedent & { sector?: Sector; stage?: Stage | "unknown" };

function relevance(c: Candidate, sector: Sector | undefined, stage: Stage | undefined): number {
  let s = c.led ? 4 : 0;
  if (sector && c.sector === sector) s += 2;
  if (stage && c.stage && c.stage !== "unknown") {
    const want = stageIndex(stage);
    const got = stageIndex(c.stage);
    if (got === want || got === want + 1) s += 1;
  }
  return s;
}

// The most relevant round this investor led (cohort lead flags), else one it backed (investors.json
// deals carry no lead flag, so those are marked led: false).
export function choosePrecedent(
  inv: Investor,
  cohort: CohortLite | null,
  sector: Sector | undefined,
  stage: Stage | undefined,
  excludeCompanyIds: string[] = [],
): Precedent | undefined {
  const cands: Candidate[] = [];
  const exclude = new Set(excludeCompanyIds);
  if (cohort) {
    for (const r of Object.values(cohort.rounds)) {
      // The founder's own company is never a precedent for pitching to its own investors.
      if (exclude.has(r.companyId)) continue;
      const p = r.participants.find(
        (x) => x.investorId === inv.calaId || cohort.investors[x.investorId]?.investorsJsonId === inv.id,
      );
      if (!p) continue;
      const company = cohort.companies[r.companyId];
      if (!company) continue;
      cands.push({
        company: company.name,
        companyCalaId: company.id,
        round: r.label,
        ...(r.date ? { date: r.date } : {}),
        led: p.isLead === true,
        ...(r.sources[0] ? { source: r.sources[0] } : {}),
        sector: company.sector,
        stage: r.stage,
      });
    }
  }
  for (const d of inv.deals) {
    if (cands.some((c) => c.company.toLowerCase() === d.company.toLowerCase() && c.date === d.date)) continue;
    cands.push({
      company: d.company,
      ...(d.companyCalaId ? { companyCalaId: d.companyCalaId } : {}),
      round: d.round === "unknown" ? "Funding round" : STAGE_LABELS[d.round],
      ...(d.date ? { date: d.date } : {}),
      led: false,
      ...(d.sources[0] ? { source: d.sources[0] } : {}),
      sector: d.sector,
      stage: d.round,
    });
  }
  if (!cands.length) return undefined;
  cands.sort((a, b) => relevance(b, sector, stage) - relevance(a, sector, stage) || (b.date ?? "").localeCompare(a.date ?? ""));
  const best = { ...cands[0] };
  delete best.sector;
  delete best.stage;
  return best;
}

// ---------- warm path ----------

export const MAX_WARM_FOUNDERS = 3;

type WarmCandidate = WarmFounder & { sectorMatch: boolean; stageGap: number; date: string };

const byWarmth = (a: WarmCandidate, b: WarmCandidate) =>
  Number(b.sectorMatch) - Number(a.sectorMatch) ||
  Number(b.led) - Number(a.led) ||
  a.stageGap - b.stageGap ||
  Number(!!b.event) - Number(!!a.event) ||
  b.date.localeCompare(a.date);

// Founders this investor already backed, closest to the founder first: same sector, then rounds it
// led, then nearest stage; Slush attendees break ties so they can be met in person; then recency.
// One entry per company, its warmest round.
export function warmPath(
  inv: Investor,
  cohort: CohortLite | null,
  founder: { sector?: Sector; stage?: Stage; excludeCompanyIds?: string[] },
  eventOf: (company: { id: string; name: string }) => EventTag | undefined = eventFor,
): WarmFounder[] {
  if (!cohort) return [];
  const exclude = new Set(founder.excludeCompanyIds ?? []);
  const best = new Map<string, WarmCandidate>();
  for (const r of Object.values(cohort.rounds)) {
    if (exclude.has(r.companyId)) continue;
    const p = r.participants.find(
      (x) => x.investorId === inv.calaId || cohort.investors[x.investorId]?.investorsJsonId === inv.id,
    );
    if (!p) continue;
    const company = cohort.companies[r.companyId];
    if (!company) continue;
    const event = eventOf({ id: company.id, name: company.name });
    const known = r.stage !== "unknown";
    const c: WarmCandidate = {
      company: company.name,
      ...(UUID_RE.test(company.id) ? { companyCalaId: company.id } : {}),
      round: known ? STAGE_LABELS[r.stage as Stage] : r.label,
      ...(r.date ? { year: r.date.slice(0, 4) } : {}),
      led: p.isLead === true,
      ...(event ? { event } : {}),
      sectorMatch: !!founder.sector && company.sector === founder.sector,
      stageGap: founder.stage && known ? Math.abs(stageIndex(r.stage as Stage) - stageIndex(founder.stage)) : 9,
      date: r.date ?? "",
    };
    const prev = best.get(company.id);
    if (!prev || byWarmth(c, prev) < 0) best.set(company.id, c);
  }
  return [...best.values()]
    .sort(byWarmth)
    .slice(0, MAX_WARM_FOUNDERS)
    .map(({ company, companyCalaId, round, year, led, event }) => ({
      company,
      ...(companyCalaId ? { companyCalaId } : {}),
      round,
      ...(year ? { year } : {}),
      led,
      ...(event ? { event } : {}),
    }));
}

// ---------- events (cache only) ----------

// Byte-identical to the ingest's investor projection, so these are cache reads.
export const EVENTS_PROJECTION: CalaProjection = {
  properties: ["name"],
  relationships: {
    outgoing: {
      PARTICIPATES_IN_FUNDING_ROUND: { limit: 100 },
      PARTICIPATES_IN_CORPORATE_EVENT: { limit: 50 },
      PARTICIPATES_IN_EVENT: { limit: 20 },
    },
  },
};

let cacheOnly: CalaClient | undefined;

// Never sends a request: a zero budget turns every cache miss into a refused call.
export function cacheOnlyCala(): CalaClient {
  cacheOnly ??= createCalaClient({
    apiKey: process.env.CALA_API_KEY || "cache-only",
    cache: tieredCache(new MemoryLRU(200), valkeyCache(), diskCache(CALA_CACHE_DIR)),
    budget: sessionBudget(0),
    maxRetries: 0,
  });
  return cacheOnly;
}

export async function investorEvents(cala: CalaClient, calaId: string): Promise<EventRef[] | undefined> {
  try {
    const e = await cala.retrieve(calaId, EVENTS_PROJECTION);
    const evs = e.relationships?.outgoing?.PARTICIPATES_IN_EVENT ?? [];
    return evs.map((ev) => {
      const p = ev.properties as Record<string, unknown> | undefined;
      const date = [p?.event_date, p?.valid_since].find((d): d is string => typeof d === "string" && !!d);
      return { id: ev.id, name: ev.name, ...(date ? { date } : {}) };
    });
  } catch {
    return undefined;
  }
}

export function investorSources(inv: Investor, precedent: Precedent | undefined): Source[] {
  const all = [...(precedent?.source ? [precedent.source] : []), ...inv.statedThesis.sources, ...inv.deals.flatMap((d) => d.sources)];
  const seen = new Set<string>();
  return all.filter((s) => {
    const k = s.url ?? s.name;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 5);
}

export async function buildAction(
  doc: ContextDoc,
  inv: Investor,
  deps: { cohort: CohortLite | null; cala: CalaClient | null },
): Promise<InvestorAction> {
  const own = [doc.id, ...(doc.calaIds ?? [])];
  const precedent = choosePrecedent(inv, deps.cohort, doc.company.sector, doc.company.stage, own);
  const events = deps.cala ? await investorEvents(deps.cala, inv.calaId) : undefined;
  const p = inv.partners[0];
  const action: InvestorAction = {
    investorId: inv.id,
    name: inv.name,
    calaSources: investorSources(inv, precedent),
    warmPath: warmPath(inv, deps.cohort, { sector: doc.company.sector, stage: doc.company.stage, excludeCompanyIds: own }),
  };
  if (inv.website) action.website = inv.website;
  if (p) action.leadPartner = { name: p.name, ...(p.role ? { role: p.role } : {}), calaId: p.calaId };
  if (events?.length) action.events = events;
  if (precedent) action.precedent = precedent;
  return action;
}
