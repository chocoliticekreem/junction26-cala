// Calibration of the per-stage raise rates.
//
// Who may set an outcome rate (fit.ts): only the "seed-sample" companies, which the ingest drew
// without regard to outcome (first round pre-seed/seed 2017-2022, five European geographies,
// single-round companies kept). The other companies (Cala network, London portfolios,
// must-includes) were picked partly because they did well; they inform investor behaviour and
// precedents, never base rates. A cohort with no seed sample falls back to every company and is
// then treated as selection-biased: on the interim cohort 103 of 107 knowable seed rounds were
// followed by another round (96%), where published funnels put follow-on rates well under 60%.
//
// Knowable sample: transitions whose outcome is known at asOf, i.e. the round is at least
// STALL_MONTHS old (or the company closed). Recent rounds with a quick next round are excluded,
// because recent rounds without one cannot be scored yet; counting only the first is the bias.
//
// Rule per stage, with prior p0 and prior strength K = 30 pseudo-companies:
//   n = 0                                           -> p0                         (source "prior")
//   seed-sample population                          -> (raised + K p0) / (n + K)  ("blend"; thin
//                                                      samples back off to the prior)
//   full-cohort population, raised/n > p0 + 1.96 * sqrt(p0(1-p0)/(K+1))
//                                                   -> p0, flagged biased         ("prior")
//   full-cohort population otherwise                -> (raised + K p0) / (n + K)  ("blend")
// i.e. a biased population may move the rate down, but never above what the published funnel makes
// plausible. Pass `priors: null` to fitModel for the uncorrected cohort rates (Laplace), which the
// batch backtest uses as its comparison model.
//
// PRIOR VALUES (approximate, rounded readings of public funnels; a prior, not a measurement):
//   CB Insights, "Venture Capital Funnel" (2018 update, ~1,100 US tech companies seeded 2008-2010):
//     about 48% raised a second round, 28% a third, 20% a fourth, 13% a fifth. Stage-to-stage that
//     is roughly 0.48, 0.58, 0.71, 0.65.
//   Carta seed-to-Series A graduation data (published 2023-2024): the share of seed-funded startups
//     reaching Series A within two years fell from roughly 30% (2018 cohorts) to roughly 15% (2022).
//   Pre-seed -> seed has no comparable public funnel; 0.30 is an assumption sitting between the
//     two-year Carta seed graduation and the CB Insights first-step rate.
import type { Stage } from "@/lib/taxonomy";

export type StagePriors = Partial<Record<Stage, number>>;
export type OutcomePopulation = "seed-sample" | "full-cohort";

export const STAGE_PRIORS: StagePriors = {
  "pre-seed": 0.3,
  seed: 0.4,
  "series-a": 0.55,
  "series-b-plus": 0.65,
};

export const PRIOR_SOURCES: Partial<Record<Stage, string>> = {
  "pre-seed": "Assumption (no public pre-seed funnel); between Carta's 2-year seed graduation and CB Insights' first step",
  seed: "CB Insights VC funnel (~48% raise a 2nd round) and Carta seed-to-A graduation (~15-30% within 2 yrs)",
  "series-a": "CB Insights VC funnel: ~28% of seeded companies raise a 3rd round (~0.58 of those that raised a 2nd)",
  "series-b-plus": "CB Insights VC funnel: 4th and 5th rounds (~0.65-0.71 of those that raised the previous one)",
};

export const PRIOR_STRENGTH_K = 30;

export type BaseRate = {
  stage: Stage;
  p: number;
  source: "prior" | "blend" | "cohort";
  population: OutcomePopulation;
  cohort: { n: number; raised: number; rate?: number };
  prior?: number;
  priorSource?: string;
  biased: boolean;
  band: { lo: number; hi: number };
};

// Wilson score interval for k successes in n trials (95%). n = 0 gives the full [0, 1].
export function wilson(k: number, n: number, z = 1.96): { lo: number; hi: number } {
  if (n <= 0) return { lo: 0, hi: 1 };
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const r = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { lo: Math.max(0, (c - r) / d), hi: Math.min(1, (c + r) / d) };
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

export function calibrateStage(stage: Stage, raised: number, n: number, priors: StagePriors | null, population: OutcomePopulation = "full-cohort"): BaseRate {
  const cohort = { n, raised, rate: n ? r3(raised / n) : undefined };
  const p0 = priors?.[stage];
  if (p0 === undefined) {
    const p = (raised + 1) / (n + 2);
    return { stage, p, source: "cohort", population, cohort, biased: false, band: wilson(raised, n) };
  }
  const sd = Math.sqrt((p0 * (1 - p0)) / (PRIOR_STRENGTH_K + 1));
  const priorBand = { lo: Math.max(0, p0 - 1.96 * sd), hi: Math.min(1, p0 + 1.96 * sd) };
  const base = { stage, population, cohort, prior: p0, priorSource: PRIOR_SOURCES[stage] };
  if (n === 0) return { ...base, p: p0, source: "prior", biased: false, band: priorBand };
  if (population === "full-cohort" && raised / n > priorBand.hi) return { ...base, p: p0, source: "prior", biased: true, band: priorBand };
  const p = (raised + PRIOR_STRENGTH_K * p0) / (n + PRIOR_STRENGTH_K);
  return { ...base, p, source: "blend", biased: false, band: wilson(raised + PRIOR_STRENGTH_K * p0, n + PRIOR_STRENGTH_K) };
}

// Re-lead: how often the lead of a company's round at `from` also led its next round.
// Smoothed toward the all-stage rate: (same + A * overall) / (n + A).
export const RELEAD_SMOOTH_A = 5;
export type ReLeadRate = { n: number; same: number; rate: number };

export function reLeadRates(pairs: { from: Stage; same: boolean }[]): { byStage: Partial<Record<Stage, ReLeadRate>>; overall: ReLeadRate } {
  const acc: Partial<Record<Stage, { n: number; same: number }>> = {};
  let n = 0;
  let same = 0;
  for (const p of pairs) {
    const a = (acc[p.from] ??= { n: 0, same: 0 });
    a.n++;
    n++;
    if (p.same) {
      a.same++;
      same++;
    }
  }
  const overallRate = (same + 1) / (n + 2);
  const byStage: Partial<Record<Stage, ReLeadRate>> = {};
  for (const [s, a] of Object.entries(acc) as [Stage, { n: number; same: number }][]) {
    byStage[s] = { ...a, rate: (a.same + RELEAD_SMOOTH_A * overallRate) / (a.n + RELEAD_SMOOTH_A) };
  }
  return { byStage, overall: { n, same, rate: overallRate } };
}
