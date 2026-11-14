import { STAGE_LABELS, isStage, type Stage } from "@/lib/taxonomy";
import type { CohortParticipant, CohortRound, InvestorKind } from "./types";

// Rounds only: "pre-idea" is a founder state, never a round.
export const ROUND_STAGES: Stage[] = ["pre-seed", "seed", "series-a", "series-b-plus"];
export const MONTH_MS = 30.44 * 86400000;
// A company with no round for this long before asOf counts as stalled at its last stage.
export const STALL_MONTHS = 24;
// Branches and routes backed by fewer real transitions than this are flagged lowConfidence.
export const LOW_CONFIDENCE_N = 20;
// Vision proxy when the cohort has no valuations: Series B+ with at least this much raised.
export const PROXY_FUNDING_USD = 100_000_000;

export function roundStageIndex(s: Stage): number {
  return ROUND_STAGES.indexOf(s);
}

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

export function quantile(sorted: number[], q: number): number | undefined {
  if (!sorted.length) return undefined;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function median(xs: number[]): number | undefined {
  return quantile([...xs].sort((a, b) => a - b), 0.5);
}

export function toMs(date: string | undefined): number | undefined {
  if (!date) return undefined;
  const ms = Date.parse(date.length === 4 ? `${date}-07-01` : date.length === 7 ? `${date}-15` : date);
  return Number.isFinite(ms) ? ms : undefined;
}

export function monthsBetween(a: number, b: number): number {
  return (b - a) / MONTH_MS;
}

const KIND_RANK: Record<InvestorKind, number> = { fund: 0, cvc: 1, accelerator: 2, angel: 3, unknown: 4 };

// Cala's is_lead flag when present; else the only participant; else the most institutional one
// (fund > cvc > accelerator > angel), first listed on ties.
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

export function fmtMonths(m: number): string {
  return m < 24 ? `${Math.max(1, Math.round(m))} mo` : `${(m / 12).toFixed(1)} yrs`;
}

export function fmtUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}k`;
  return `$${Math.round(n)}`;
}

export const stageLabel = (s: Stage) => STAGE_LABELS[s];
