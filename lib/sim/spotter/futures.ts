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
//   pOnPath     share of runs where the investor leads, or joins as a co-investor, one of the next
//               ON_PATH_ROUNDS rounds
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
  const firstGaps: number[] = [];
  for (const o of outs) {
    if (o.reached) reached++;
    if (o.steps.length) raisedNext++;
    if (o.firstGap !== undefined && o.steps.length) firstGaps.push(o.firstGap);
    if (o.steps[0]?.leadId === investorId) leadNext++;
    if (o.steps.slice(0, ON_PATH_ROUNDS).some((s) => s.leadId === investorId || s.coInvestorIds.includes(investorId))) onPath++;
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
