// Shared primitives for the spotter, built once per (cohort, asOf) and memoised.
// Round reading (dates, stages, leads, episodes) and the shared thresholds come from the founder
// simulator (lib/sim/util.ts, lib/sim/fit.ts) so both read the same rounds the same way. Only the
// lead's investor kind is added per episode (the shape score reads it).
import type { Sector, Stage } from "@/lib/taxonomy";
import { buildEpisodes as buildSimEpisodes } from "../fit";
import type { Cohort, CohortCompany, Episode as SimEpisode, InvestorKind } from "../types";
import { LOW_CONFIDENCE_N, MONTH_MS, PROXY_FUNDING_USD, ROUND_STAGES, STALL_MONTHS, leadOf, median, monthsBetween, mulberry32, roundStageIndex, toMs } from "../util";
import { UNICORN_USD } from "../vision";

export { LOW_CONFIDENCE_N, MONTH_MS, PROXY_FUNDING_USD, ROUND_STAGES, STALL_MONTHS, UNICORN_USD, median, monthsBetween, mulberry32, toMs };

export const stageIdx = roundStageIndex;

export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export type Episode = SimEpisode & { leadKind: InvestorKind };

// Episodes for every company with a dated round before asOf (lib/sim/fit.ts buildEpisodes), plus
// the kind of each episode's lead.
export function buildEpisodes(cohort: Cohort, asOfMs: number): Record<string, Episode[]> {
  const sim = buildSimEpisodes(cohort, asOfMs);
  return Object.fromEntries(
    Object.entries(sim).map(([id, eps]) => [
      id,
      eps.map((e) => ({ ...e, leadKind: leadOf(cohort.rounds[e.roundIds[0]])?.kind ?? "unknown" })),
    ]),
  );
}

// Outcome as it could be known at asOf (leakage guard for backtests):
//   unicorn  - a dated round before asOf valued >= $1B; or, when asOf is at/after the cohort's own
//              asOf, Cala's present-day isUnicorn / maxValuationUsd; or, in a backtest, a known
//              unicorn (present-day flag) that had already raised >= $100M at Series B+ by asOf.
//   stalled  - not a unicorn, and no round for STALL_MONTHS before asOf (or closed, when trusted).
//   open     - anything else (too recent to tell); kept out of the precedent reference set.
export type Outcome = "unicorn" | "stalled" | "open";

export type CompanyRow = {
  co: CohortCompany;
  eps: Episode[];
  firstMs: number;
  lastMs: number;
  raisedUsd: number;
  outcome: Outcome;
  investorIds: Set<string>;
};

export type StageStats = { n: number; raised: number; pRaise: number; gaps: number[]; stepUps: number[]; amounts: number[] };

export type SpotterIndex = {
  cohort: Cohort;
  asOf: string;
  asOfMs: number;
  trustPresent: boolean;
  rows: Map<string, CompanyRow>;
  byStage: Partial<Record<Stage, StageStats>>;
  bySectorStage: Map<string, StageStats>;
  investorNames: Map<string, { name: string; kind: InvestorKind }>;
  portfolios: Map<string, Set<string>>;
  // ties[m][j]: times a company with m on a round had j lead its next round (lead weight 1, member 0.5).
  ties: Map<string, Map<string, number>>;
  tieTotals: Map<string, number>;
  leadersByStage: Partial<Record<Stage, Map<string, number>>>;
  participationsByStage: Partial<Record<Stage, Map<string, number>>>;
  roundsByStage: Partial<Record<Stage, number>>;
  // co[m][j]: rounds m and j shared.
  co: Map<string, Map<string, number>>;
  roundsOf: Map<string, number>;
  reUp: Map<string, { raised: number; reUp: number }>;
};

const SECTOR_SHRINK_K = 5;

function emptyStats(): StageStats {
  return { n: 0, raised: 0, pRaise: 0, gaps: [], stepUps: [], amounts: [] };
}

