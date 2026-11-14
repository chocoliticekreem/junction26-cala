// The early spotter: companies on a unicorn-shaped path, personalised per investor.
//
//   1. taste       investorTaste() from the investor's own rounds before asOf (spotter/taste.ts)
//   2. candidates  first dated round within CANDIDATE_WINDOW_MONTHS before asOf, not already in the
//                  investor's portfolio, not already a unicorn or closed, in the investor's lane:
//                    - its current (effective) stage is at most one stage past the investor's entry
//                      stage (taste.entryStage, the stage it usually first joins a company at), and
//                    - its next round is at a stage holding >= LANE_MIN_STAGE_SHARE (15%) of the
//                      investor's lead-weighted entries into new companies (taste.entryDist; the
//                      full stage distribution only when it has no entries, e.g. revealed-only).
//                      Entries, not all rounds: a candidate is never in the portfolio, so the
//                      investor would be coming in new, and follow-ons inflate later stages
//                      (Seedcamp's rounds are 17% Series B+, its entries 0%). 15%, not 10%:
//                      below that an entry stage is opportunistic (Seedcamp 6% at Series A,
//                      Lightspeed 15% at seed sits on the line on the real cohort).
//                  An investor with no stage history gets no lane filter. Then
//                  fit = 0.6 * sector fit + 0.4 * next-stage fit >= FIT_THRESHOLD (relative to the
//                  investor's own top sector/stage; sector fit is the larger of the sector share and
//                  the tags+description similarity to the investor's portfolio, spotter/taste.ts). When fewer than MIN_CANDIDATES pass, the best
//                  MIN_CANDIDATES by fit with fit > 0 are kept instead, so thin investors still get a list.
//   3. shape       kNN of the early path against unicorns vs stalled companies (spotter/shape.ts),
//                  reported as a lift over the seed-sample base rate, never as a probability
//   4. futures     the founder simulator's calibrated Monte Carlo from the company's real state
//                  (spotter/futures.ts): pUnicorn = P($1B within 5 years), P(investor on its path).
//                  Companies already past the unicorn funding bar are dropped (not early any more).
//   5. rank        on relative signals only, so a Series A company's higher absolute odds do not
//                  outrank a seed company that is further ahead of its own stage:
//                  score = fit^W.fit * (L / (1 + L))^W.lift * (0.05 + pOnPath)^W.path * (S / (1 + S))^W.shape
//                  L = pUnicorn' / unicornBaseRate, the lift over the stage-matched base rate
//                  (spotter/shape.ts stageBaseRates: seed-sample companies that reached the company's
//                  current stage), pUnicorn' = (unicorn runs + 0.5) / (runs + 1) so a zero never wipes
//                  a pick out; S = the shape lift; x / (1 + x) maps a lift into (0, 1), 0.5 at 1x.
//                  Weights: stage-matched lift 0.4, fit 0.25, pOnPath 0.25, shape 0.1. Each factor
//                  is in (0, 1], so combined is too. Futures run only for the best MAX_SIMULATED by
//                  fit x shape (speed); the rest are ranked below them.
// Every component is returned so the UI can show why a company is on the list.
import type { Sector, Stage } from "@/lib/taxonomy";
import type { Revealed } from "@/lib/types";
import type { Cohort } from "./types";
import {
  LOW_CONFIDENCE_N,
  MONTH_MS,
  ROUND_STAGES,
  resolveInvestor,
  spotterIndex,
  stageIdx,
  type CompanyRow,
  type SpotterIndex,
} from "./spotter/base";
import { simulateFutures, FUTURE_RUNS, type Futures } from "./spotter/futures";
import { centroid, similarityIndex, textSimilarity } from "./similarity";
import { companySteps, stageBaseRates, unicornShape, type Neighbour, type ShapeScore } from "./spotter/shape";
import { tasteFit, tasteFromIndex, type InvestorTaste } from "./spotter/taste";

