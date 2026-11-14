// Unicorn-shape score: how much a company's early path (its first 1-3 stage episodes) looks like
// the early paths of cohort companies that became unicorns, versus ones that stalled.
//
// Compared at the same depth k = min(3, candidate's episodes): the reference set is every cohort
// company with a known outcome as of asOf (unicorn or stalled, see base.ts) that has at least k
// episodes, compared on its first k. Companies that stalled before step k are not in it: they are
// not comparable to a company that already got there.
//
// Distance between two early paths (lower = more alike):
//   numeric part  - weighted RMS over the dims both paths have, per step i < k:
//                   stage (0..1), log10 round size (stage median when missing), months since the
//                   previous step / 12, lead kind (fund 1, cvc .8, accelerator .5, angel .2),
//                   log participants; plus headcount growth in the first 24 months when both have it
//   set part      - SET_W x (1 - Jaccard of all investors on those k steps)
//                 + LEAD_W x (1 - share of steps with the same lead)
// Neighbours: the K nearest, kernel weight exp(-d / TAU). Score = smoothed unicorn share:
//   shape = (sum w * unicorn + M * base) / (sum w + M)
// where base is the unicorn share of the whole reference set at depth k, smoothed
// (unicorns + 0.5) / (n + 1) so a reference set without unicorns still ranks on the other terms. M = 1 (one perfect match
// worth of prior) keeps one lucky neighbour from making a company look like a sure thing.
// shape is a share of a reference set that over-represents unicorns (the cohort's network and
// must-include companies were picked partly because they did well: at depth 3 about half the
// reference set are unicorns), so it is NOT a probability and is never shown as one. The signal is a
// lift, calibrated to the seed-sample companies (drawn without regard to outcome, calibration.ts):
//   popBase = smoothed unicorn share of seed-sample companies with a known outcome at asOf,
//             (unicorns + 0.5) / (known + 1)
//   odds'   = odds(shape) x odds(popBase) / odds(base)     (prior shift for a case-enriched sample)
//   lift    = p(odds') / popBase
// i.e. how many times the outcome-blind base rate this path's nearest neighbours point to; 1 when
// the neighbours look like the reference set as a whole. Without a seed sample (fixtures), lift =
// shape / base and liftBasis = "reference".
// lowConfidence when the reference set has fewer than LOW_CONFIDENCE_N rows or fewer than
// MIN_UNICORNS unicorns.
import type { Stage } from "@/lib/taxonomy";
import type { InvestorKind } from "../types";
import { LOW_CONFIDENCE_N, MONTH_MS, ROUND_STAGES, median, stageIdx, toMs, type CompanyRow, type SpotterIndex } from "./base";

export const SHAPE_K = 12;
export const SHAPE_TAU = 0.5;
export const SHAPE_PRIOR_M = 1;
export const SET_W = 0.5;
export const LEAD_W = 0.3;
export const MIN_UNICORNS = 3;
const MAX_DEPTH = 3;

const KIND_SCORE: Record<InvestorKind, number | undefined> = { fund: 1, cvc: 0.8, accelerator: 0.5, angel: 0.2, unknown: undefined };
// Per-step dims: stage, log amount, gap, lead kind, participants.
const STEP_W = [1, 1.2, 1, 0.8, 0.4];
const HEADCOUNT_W = 0.6;

export type PathVec = {
  k: number;
  x: (number | undefined)[];
  w: number[];
  investors: Set<string>;
  leads: (string | undefined)[];
};

export type Neighbour = { companyId: string; name: string; outcome: "unicorn" | "stalled"; distance: number; similarity: number; steps: string; sharedLeads: string[] };

export type ShapeScore = {
  depth: number;
  shape: number;
  base: number;
  lift: number;
  popBase?: number;
  liftBasis: "seed-sample" | "reference";
  referenceSize: number;
  unicornsInReference: number;
  neighbours: Neighbour[];
  lowConfidence: boolean;
};