function isUnicornAsOf(row: Omit<CompanyRow, "outcome">, asOfMs: number, trustPresent: boolean): boolean {
  const { co, eps } = row;
  if (eps.some((e) => (e.valuationUsd ?? 0) >= UNICORN_USD)) return true;
  const presentFlag = Boolean(co.isUnicorn?.value) || (co.maxValuationUsd ?? 0) >= UNICORN_USD;
  if (trustPresent) return presentFlag;
  const last = eps[eps.length - 1];
  return presentFlag && !!last && last.stage === "series-b-plus" && last.dateMs < asOfMs && row.raisedUsd >= PROXY_FUNDING_USD;
}

const inc = <K>(m: Map<K, number>, k: K, w = 1) => m.set(k, (m.get(k) ?? 0) + w);

function nested(m: Map<string, Map<string, number>>, a: string): Map<string, number> {
  let x = m.get(a);
  if (!x) m.set(a, (x = new Map()));
  return x;
}

const cache = new WeakMap<Cohort, Map<string, SpotterIndex>>();

export function spotterIndex(cohort: Cohort, asOf?: string): SpotterIndex {
  const asOfStr = asOf ?? cohort.asOf;
  let perCohort = cache.get(cohort);
  if (!perCohort) cache.set(cohort, (perCohort = new Map()));
  const hit = perCohort.get(asOfStr);
  if (hit) return hit;
  const idx = buildIndex(cohort, asOfStr);
  perCohort.set(asOfStr, idx);
  return idx;
}