export { investorTaste, type InvestorTaste } from "./spotter/taste";
export { unicornShape } from "./spotter/shape";
export { simulateFutures } from "./spotter/futures";
export { spotterIndex } from "./spotter/base";

export const CANDIDATE_WINDOW_MONTHS = 36;
export const FIT_THRESHOLD = 0.3;
export const MIN_CANDIDATES = 40;
export const MAX_SIMULATED = 40;
export const TOP_N = 20;
export const WEIGHTS = { fit: 0.25, lift: 0.4, path: 0.25, shape: 0.1 } as const;
export const LANE_MIN_STAGE_SHARE = 0.15;
export const LANE_ENTRY_SLACK = 1;

export type SpotterPick = {
  rank: number;
  company: {
    id: string;
    name: string;
    sector: Sector;
    hq?: string;
    path: string;
    latestRound: { id: string; stage: Stage; label: string; date?: string; amountUsd?: number; leadName?: string };
    investors: { id: string; name: string }[];
  };
  scores: {
    combined: number;
    fit: number;
    // kNN unicorn share inside the (unicorn-enriched) reference set and that set's own share.
    // Inputs to the lift; not probabilities, do not show them as odds.
    shape: number;
    shapeBase: number;
    // kNN precedent lift over the seed-sample base rate (spotter/shape.ts); a ranking input.
    shapeLift: number;
    // The display pair: pUnicorn (absolute, calibrated) and unicornLift = pUnicorn / unicornBaseRate,
    // "x times the base rate for its stage". unicornBaseRate is stage-matched: the unicorn share of
    // seed-sample companies that reached this company's current stage (spotter/shape.ts).
    unicornLift?: number;
    unicornBaseRate?: number;
    // P(reaches a $1B valuation within 5 years), from the founder simulator's calibrated engine.
    pUnicorn?: number;
    pRaiseNext?: number;
    medianMonthsToNextRound?: number;
    pOnPath?: number;
    pLeadNext?: number;
  };
  line: string;
  precedents: { unicorns: Neighbour[]; stalled: Neighbour[] };
  sample: { referenceSize: number; unicornsInReference: number; depth: number; runs: number; transitionsBehind: number };
  lowConfidence: boolean;
  actions: { sharedCoInvestors: { id: string; name: string; together: number }[] };
};

export type SpotterResult = {
  investor: {
    id: string;
    name: string;
    kind: string;
    chips: string[];
    rounds: number;
    companies: number;
    leadShare: number;
    entryStage?: Stage;
    lane?: Lane;
    chequeBand?: [number, number];
    sectorDist: Partial<Record<Sector, number>>;
    stageDist: Partial<Record<Stage, number>>;
    lowConfidence: boolean;
  };
  picks: SpotterPick[];
  asOf: string;
  basis: string;
  considered: { candidates: number; simulated: number; roundsInCohort: number };
  weights: typeof WEIGHTS;
};

export type SpotterQuery = { investorId?: string; investorName?: string; asOf?: string; runs?: number; topN?: number; revealedFor?: (investorId: string) => Revealed | undefined };