function stageMedianLog(idx: SpotterIndex, s: Stage): number | undefined {
  const m = median(idx.byStage[s]?.amounts ?? []);
  return m ? Math.log10(m) : undefined;
}

export function pathVec(idx: SpotterIndex, row: CompanyRow, k: number): PathVec {
  const x: (number | undefined)[] = [];
  const w: number[] = [];
  const investors = new Set<string>();
  const leads: (string | undefined)[] = [];
  const founded = toMs(row.co.foundingDate);
  for (let i = 0; i < k; i++) {
    const e = row.eps[i];
    const prevMs = i === 0 ? founded : row.eps[i - 1].dateMs;
    const amount = e.amountUsd ? Math.log10(e.amountUsd) : stageMedianLog(idx, e.stage);
    x.push(
      stageIdx(e.stage) / (ROUND_STAGES.length - 1),
      amount,
      prevMs !== undefined && prevMs <= e.dateMs ? (e.dateMs - prevMs) / MONTH_MS / 12 : undefined,
      KIND_SCORE[e.leadKind],
      Math.log1p(e.memberIds.length) / 2,
    );
    w.push(...STEP_W);
    for (const m of e.memberIds) investors.add(m);
    leads.push(e.leadId);
  }
  x.push(headcountGrowth(row));
  w.push(HEADCOUNT_W);
  return { k, x, w, investors, leads };
}

function headcountGrowth(row: CompanyRow): number | undefined {
  const pts = (row.co.headcount ?? [])
    .map((h) => ({ ms: toMs(h.date), v: h.value }))
    .filter((h): h is { ms: number; v: number } => h.ms !== undefined && h.v > 0 && h.ms >= row.firstMs && h.ms <= row.firstMs + 24 * MONTH_MS)
    .sort((a, b) => a.ms - b.ms);
  if (pts.length < 2) return undefined;
  return Math.log10(pts[pts.length - 1].v / pts[0].v);
}

export function pathDistance(a: PathVec, b: PathVec): number {
  let num = 0;
  let den = 0;
  for (let i = 0; i < a.x.length && i < b.x.length; i++) {
    const xa = a.x[i];
    const xb = b.x[i];
    if (xa === undefined || xb === undefined) continue;
    num += a.w[i] * (xa - xb) ** 2;
    den += a.w[i];
  }
  const numeric = den ? Math.sqrt(num / den) : 1;
  let inter = 0;
  for (const m of a.investors) if (b.investors.has(m)) inter++;
  const union = a.investors.size + b.investors.size - inter;
  const jac = union ? inter / union : 0;
  let sameLead = 0;
  for (let i = 0; i < a.k; i++) if (a.leads[i] && a.leads[i] === b.leads[i]) sameLead++;
  return numeric + SET_W * (1 - jac) + LEAD_W * (1 - sameLead / a.k);
}

type Reference = { depth: number; rows: { row: CompanyRow; vec: PathVec }[]; unicorns: number };

const refCache = new WeakMap<SpotterIndex, Map<number, Reference>>();

export function referenceSet(idx: SpotterIndex, depth: number): Reference {
  let m = refCache.get(idx);
  if (!m) refCache.set(idx, (m = new Map()));
  const hit = m.get(depth);
  if (hit) return hit;
  const rows: Reference["rows"] = [];
  let unicorns = 0;
  for (const row of idx.rows.values()) {
    if (row.outcome === "open" || row.eps.length < depth) continue;
    rows.push({ row, vec: pathVec(idx, row, depth) });
    if (row.outcome === "unicorn") unicorns++;
  }
  const ref = { depth, rows, unicorns };
  m.set(depth, ref);
  return ref;
}

function stepsText(idx: SpotterIndex, row: CompanyRow, k: number): string {
  return row.eps
    .slice(0, k)
    .map((e, i) => {
      const lead = e.leadId ? idx.investorNames.get(e.leadId)?.name : undefined;
      const gap = i > 0 ? ` +${Math.max(1, Math.round((e.dateMs - row.eps[i - 1].dateMs) / MONTH_MS))} mo` : "";
      return `${stageLabel(e.stage)}${lead ? ` led by ${lead}` : ""}${gap}`;
    })
    .join(" → ");
}

