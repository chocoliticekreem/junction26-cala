// Simulated futures for one candidate company, from its last real round before asOf.
//
// A slimmed run loop next to the founder simulator's Engine (lib/sim/simulate.ts), kept separate on
// purpose: it is conditioned on the months a candidate has already waited (smoothed survival below)
// and it tracks one investor's presence per run, neither of which the Engine does. It shares the
// Engine's rules and constants so a spotter pick and a founder-side simulation agree:
//   raise vs stall  P(raise | sector, stage), Laplace + shrink to stage (base.ts), conditioned on
//                   the months already elapsed since the last round: P' = P*S(E) / (1 - P + P*S(E)),
//                   S(E) = share of real gaps longer than E, smoothed (count + 0.5) / (n + 1) so a
//                   thin gap sample does not zero it (B uses the raw share; same hard stop at 24 mo)
//   timing          a real gap for (sector, stage), sector backing off to stage below 5 gaps
//   round size      previous size x a real step-up at that stage, else a real size at the new stage
//   next lead       P(j | cap table) = mix over members m (lead weight 1, others 0.5) of
//                   (ties[m][j] + A * Pg(j)) / (ties[m] + A),  A = 3, with
//                   Pg(j) ~ (leads at stage + 0.25 * participations at stage + 0.1) x sectorFit(j)
//   vision          unicorn-shaped = Series B+ with >= $100M raised (the simulator's proxy basis,
//                   since simulated futures carry no valuations), within HORIZON_MONTHS
// Not carried over (they need the full agent fit): per-lead raise lift and co-investor fill-up.
//
// The investor appears on a path when, in one of the next ON_PATH_ROUNDS rounds, it is the drawn
// lead, or joins as a participant with
//   P(join) = 1 - (1 - pBase) * (1 - min(0.6, coPull))
//   pBase   = its share of all rounds at that stage x sector lift (its sector share vs the cohort's,
//             capped at 4)
//   coPull  = sum over cap-table members m of w(m) * rounds(m, investor together) / rounds(m)
import type { Sector, Stage } from "@/lib/taxonomy";
import {
  MONTH_MS,
  PROXY_FUNDING_USD,
  ROUND_STAGES,
  STALL_MONTHS,
  hashSeed,
  median,
  mulberry32,
  sectorStats,
  stageIdx,
  type CompanyRow,
  type SpotterIndex,
} from "./base";

export const FUTURE_RUNS = 500;
export const HORIZON_MONTHS = 60;
export const ON_PATH_ROUNDS = 2;
export const TIE_BACKOFF_A = 3;
const MIN_SECTOR_GAPS = 5;
const DEFAULT_GAP_MONTHS = 18;
const MAX_STEPS = 6;

export type Futures = {
  runs: number;
  pUnicorn: number;
  pRaiseNext: number;
  medianMonthsToNextRound?: number;
  pOnPath: number;
  pLeadNext: number;
  transitionsBehind: number;
};

type Model = {
  idx: SpotterIndex;
  sectorShare: Map<string, Map<Sector, number>>;
  cohortSectorShare: Map<Sector, number>;
  pg: Map<string, { ids: string[]; p: Float64Array; byId: Map<string, number> }>;
};

const models = new WeakMap<SpotterIndex, Model>();

function model(idx: SpotterIndex): Model {
  const hit = models.get(idx);
  if (hit) return hit;
  const sectorShare = new Map<string, Map<Sector, number>>();
  const cohortCounts = new Map<Sector, number>();
  for (const [inv, cos] of idx.portfolios) {
    const m = new Map<Sector, number>();
    for (const cid of cos) {
      const s = idx.rows.get(cid)!.co.sector;
      m.set(s, (m.get(s) ?? 0) + 1 / cos.size);
    }
    sectorShare.set(inv, m);
  }
  for (const r of idx.rows.values()) cohortCounts.set(r.co.sector, (cohortCounts.get(r.co.sector) ?? 0) + 1 / idx.rows.size);
  const out = { idx, sectorShare, cohortSectorShare: cohortCounts, pg: new Map() };
  models.set(idx, out);
  return out;
}