export class SpotterError extends Error {
  constructor(
    readonly code: "investor_not_found",
    message: string,
  ) {
    super(message);
  }
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

function nextStage(row: CompanyRow): Stage {
  return ROUND_STAGES[Math.min(ROUND_STAGES.length - 1, stageIdx(row.eps[row.eps.length - 1].stage) + 1)];
}

// maxStage: the latest current stage a candidate may be at; nextStages: stages its next round may be at.
export type Lane = { maxStage: Stage; nextStages: Stage[]; minShare: number };

export function investorLane(taste: InvestorTaste): Lane | undefined {
  const source = Object.keys(taste.entryDist).length ? taste.entryDist : taste.stageDist;
  const dist = ROUND_STAGES.map((s) => [s, source[s] ?? 0] as const);
  const peak = dist.reduce((a, b) => (b[1] > a[1] ? b : a));
  const entry = taste.entryStage ?? (peak[1] > 0 ? peak[0] : undefined);
  const nextStages = dist.filter(([, v]) => v >= LANE_MIN_STAGE_SHARE).map(([s]) => s);
  if (!entry || !nextStages.length) return undefined;
  const maxStage = ROUND_STAGES[Math.min(ROUND_STAGES.length - 1, stageIdx(entry) + LANE_ENTRY_SLACK)];
  return { maxStage, nextStages, minShare: LANE_MIN_STAGE_SHARE };
}

export function inLane(lane: Lane | undefined, row: CompanyRow): boolean {
  if (!lane) return true;
  return stageIdx(row.eps[row.eps.length - 1].stage) <= stageIdx(lane.maxStage) && lane.nextStages.includes(nextStage(row));
}

export function spotterCandidates(idx: SpotterIndex, taste: InvestorTaste): { row: CompanyRow; fit: number }[] {
  const windowStart = idx.asOfMs - CANDIDATE_WINDOW_MONTHS * MONTH_MS;
  const lane = investorLane(taste);
  const rows: CompanyRow[] = [];
  for (const row of idx.rows.values()) {
    if (row.firstMs < windowStart || row.firstMs >= idx.asOfMs) continue;
    if (taste.portfolio.has(row.co.id) || row.outcome === "unicorn") continue;
    if (idx.trustPresent && row.co.status === "closed") continue;
    if (!inLane(lane, row)) continue;
    rows.push(row);
  }
  const sim = similarityIndex(idx.cohort);
  const portfolio = centroid(sim, taste.portfolio);
  const likes = rows.map((r) => textSimilarity(sim, portfolio, r.co.id));
  const maxLike = Math.max(0, ...likes);
  const pool = rows.map((row, i) => ({ row, fit: tasteFit(taste, row.co.sector, nextStage(row), maxLike ? likes[i] / maxLike : 0) }));
  pool.sort((a, b) => b.fit - a.fit || a.row.co.id.localeCompare(b.row.co.id));
  const passing = pool.filter((c) => c.fit >= FIT_THRESHOLD);
  return passing.length >= MIN_CANDIDATES ? passing : pool.filter((c) => c.fit > 0).slice(0, MIN_CANDIDATES);
}

function pickLine(shape: ShapeScore): string {
  const close = shape.neighbours.filter((n) => n.outcome === "unicorn" && n.similarity >= 0.3).slice(0, 2);
  const steps = shape.depth === 1 ? "first step" : `first ${shape.depth === 2 ? "two" : "three"} steps`;
  if (close.length) return `Same ${steps} as ${close.map((n) => n.name).join(", ")}`;
  const nearest = shape.neighbours.find((n) => n.outcome === "unicorn");
  return nearest ? `Closest unicorn path: ${nearest.name}` : "No unicorn precedent at this depth yet";
}

// Stage-matched unicorn base rate for the company's current stage, the lift over it, and the same
// lift on pUnicorn' (smoothed, for ranking).
function stageLift(idx: SpotterIndex, row: CompanyRow, fut: Futures | undefined): { base?: number; lift?: number; smoothedLift?: number } {
  const base = stageBaseRates(idx).byStage[row.eps[row.eps.length - 1].stage]?.rate;
  if (base === undefined || !fut) return { base };
  const pU = (fut.pUnicorn * fut.runs + 0.5) / (fut.runs + 1);
  return { base, lift: fut.pUnicorn / base, smoothedLift: pU / base };
}

function buildPick(idx: SpotterIndex, taste: InvestorTaste, row: CompanyRow, fit: number, shape: ShapeScore, fut: Futures | undefined, combined: number): Omit<SpotterPick, "rank"> {
  const last = row.eps[row.eps.length - 1];
  const lastRound = idx.cohort.rounds[last.roundIds[last.roundIds.length - 1]];
  const name = (id: string) => idx.investorNames.get(id)?.name ?? id;
  const coCount = new Map(taste.coInvestors.map((c) => [c.id, c.count]));
  const sharedCoInvestors = [...row.investorIds]
    .filter((id) => coCount.has(id))
    .map((id) => ({ id, name: name(id), together: coCount.get(id)! }))
    .sort((a, b) => b.together - a.together)
    .slice(0, 5);
  const sl = stageLift(idx, row, fut);
  return {
    company: {
      id: row.co.id,
      name: row.co.name,
      sector: row.co.sector,
      hq: row.co.hq,
      path: companySteps(idx, row),
      latestRound: {
        id: lastRound.id,
        stage: last.stage,
        label: lastRound.label,
        date: lastRound.date,
        amountUsd: lastRound.amountUsd,
        leadName: last.leadId ? name(last.leadId) : undefined,
      },
      investors: [...row.investorIds].map((id) => ({ id, name: name(id) })),
    },
    scores: {
      combined: r3(combined),
      fit: r3(fit),
      shape: r3(shape.shape),
      shapeBase: r3(shape.base),
      shapeLift: Math.round(shape.lift * 100) / 100,
      unicornLift: sl.lift !== undefined ? Math.round(sl.lift * 100) / 100 : undefined,
      unicornBaseRate: sl.base !== undefined ? r3(sl.base) : undefined,
      pUnicorn: fut && Math.round(fut.pUnicorn * 10000) / 10000,
      pRaiseNext: fut && r3(fut.pRaiseNext),
      medianMonthsToNextRound: fut?.medianMonthsToNextRound !== undefined ? Math.round(fut.medianMonthsToNextRound) : undefined,
      pOnPath: fut && r3(fut.pOnPath),
      pLeadNext: fut && r3(fut.pLeadNext),
    },
    line: pickLine(shape),
    precedents: {
      unicorns: shape.neighbours.filter((n) => n.outcome === "unicorn"),
      stalled: shape.neighbours.filter((n) => n.outcome === "stalled"),
    },
    sample: {
      referenceSize: shape.referenceSize,
      unicornsInReference: shape.unicornsInReference,
      depth: shape.depth,
      runs: fut?.runs ?? 0,
      transitionsBehind: fut?.transitionsBehind ?? 0,
    },
    lowConfidence: shape.lowConfidence || !fut || fut.transitionsBehind < LOW_CONFIDENCE_N,
    actions: { sharedCoInvestors },
  };
}

type Ranked = { row: CompanyRow; fit: number; shape: ShapeScore; fut?: Futures; combined: number };

export function rankSpotter(cohort: Cohort, q: SpotterQuery): { idx: SpotterIndex; taste: InvestorTaste; ranked: Ranked[] } {
  const idx = spotterIndex(cohort, q.asOf);
  const investorId = resolveInvestor(idx, q);
  if (!investorId) throw new SpotterError("investor_not_found", `No investor "${q.investorName ?? q.investorId}" in the cohort`);
  const taste = tasteFromIndex(idx, investorId, { revealed: q.revealedFor?.(investorId) });
  const runs = q.runs ?? FUTURE_RUNS;
  const cands = spotterCandidates(idx, taste).map((c) => ({ ...c, shape: unicornShape(idx, c.row) }));
  const pre = (c: (typeof cands)[number]) => c.fit ** WEIGHTS.fit * (c.shape.lift / (1 + c.shape.lift)) ** WEIGHTS.shape;
  cands.sort((a, b) => pre(b) - pre(a) || a.row.co.id.localeCompare(b.row.co.id));
  const ranked: Ranked[] = [];
  cands.forEach((c, i) => {
    if (i >= MAX_SIMULATED) return void ranked.push({ ...c, combined: 0 });
    const fut = simulateFutures(idx, c.row, investorId, { runs });
    if (fut.alreadyThere) return;
    const L = stageLift(idx, c.row, fut).smoothedLift ?? c.shape.lift;
    const combined = pre(c) * (L / (1 + L)) ** WEIGHTS.lift * (0.05 + fut.pOnPath) ** WEIGHTS.path;
    ranked.push({ ...c, fut, combined });
  });
  ranked.sort((a, b) => b.combined - a.combined || pre(b) - pre(a) || a.row.co.id.localeCompare(b.row.co.id));
  return { idx, taste, ranked };
}

export function runSpotter(cohort: Cohort, q: SpotterQuery): SpotterResult {
  const { idx, taste, ranked } = rankSpotter(cohort, q);
  const top = ranked.slice(0, q.topN ?? TOP_N);
  let roundsInCohort = 0;
  for (const row of idx.rows.values()) for (const e of row.eps) roundsInCohort += e.roundIds.length;
  return {
    investor: {
      id: taste.investorId,
      name: taste.name,
      kind: taste.kind,
      chips: taste.chips,
      rounds: taste.rounds,
      companies: taste.companies,
      leadShare: r3(taste.leadShare),
      entryStage: taste.entryStage,
      lane: investorLane(taste),
      chequeBand: taste.chequeBand,
      sectorDist: taste.sectorDist,
      stageDist: taste.stageDist,
      lowConfidence: taste.rounds < 5,
    },
    picks: top.map((r, i) => ({ rank: i + 1, ...buildPick(idx, taste, r.row, r.fit, r.shape, r.fut, r.combined) })),
    asOf: idx.asOf,
    basis: `Evidence from ${roundsInCohort} real rounds in Cala, not a forecast`,
    considered: { candidates: ranked.length, simulated: Math.min(ranked.length, MAX_SIMULATED), roundsInCohort },
    weights: WEIGHTS,
  };
}

// Backtest: run the spotter at a past asOf and report where companies that later became unicorns
// landed. A target can be missing for a stated reason (already in the portfolio, first round outside
// the window, no rounds yet) rather than silently absent.
export type BacktestRow = {
  investor: string;
  asOf: string;
  candidates: number;
  targets: { name: string; rank: number | null; inTop20: boolean; reason?: string }[];
  top5: string[];
};

export function backtestSpotter(cohort: Cohort, investorName: string, asOf: string, targetNames: string[]): BacktestRow {
  const { idx, taste, ranked } = rankSpotter(cohort, { investorName, asOf });
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const targets = targetNames.map((t) => {
    const co = Object.values(cohort.companies).find((c) => norm(c.name) === norm(t));
    if (!co) return { name: t, rank: null, inTop20: false, reason: "not in cohort" };
    const i = ranked.findIndex((r) => r.row.co.id === co.id);
    if (i >= 0) return { name: co.name, rank: i + 1, inTop20: i < TOP_N };
    const row = idx.rows.get(co.id);
    const reason = !row
      ? "no dated round before asOf"
      : taste.portfolio.has(co.id)
        ? "already in this investor's portfolio by asOf"
        : row.outcome === "unicorn"
          ? "already a unicorn by asOf"
          : row.firstMs < idx.asOfMs - CANDIDATE_WINDOW_MONTHS * MONTH_MS
            ? `first round more than ${CANDIDATE_WINDOW_MONTHS} months before asOf`
            : !inLane(investorLane(taste), row)
              ? "outside this investor's stage lane"
              : spotterCandidates(idx, taste).some((c) => c.row.co.id === co.id)
                ? "already at Series B+ with the unicorn funding bar raised by asOf"
                : "below the sector/stage fit threshold";
    return { name: co.name, rank: null, inTop20: false, reason };
  });
  return { investor: taste.name, asOf: idx.asOf, candidates: ranked.length, targets, top5: ranked.slice(0, 5).map((r) => r.row.co.name) };
}