const popBaseCache = new WeakMap<SpotterIndex, number | undefined>();

export function seedSampleBase(idx: SpotterIndex): number | undefined {
  if (popBaseCache.has(idx)) return popBaseCache.get(idx);
  let known = 0;
  let unicorns = 0;
  for (const row of idx.rows.values()) {
    if (row.co.sampledBy !== "seed-sample" || row.outcome === "open") continue;
    known++;
    if (row.outcome === "unicorn") unicorns++;
  }
  const out = known ? (unicorns + 0.5) / (known + 1) : undefined;
  popBaseCache.set(idx, out);
  return out;
}

const odds = (p: number) => p / (1 - p);

export function calibratedLift(shape: number, base: number, popBase: number | undefined): number {
  if (popBase === undefined || base <= 0 || base >= 1 || shape >= 1) return base > 0 ? shape / base : 1;
  const o = (odds(shape) * odds(popBase)) / odds(base);
  return o / (1 + o) / popBase;
}

const stageLabel = (s: Stage) => ({ "pre-idea": "Pre-idea", "pre-seed": "Pre-seed", seed: "Seed", "series-a": "Series A", "series-b-plus": "Series B+" })[s];

export function unicornShape(idx: SpotterIndex, row: CompanyRow): ShapeScore {
  const depth = Math.min(MAX_DEPTH, row.eps.length);
  const ref = referenceSet(idx, depth);
  const me = pathVec(idx, row, depth);
  const scored = ref.rows
    .filter((r) => r.row.co.id !== row.co.id)
    .map((r) => ({ r, d: pathDistance(me, r.vec) }))
    .sort((a, b) => a.d - b.d || a.r.row.co.id.localeCompare(b.r.row.co.id));
  const size = scored.length;
  const unicorns = ref.unicorns - (row.outcome === "unicorn" && row.eps.length >= depth ? 1 : 0);
  const base = (unicorns + 0.5) / (size + 1);
  let wu = 0;
  let wt = 0;
  for (const { r, d } of scored.slice(0, SHAPE_K)) {
    const w = Math.exp(-d / SHAPE_TAU);
    wt += w;
    if (r.row.outcome === "unicorn") wu += w;
  }
  const shape = (wu + SHAPE_PRIOR_M * base) / (wt + SHAPE_PRIOR_M) || 0;
  const popBase = seedSampleBase(idx);
  const toNeighbour = ({ r, d }: (typeof scored)[number]): Neighbour => ({
    companyId: r.row.co.id,
    name: r.row.co.name,
    outcome: r.row.outcome as "unicorn" | "stalled",
    distance: Math.round(d * 1000) / 1000,
    similarity: Math.round(Math.exp(-d / SHAPE_TAU) * 1000) / 1000,
    steps: stepsText(idx, r.row, depth),
    sharedLeads: [...new Set(me.leads.filter((l, i) => l && l === r.vec.leads[i]) as string[])].map((id) => idx.investorNames.get(id)?.name ?? id),
  });
  const nearUnicorns = scored.filter((s) => s.r.row.outcome === "unicorn").slice(0, 3).map(toNeighbour);
  const nearStalled = scored.filter((s) => s.r.row.outcome === "stalled").slice(0, 1).map(toNeighbour);
  return {
    depth,
    shape,
    base,
    lift: calibratedLift(shape, base, popBase),
    popBase,
    liftBasis: popBase === undefined ? "reference" : "seed-sample",
    referenceSize: size,
    unicornsInReference: unicorns,
    neighbours: [...nearUnicorns, ...nearStalled],
    lowConfidence: size < LOW_CONFIDENCE_N || unicorns < MIN_UNICORNS,
  };
}

export function companySteps(idx: SpotterIndex, row: CompanyRow): string {
  return stepsText(idx, row, Math.min(MAX_DEPTH, row.eps.length));
}