function globalPrior(m: Model, stage: Stage, sector: Sector) {
  const key = `${stage}|${sector}`;
  const hit = m.pg.get(key);
  if (hit) return hit;
  const leaders = m.idx.leadersByStage[stage] ?? new Map<string, number>();
  const parts = m.idx.participationsByStage[stage] ?? new Map<string, number>();
  const ids = [...leaders.keys()].sort();
  const p = new Float64Array(ids.length);
  let tot = 0;
  ids.forEach((id, k) => {
    p[k] = ((leaders.get(id) ?? 0) + 0.25 * (parts.get(id) ?? 0) + 0.1) * (0.15 + (m.sectorShare.get(id)?.get(sector) ?? 0));
    tot += p[k];
  });
  if (tot > 0) for (let k = 0; k < p.length; k++) p[k] /= tot;
  const out = { ids, p, byId: new Map(ids.map((id, k) => [id, k])) };
  m.pg.set(key, out);
  return out;
}

type Member = { id: string; w: number };

function leadProb(m: Model, pg: ReturnType<typeof globalPrior>, members: Member[], j: string): number {
  const k = pg.byId.get(j);
  const g = k === undefined ? 0 : pg.p[k];
  let num = 0;
  let den = 0;
  for (const { id, w } of members) {
    const tot = m.idx.tieTotals.get(id);
    if (!tot) continue;
    num += w * ((m.idx.ties.get(id)?.get(j) ?? 0) + TIE_BACKOFF_A * g) / (tot + TIE_BACKOFF_A);
    den += w;
  }
  return den ? num / den : g;
}

function leadCdf(m: Model, pg: ReturnType<typeof globalPrior>, members: Member[]): { ids: string[]; cdf: Float64Array } {
  const cand = new Set(pg.ids);
  for (const { id } of members) for (const j of m.idx.ties.get(id)?.keys() ?? []) cand.add(j);
  const ids = [...cand].sort();
  const cdf = new Float64Array(ids.length);
  let acc = 0;
  ids.forEach((j, k) => {
    acc += leadProb(m, pg, members, j);
    cdf[k] = acc;
  });
  for (let k = 0; k < cdf.length; k++) cdf[k] /= acc || 1;
  return { ids, cdf };
}

function draw(c: { ids: string[]; cdf: Float64Array }, u: number): string | undefined {
  let lo = 0;
  let hi = c.cdf.length - 1;
  if (hi < 0) return undefined;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (c.cdf[mid] < u) lo = mid + 1;
    else hi = mid;
  }
  return c.ids[lo];
}

function joinProb(m: Model, investorId: string, stage: Stage, sector: Sector, members: Member[]): number {
  const rounds = m.idx.roundsByStage[stage] ?? 0;
  const part = m.idx.participationsByStage[stage]?.get(investorId) ?? 0;
  const lift = Math.min(4, ((m.sectorShare.get(investorId)?.get(sector) ?? 0) + 0.05) / ((m.cohortSectorShare.get(sector) ?? 0) + 0.05));
  const pBase = Math.min(0.9, rounds ? (part / rounds) * lift : 0);
  let coPull = 0;
  for (const { id, w } of members) {
    const n = m.idx.roundsOf.get(id);
    if (n) coPull += (w * (m.idx.co.get(id)?.get(investorId) ?? 0)) / n;
  }
  return 1 - (1 - pBase) * (1 - Math.min(0.6, coPull));
}

function gaps(idx: SpotterIndex, sector: Sector, stage: Stage): number[] {
  const ss = idx.bySectorStage.get(`${sector}|${stage}`);
  return ss && ss.gaps.length >= MIN_SECTOR_GAPS ? ss.gaps : (idx.byStage[stage]?.gaps ?? []);
}

function pRaise(idx: SpotterIndex, sector: Sector, stage: Stage, elapsed: number): number {
  let p = Math.min(0.97, Math.max(0.02, sectorStats(idx, sector, stage)?.pRaise ?? 0.5));
  if (elapsed > 0) {
    const g = gaps(idx, sector, stage);
    const count = g.filter((x) => x > elapsed).length;
    const longer = (count + 0.5) / (g.length + 1);
    p = (p * longer) / (1 - p + p * longer || 1);
    if (elapsed >= STALL_MONTHS && count === 0) p = 0;
  }
  return p;
}