function buildIndex(cohort: Cohort, asOf: string): SpotterIndex {
  const asOfMs = toMs(asOf) ?? Date.now();
  const trustPresent = asOfMs >= (toMs(cohort.asOf) ?? 0);
  const rows = new Map<string, CompanyRow>();
  const investorNames = new Map<string, { name: string; kind: InvestorKind }>();
  for (const inv of Object.values(cohort.investors)) investorNames.set(inv.id, { name: inv.name, kind: inv.kind });
  const portfolios = new Map<string, Set<string>>();
  const byStage: Partial<Record<Stage, StageStats>> = {};
  const bySectorStage = new Map<string, StageStats>();
  const ties = new Map<string, Map<string, number>>();
  const tieTotals = new Map<string, number>();
  const leadersByStage: Partial<Record<Stage, Map<string, number>>> = {};
  const participationsByStage: Partial<Record<Stage, Map<string, number>>> = {};
  const roundsByStage: Partial<Record<Stage, number>> = {};
  const co = new Map<string, Map<string, number>>();
  const roundsOf = new Map<string, number>();
  const reUp = new Map<string, { raised: number; reUp: number }>();

  const allEps = buildEpisodes(cohort, asOfMs);
  for (const c of Object.values(cohort.companies)) {
    const eps = allEps[c.id];
    if (!eps?.length) continue;
    const investorIds = new Set<string>();
    for (const e of eps) {
      for (const rid of e.roundIds) {
        const r = cohort.rounds[rid];
        const ids = [...new Set(r.participants.map((p) => p.investorId))];
        for (const p of r.participants) if (!investorNames.has(p.investorId)) investorNames.set(p.investorId, { name: p.name, kind: p.kind });
        for (const id of ids) {
          investorIds.add(id);
          inc(roundsOf, id);
          const cm = nested(co, id);
          for (const o of ids) if (o !== id) inc(cm, o);
          inc((participationsByStage[e.stage] ??= new Map()), id);
        }
        roundsByStage[e.stage] = (roundsByStage[e.stage] ?? 0) + 1;
        if (r.amountUsd) (byStage[e.stage] ??= emptyStats()).amounts.push(r.amountUsd);
      }
      if (e.leadId) inc((leadersByStage[e.stage] ??= new Map()), e.leadId);
    }
    for (const id of investorIds) {
      let s = portfolios.get(id);
      if (!s) portfolios.set(id, (s = new Set()));
      s.add(c.id);
    }
    const raisedUsd = eps.reduce((a, e) => a + (e.amountUsd ?? 0), 0);
    const base = { co: c, eps, firstMs: eps[0].dateMs, lastMs: eps[eps.length - 1].lastDateMs, raisedUsd, investorIds };
    const unicorn = isUnicornAsOf(base, asOfMs, trustPresent);
    const stalled = !unicorn && ((trustPresent && c.status === "closed") || monthsBetween(base.lastMs, asOfMs) >= STALL_MONTHS);
    rows.set(c.id, { ...base, outcome: unicorn ? "unicorn" : stalled ? "stalled" : "open" });

    // Stage transitions (same survivorship rule as the founder simulator: censored ones excluded).
    eps.forEach((e, k) => {
      const next = eps[k + 1];
      const acquired = trustPresent && c.status === "acquired";
      const censored = !next && (acquired || (!stalled && monthsBetween(base.lastMs, asOfMs) < STALL_MONTHS));
      if (censored || (!next && unicorn)) return;
      const st = (byStage[e.stage] ??= emptyStats());
      const ss = bySectorStage.get(`${c.sector}|${e.stage}`) ?? emptyStats();
      bySectorStage.set(`${c.sector}|${e.stage}`, ss);
      for (const s of [st, ss]) {
        s.n++;
        if (next) {
          s.raised++;
          s.gaps.push(monthsBetween(e.dateMs, next.dateMs));
          if (e.amountUsd && next.amountUsd) s.stepUps.push(next.amountUsd / e.amountUsd);
        }
      }
      if (!next) return;
      for (const m of e.memberIds) {
        const ru = reUp.get(m) ?? { raised: 0, reUp: 0 };
        ru.raised++;
        if (next.memberIds.includes(m)) ru.reUp++;
        reUp.set(m, ru);
        if (next.leadId) {
          const w = m === e.leadId ? 1 : 0.5;
          inc(nested(ties, m), next.leadId, w);
          inc(tieTotals, m, w);
        }
      }
    });
  }

  for (const s of Object.values(byStage)) {
    s.pRaise = (s.raised + 1) / (s.n + 2);
    s.gaps.sort((a, b) => a - b);
    s.amounts.sort((a, b) => a - b);
  }
  for (const [key, s] of bySectorStage) {
    const prior = byStage[key.split("|")[1] as Stage]?.pRaise ?? 0.5;
    s.pRaise = (s.raised + SECTOR_SHRINK_K * prior) / (s.n + SECTOR_SHRINK_K);
    s.gaps.sort((a, b) => a - b);
  }

  return {
    cohort,
    asOf,
    asOfMs,
    trustPresent,
    rows,
    byStage,
    bySectorStage,
    investorNames,
    portfolios,
    ties,
    tieTotals,
    leadersByStage,
    participationsByStage,
    roundsByStage,
    co,
    roundsOf,
    reUp,
  };
}

export function sectorStats(idx: SpotterIndex, sector: Sector, stage: Stage): StageStats | undefined {
  return idx.bySectorStage.get(`${sector}|${stage}`) ?? idx.byStage[stage];
}

const normName = (s: string) =>
  s
    .toLowerCase()
    .replace(/\b(?:ltd|limited|llp|inc|plc|gmbh|lp)\b\.?/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Exact id, else exact normalised name (most rounds wins), else a unique prefix match.
export function resolveInvestor(idx: SpotterIndex, q: { investorId?: string; investorName?: string }): string | undefined {
  if (q.investorId && (idx.investorNames.has(q.investorId) || idx.cohort.investors[q.investorId])) return q.investorId;
  const name = normName(q.investorName ?? q.investorId ?? "");
  if (!name) return undefined;
  const all = [...idx.investorNames.entries()];
  const byRounds = (a: [string, unknown], b: [string, unknown]) => (idx.roundsOf.get(b[0]) ?? 0) - (idx.roundsOf.get(a[0]) ?? 0);
  const exact = all.filter(([, v]) => normName(v.name) === name).sort(byRounds);
  if (exact.length) return exact[0][0];
  const prefix = all.filter(([, v]) => normName(v.name).startsWith(`${name} `)).sort(byRounds);
  return prefix.length ? prefix[0][0] : undefined;
}
