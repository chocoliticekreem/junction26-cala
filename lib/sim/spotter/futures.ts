// Simulated futures for one candidate company: the founder simulator's own Monte Carlo
// (lib/sim/simulate.ts simulateRuns), so a spotter pick and /api/simulate for the same company
// read off one calibrated engine (seed-sample base rates, effective stages, size terciles, lead
// lifts, geography). Started from the company's real state as of asOf (its last effective-stage
// round, its cap table, its hq) with the unicorn vision: a $1B valuation within 5 years, judged on
// simulated paths as Series B+ with the funding real companies had raised when first valued at
// $1B (vision.ts). Runs use simulate()'s default seed, so results are deterministic.
//
// One difference from the founder page: the founder tree forces each of the top four likely next
// leads on a quarter of the runs (a decision tree). Here every run draws its next lead from the
// engine (naturalLead), which is what P(this investor leads) needs. The reach share moves by about
// two points at most between the two (measured on the real cohort).
//
//   pUnicorn    share of runs that reach the vision (= the founder tree's reachVisionShare)
//   pOnPath     P(the investor leads or participates in one of the next ON_PATH_ROUNDS rounds),
//               averaged over runs. Per simulated round at stage s:
//                 P(in round) = 1                    when the engine drew it as lead or co-investor
//                             = PARTICIPATION_SCALE x participation(s)   otherwise
//               The engine's co-investor model only draws re-ups by current members and the lead's
//               own co-investors, capped at 3, so an investor with no tie to the lead never appears
//               there. participation(s) (stageParticipation below) is the investor's own empirical
//               rate of joining a stage-s round as a non-lead, read off the cohort before asOf. Per
//               run, P(on path) = 1 - prod over its next rounds of (1 - P(in round)). The combined
//               rate is validated against a date holdout in tests/unit/spotterBacktest.test.ts.
//   pLeadNext   share of runs where the investor leads the next round
//   pRaiseNext  share of runs that close a next round within the horizon
import type { Stage } from "@/lib/taxonomy";
import { fitModel } from "../fit";
import { simulateRuns } from "../simulate";
import type { Cohort, SimModel, Vision } from "../types";
import { UNICORN_USD, median, type CompanyRow, type SpotterIndex } from "./base";

export const FUTURE_RUNS = 800;
export const HORIZON_YEARS = 5;
export const ON_PATH_ROUNDS = 2;
// The raw stage participation rate overlaps the engine's tie-driven co-investor draws (an investor's
// past new-money entries were partly via its ties to the lead), so used at face value the combined
// prediction runs ~2x the real number of new participants. Scale fitted on two date holdouts
// (tests/unit/spotterBacktest.test.ts): 0.08 on 2022-11..2024-11 (13 joins, engine alone 11.5),
// 0.32 on 2024-11 onwards (51 joins, engine alone 32), 0.26 pooled.
export const PARTICIPATION_SCALE = 0.25;

export const UNICORN_VISION: Vision = {
  text: "becomes a unicorn",
  targetStage: "series-b-plus",
  targetValuationUsd: UNICORN_USD,
  horizonYears: HORIZON_YEARS,
};

export type Futures = {
  runs: number;
  pUnicorn: number;
  pRaiseNext: number;
  medianMonthsToNextRound?: number;
  pOnPath: number;
  pLeadNext: number;
  // Distinct companies with a knowable outcome at the start stage (the founder tree's sampleSize).
  transitionsBehind: number;
  // Already at Series B+ with the unicorn funding bar raised: past the point the spotter is for.
  alreadyThere: boolean;
  effectiveStage?: Stage;
};

const models = new WeakMap<Cohort, Map<string, SimModel>>();
const participation = new WeakMap<SpotterIndex, Map<string, Partial<Record<Stage, number>>>>();

