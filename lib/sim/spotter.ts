// The early spotter: companies on a unicorn-shaped path, personalised per investor.
//
//   1. taste       investorTaste() from the investor's own rounds before asOf (spotter/taste.ts)
//   2. candidates  first dated round within CANDIDATE_WINDOW_MONTHS before asOf, not already in the
//                  investor's portfolio, not already a unicorn or closed, and
//                  fit = 0.6 * sector fit + 0.4 * next-stage fit >= FIT_THRESHOLD (relative to the
//                  investor's own top sector/stage; sector fit is the larger of the sector share and
//                  the tags+description similarity to the investor's portfolio, spotter/taste.ts). When fewer than MIN_CANDIDATES pass, the best
//                  MIN_CANDIDATES by fit with fit > 0 are kept instead, so thin investors still get a list.
//   3. shape       kNN of the early path against unicorns vs stalled companies (spotter/shape.ts)
//   4. futures     FUTURE_RUNS simulated futures from the last real round (spotter/futures.ts):
//                  P(unicorn-shaped), median months to next round, P(investor on its path)
//   5. rank        score = fit^W_FIT * shape^W_SHAPE * pUnicorn'^W_SIM * (0.05 + pOnPath)^W_PATH
//                  pUnicorn' = (unicorn runs + 0.5) / (runs + 1) so a zero never wipes a pick out.
//                  Futures run only for the best MAX_SIMULATED by fit x shape (speed); the rest are
//                  ranked below them.
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
import { companySteps, unicornShape, type Neighbour, type ShapeScore } from "./spotter/shape";
import { tasteFit, tasteFromIndex, type InvestorTaste } from "./spotter/taste";
import type { HostEvent } from "./spotter/host";

export { investorTaste, type InvestorTaste } from "./spotter/taste";
export { unicornShape } from "./spotter/shape";
export { simulateFutures } from "./spotter/futures";
export { spotterIndex } from "./spotter/base";

export const CANDIDATE_WINDOW_MONTHS = 36;
export const FIT_THRESHOLD = 0.3;
export const MIN_CANDIDATES = 40;
export const MAX_SIMULATED = 120;
export const TOP_N = 20;
export const WEIGHTS = { fit: 0.2, shape: 0.35, sim: 0.3, path: 0.15 } as const;

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
  event?: { name: string; date: string; place: string };
  scores: {
    combined: number;
    fit: number;
    shape: number;
    shapeBase: number;
    shapeLift: number;
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
    chequeBand?: [number, number];
    sectorDist: Partial<Record<Sector, number>>;
    stageDist: Partial<Record<Stage, number>>;
    lowConfidence: boolean;
  };
  picks: SpotterPick[];
  // Events the fund could host (lib/sim/spotter/host.ts); filled by the API, not by runSpotter.
  host?: HostEvent[];
  // Every event with an attendee list and how many of this fund's fit companies attend; filled by the API.
  events?: { id: string; name: string; date: string; place: string; source: { name: string; url: string; asOf: string }; attendees: number; attending: number }[];
  asOf: string;
  basis: string;
  considered: { candidates: number; simulated: number; roundsInCohort: number };
  weights: typeof WEIGHTS;
};

export type SpotterQuery = {
  investorId?: string;
  investorName?: string;
  asOf?: string;
  runs?: number;
  topN?: number;
  revealedFor?: (investorId: string) => Revealed | undefined;
  // Restrict candidates (e.g. to companies attending an event); the ranking itself is unchanged.
  only?: (company: { id: string; name: string }) => boolean;
};

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

export function spotterCandidates(idx: SpotterIndex, taste: InvestorTaste, only?: SpotterQuery["only"]): { row: CompanyRow; fit: number }[] {
  const windowStart = idx.asOfMs - CANDIDATE_WINDOW_MONTHS * MONTH_MS;
  const rows: CompanyRow[] = [];
  for (const row of idx.rows.values()) {
    if (only && !only(row.co)) continue;
    if (row.firstMs < windowStart || row.firstMs >= idx.asOfMs) continue;
    if (taste.portfolio.has(row.co.id) || row.outcome === "unicorn") continue;
    if (idx.trustPresent && row.co.status === "closed") continue;
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
      pUnicorn: fut && r3(fut.pUnicorn),
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
  const cands = spotterCandidates(idx, taste, q.only).map((c) => ({ ...c, shape: unicornShape(idx, c.row) }));
  const pre = (c: (typeof cands)[number]) => c.fit ** WEIGHTS.fit * c.shape.shape ** WEIGHTS.shape;
  cands.sort((a, b) => pre(b) - pre(a) || a.row.co.id.localeCompare(b.row.co.id));
  const ranked: Ranked[] = cands.map((c, i) => {
    if (i >= MAX_SIMULATED) return { ...c, combined: 0 };
    const fut = simulateFutures(idx, c.row, investorId, { runs });
    const pU = (fut.pUnicorn * fut.runs + 0.5) / (fut.runs + 1);
    const combined = pre(c) * pU ** WEIGHTS.sim * (0.05 + fut.pOnPath) ** WEIGHTS.path;
    return { ...c, fut, combined };
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
            : "below the sector/stage fit threshold";
    return { name: co.name, rank: null, inTop20: false, reason };
  });
  return { investor: taste.name, asOf: idx.asOf, candidates: ranked.length, targets, top5: ranked.slice(0, 5).map((r) => r.row.co.name) };
}