const pick = (xs: number[], rnd: () => number) => xs[Math.floor(rnd() * xs.length)];

export function simulateFutures(idx: SpotterIndex, row: CompanyRow, investorId: string, opts: { runs?: number; seed?: number } = {}): Futures {
  const runs = opts.runs ?? FUTURE_RUNS;
  const m = model(idx);
  const rnd = mulberry32(opts.seed ?? hashSeed(`${row.co.id}|${investorId}|${idx.asOf}`));
  const sector = row.co.sector;
  const last = row.eps[row.eps.length - 1];
  const elapsed0 = Math.max(0, (idx.asOfMs - last.lastDateMs) / MONTH_MS);
  const members0: Member[] = last.memberIds.map((id) => ({ id, w: id === last.leadId ? 1 : 0.5 }));
  const firstNext = ROUND_STAGES[Math.min(ROUND_STAGES.length - 1, stageIdx(last.stage) + 1)];
  const cdf0 = leadCdf(m, globalPrior(m, firstNext, sector), members0);

  let unicorn = 0;
  let raisedNext = 0;
  let onPath = 0;
  let leadNext = 0;
  const firstGaps: number[] = [];
  for (let r = 0; r < runs; r++) {
    let stage = last.stage;
    let members = members0;
    let amount = last.amountUsd;
    let raised = row.raisedUsd;
    let months = 0;
    let elapsed = elapsed0;
    let seen = false;
    for (let step = 1; step <= MAX_STEPS; step++) {
      if (rnd() >= pRaise(idx, sector, stage, elapsed)) break;
      const g = gaps(idx, sector, stage);
      const pool = elapsed > 0 ? g.filter((x) => x > elapsed) : g;
      const gap = pool.length ? Math.max(1, pick(pool, rnd) - elapsed) : DEFAULT_GAP_MONTHS;
      elapsed = 0;
      months += gap;
      if (months > HORIZON_MONTHS) break;
      const next = ROUND_STAGES[Math.min(ROUND_STAGES.length - 1, stageIdx(stage) + 1)];
      const steps = idx.byStage[stage]?.stepUps ?? [];
      const sizes = idx.byStage[next]?.amounts ?? [];
      amount = amount && steps.length ? amount * pick(steps, rnd) : sizes.length ? pick(sizes, rnd) : amount;
      raised += amount ?? 0;
      if (step === 1) {
        raisedNext++;
        firstGaps.push(gap);
      }
      if (step <= ON_PATH_ROUNDS) {
        const lead = step === 1 ? draw(cdf0, rnd()) : rnd() < leadProb(m, globalPrior(m, next, sector), members, investorId) ? investorId : undefined;
        const isLead = lead === investorId;
        if (isLead && step === 1) leadNext++;
        const joined = isLead || rnd() < joinProb(m, investorId, next, sector, members);
        if (joined) seen = true;
        const nextMembers: Member[] = [];
        if (lead) nextMembers.push({ id: lead, w: 1 });
        for (const mm of members) {
          if (mm.id === lead) continue;
          const ru = idx.reUp.get(mm.id);
          if (ru && ru.raised && rnd() < ru.reUp / ru.raised) nextMembers.push({ id: mm.id, w: 0.5 });
        }
        if (joined && !isLead) nextMembers.push({ id: investorId, w: 0.5 });
        members = nextMembers;
      }
      stage = next;
      if (stage === "series-b-plus" && raised >= PROXY_FUNDING_USD) {
        unicorn++;
        break;
      }
    }
    if (seen) onPath++;
  }
  return {
    runs,
    pUnicorn: unicorn / runs,
    pRaiseNext: raisedNext / runs,
    medianMonthsToNextRound: median(firstGaps),
    pOnPath: onPath / runs,
    pLeadNext: leadNext / runs,
    transitionsBehind: sectorStats(idx, sector, last.stage)?.n ?? 0,
  };
}