// Share of the cohort's stage-s follow-on episodes (a company's 2nd episode onwards, before asOf)
// in which the investor came in as new non-lead money: not the lead, not on any earlier round of
// that company. New money only, because a spotter candidate is never already in the investor's
// portfolio (re-ups of current members are the engine's job). Episodes, not rounds, because one
// simulated step is one episode.
export function stageParticipation(idx: SpotterIndex, investorId: string): Partial<Record<Stage, number>> {
  let m = participation.get(idx);
  if (!m) {
    const episodes: Partial<Record<Stage, number>> = {};
    const joined = new Map<string, Partial<Record<Stage, number>>>();
    for (const row of idx.rows.values()) {
      const seen = new Set<string>();
      row.eps.forEach((e, k) => {
        const before = new Set(seen);
        for (const id of e.memberIds) seen.add(id);
        if (k === 0) return;
        episodes[e.stage] = (episodes[e.stage] ?? 0) + 1;
        for (const id of new Set(e.memberIds)) {
          if (id === e.leadId || before.has(id)) continue;
          let j = joined.get(id);
          if (!j) joined.set(id, (j = {}));
          j[e.stage] = (j[e.stage] ?? 0) + 1;
        }
      });
    }
    m = new Map();
    for (const [id, j] of joined) {
      m.set(id, Object.fromEntries(Object.entries(j).map(([s, n]) => [s, (n ?? 0) / (episodes[s as Stage] ?? 1)])) as Partial<Record<Stage, number>>);
    }
    participation.set(idx, m);
  }
  return m.get(investorId) ?? {};
}

// P(investor in a simulated round): 1 when the engine drew it, its stage participation otherwise.
export function pInRound(step: { stage: Stage; leadId?: string; coInvestorIds: string[] }, investorId: string, part: Partial<Record<Stage, number>>): number {
  if (step.leadId === investorId || step.coInvestorIds.includes(investorId)) return 1;
  return PARTICIPATION_SCALE * (part[step.stage] ?? 0);
}

// fitModel once per (cohort, asOf); the spotter's backtests run at past asOf dates.
export function simModel(cohort: Cohort, asOf: string): SimModel {
  let m = models.get(cohort);
  if (!m) models.set(cohort, (m = new Map()));
  let hit = m.get(asOf);
  if (!hit) m.set(asOf, (hit = fitModel(cohort, asOf)));
  return hit;
}

export function simulateFutures(idx: SpotterIndex, row: CompanyRow, investorId: string, opts: { runs?: number; seed?: number } = {}): Futures {
  const model = simModel(idx.cohort, idx.asOf);
  const last = row.eps[row.eps.length - 1];
  const { runs, prep, outs, rootSampleSize } = simulateRuns(
    { sectors: {}, stage: last.stage, companyId: row.co.id },
    UNICORN_VISION,
    model,
    { runs: opts.runs ?? FUTURE_RUNS, seed: opts.seed, naturalLead: true },
  );
  let reached = 0;
  let raisedNext = 0;
  let onPath = 0;
  let leadNext = 0;
  const part = stageParticipation(idx, investorId);
  const firstGaps: number[] = [];
  for (const o of outs) {
    if (o.reached) reached++;
    if (o.steps.length) raisedNext++;
    if (o.firstGap !== undefined && o.steps.length) firstGaps.push(o.firstGap);
    if (o.steps[0]?.leadId === investorId) leadNext++;
    onPath += 1 - o.steps.slice(0, ON_PATH_ROUNDS).reduce((miss, s) => miss * (1 - pInRound(s, investorId, part)), 1);
  }
  return {
    runs,
    pUnicorn: reached / runs,
    pRaiseNext: raisedNext / runs,
    medianMonthsToNextRound: median(firstGaps),
    pOnPath: onPath / runs,
    pLeadNext: leadNext / runs,
    transitionsBehind: rootSampleSize,
    alreadyThere: prep.alreadyThere,
    effectiveStage: prep.effectiveStage,
  };
}
