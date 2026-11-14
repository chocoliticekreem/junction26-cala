// Shared primitives for the spotter, built once per (cohort, asOf) and memoised.
// reconcile: toMs, mulberry32, leadOf, stageFromLabel and the episode builder are local copies of
// Track B's lib/sim/util.ts and lib/sim/fit.ts (buildEpisodes), kept behaviour-identical so the
// spotter and the founder simulator read the same rounds the same way. Swap for imports on merge.
import { isStage, type Sector, type Stage } from "@/lib/taxonomy";
import type { Cohort, CohortCompany, CohortParticipant, CohortRound, InvestorKind } from "./cohort";

export const ROUND_STAGES: Stage[] = ["pre-seed", "seed", "series-a", "series-b-plus"];
export const MONTH_MS = 30.44 * 86400000;
// Same thresholds as the founder simulator (Track B util.ts).
export const STALL_MONTHS = 24;
export const LOW_CONFIDENCE_N = 20;
export const UNICORN_USD = 1_000_000_000;
// Simulated futures have no valuations, so "unicorn-shaped" = Series B+ with this much raised.
export const PROXY_FUNDING_USD = 100_000_000;

export const stageIdx = (s: Stage) => ROUND_STAGES.indexOf(s);

export function toMs(date: string | undefined): number | undefined {
  if (!date) return undefined;
  const ms = Date.parse(date.length === 4 ? `${date}-07-01` : date.length === 7 ? `${date}-15` : date);
  return Number.isFinite(ms) ? ms : undefined;
}

export const monthsBetween = (a: number, b: number) => (b - a) / MONTH_MS;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function median(xs: number[]): number | undefined {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const m = (s.length - 1) / 2;
  return (s[Math.floor(m)] + s[Math.ceil(m)]) / 2;
}

const KIND_RANK: Record<InvestorKind, number> = { fund: 0, cvc: 1, accelerator: 2, angel: 3, unknown: 4 };

export function leadOf(round: CohortRound): CohortParticipant | undefined {
  const ps = round.participants;
  if (!ps.length) return undefined;
  const flagged = ps.find((p) => p.isLead);
  if (flagged) return flagged;
  if (ps.length === 1) return ps[0];
  return [...ps].sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind])[0];
}

const LABEL_STAGE: [RegExp, Stage][] = [
  [/pre[- ]?seed|angel|accelerator|incubator|friends/i, "pre-seed"],
  [/seed/i, "seed"],
  [/series[- ]?a\b/i, "series-a"],
  [/series[- ]?[b-k]\b|growth|late|ipo|pre[- ]?ipo/i, "series-b-plus"],
];

export function stageFromLabel(label: string | undefined): Stage | undefined {
  if (!label) return undefined;
  if (isStage(label)) return label;
  for (const [re, s] of LABEL_STAGE) if (re.test(label)) return s;
  return undefined;
}

export type Episode = {
  stage: Stage;
  roundIds: string[];
  dateMs: number;
  lastDateMs: number;
  leadId?: string;
  leadKind: InvestorKind;
  memberIds: string[];
  amountUsd?: number;
  valuationUsd?: number;
};

// A company's stay at one stage: a round at a higher stage opens an episode, later rounds at the
// same stage join it; every Series B+ round opens its own. Only dated rounds before asOf count.
export function buildEpisodes(cohort: Cohort, co: CohortCompany, asOfMs: number): Episode[] {
  const rs = co.roundIds
    .map((id) => cohort.rounds[id])
    .filter((r): r is CohortRound => Boolean(r))
    .map((r) => ({ r, ms: toMs(r.date), stage: r.stage !== "unknown" ? r.stage : stageFromLabel(r.label) }))
    .filter(
      (x): x is { r: CohortRound; ms: number; stage: Stage } =>
        x.ms !== undefined && x.ms < asOfMs && !!x.stage && x.stage !== "pre-idea",
    )
    .sort((a, b) => a.ms - b.ms);
  const eps: Episode[] = [];
  for (const { r, ms, stage } of rs) {
    const cur = eps[eps.length - 1];
    const idx = stageIdx(stage);
    const members = r.participants.map((p) => p.investorId);
    if (cur && (idx < stageIdx(cur.stage) || (idx === stageIdx(cur.stage) && stage !== "series-b-plus"))) {
      cur.roundIds.push(r.id);
      cur.lastDateMs = ms;
      for (const m of members) if (!cur.memberIds.includes(m)) cur.memberIds.push(m);
      if (r.amountUsd) cur.amountUsd = (cur.amountUsd ?? 0) + r.amountUsd;
      if (r.valuationUsd) cur.valuationUsd = Math.max(cur.valuationUsd ?? 0, r.valuationUsd);
      continue;
    }
    const lead = leadOf(r);
    eps.push({
      stage,
      roundIds: [r.id],
      dateMs: ms,
      lastDateMs: ms,
      leadId: lead?.investorId,
      leadKind: lead?.kind ?? "unknown",
      memberIds: [...new Set(members)],
      amountUsd: r.amountUsd,
      valuationUsd: r.valuationUsd,
    });
  }
  return eps;
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

  for (const c of Object.values(cohort.companies)) {
    const eps = buildEpisodes(cohort, c, asOfMs);
    if (!eps.length) continue;
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
