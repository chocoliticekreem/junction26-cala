// Effective stage from round size, and round-size terciles.
//
// Labels inflate: in 2024-2026 data a $7.6M round led by a top-tier fund is often announced as
// "pre-seed" (Cala: EUR 7M, Lightspeed). Applying the pre-seed raise rate by label then treats seed
// money as pre-seed money. So every round gets an effective stage:
//   label stage s, amount x, per-stage USD size quartiles from the cohort's dated rounds (by label):
//   x > p75(s) and x >= p25(next(s))  ->  next(s)        (one stage at most, never down)
//   otherwise                         ->  s
// A round above the next stage's p75 still moves one stage only: a single round is weak evidence,
// and two-stage jumps would put a $30M "pre-seed" into Series A rates. Rounds without an amount keep
// their label. fit.ts uses the effective stage for every round (episodes, transitions, rates, round
// sizes) and simulate.ts for the start state, so the model is fitted and applied on one definition.
//
// Size terciles: within an effective stage, a round is small / mid / large by the stage's p33 / p67
// (same per-round size distribution). fit.ts conditions P(raise next) on the tercile.
import { STAGE_LABELS, type Stage } from "@/lib/taxonomy";
import { ROUND_STAGES, fmtUsd, quantile, roundStageIndex } from "./util";

export type SizeBand = { n: number; p25: number; p33: number; p50: number; p67: number; p75: number };
export type SizeBands = Partial<Record<Stage, SizeBand>>;
export type SizeTercile = 0 | 1 | 2;

// Fewer sized rounds than this at a stage: no band, so no bump into or out of it.
export const MIN_BAND_ROUNDS = 20;

export function sizeBands(rounds: { stage: Stage; amountUsd?: number }[]): SizeBands {
  const by: Partial<Record<Stage, number[]>> = {};
  for (const r of rounds) if (r.amountUsd && r.amountUsd > 0 && roundStageIndex(r.stage) >= 0) (by[r.stage] ??= []).push(r.amountUsd);
  const out: SizeBands = {};
  for (const [s, xs] of Object.entries(by) as [Stage, number[]][]) {
    if (xs.length < MIN_BAND_ROUNDS) continue;
    xs.sort((a, b) => a - b);
    const q = (p: number) => quantile(xs, p)!;
    out[s] = { n: xs.length, p25: q(0.25), p33: q(1 / 3), p50: q(0.5), p67: q(2 / 3), p75: q(0.75) };
  }
  return out;
}

export function effectiveStage(stage: Stage, amountUsd: number | undefined, bands: SizeBands | undefined): Stage {
  const i = roundStageIndex(stage);
  if (!bands || !amountUsd || i < 0 || i >= ROUND_STAGES.length - 1) return stage;
  const own = bands[stage];
  const next = bands[ROUND_STAGES[i + 1]];
  if (!own || !next) return stage;
  return amountUsd > own.p75 && amountUsd >= next.p25 ? ROUND_STAGES[i + 1] : stage;
}

export function sizeTercile(stage: Stage, amountUsd: number | undefined, bands: SizeBands | undefined): SizeTercile | undefined {
  const b = bands?.[stage];
  if (!b || !amountUsd) return undefined;
  return amountUsd < b.p33 ? 0 : amountUsd < b.p67 ? 1 : 2;
}

export function stageNote(label: Stage, effective: Stage, amountUsd: number | undefined, bands: SizeBands | undefined): string | undefined {
  if (label === effective || !amountUsd) return undefined;
  const b = bands?.[effective];
  const iqr = b ? ` (${STAGE_LABELS[effective].toLowerCase()} p25-p75: ${fmtUsd(b.p25)}-${fmtUsd(b.p75)})` : "";
  return `Labelled ${STAGE_LABELS[label]}; ${fmtUsd(amountUsd)} is ${STAGE_LABELS[effective].toLowerCase()}-sized in the cohort${iqr}.`;
}
