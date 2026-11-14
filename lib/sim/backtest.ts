// Backtest: fit only on rounds before asOf, simulate the company from its state at asOf, and see
// where its real next leads rank among the simulated ones.
//
// Programme step: when a company's first round was led by an accelerator (Entrepreneurs First
// funding its own cohort, Y Combinator), that round is programme entry, not a market choice of
// lead. A backtest whose asOf falls on or before it starts just after it instead.
//
// batchBacktest is the honest proof slide: many companies, rewound to just before their seed or
// Series A, scored on (1) where the real lead of that round ranks among simulated leads (top-1/3/
// 5/10) and (2) calibration of the predicted P(next round within 24 months of it) against what
// happened (Brier score, reliability bins), for the calibrated model and the uncorrected
// cohort-only model side by side.
import { buildEpisodes, droppedInvestors, fitModel, type FitOptions } from "./fit";
import { toPrecedent } from "./precedents";
import { Engine, prepare } from "./simulate";
import type { Cohort, Episode, Precedent, SimModel, StartState, Vision } from "./types";
import { MONTH_MS, mulberry32, roundStageIndex, toMs } from "./util";

export type BacktestResult = {
  realPath: Precedent;
  rankOfRealFirstLead: number | null;
  topLeads: string[];
  realFirstLead?: string;
  rankOfRealNextLead: number | null;
  topNextLeads: string[];
  realNextLead?: string;
  runs: number;
  asOf: string;
  programmeStep?: { leadName: string; date: string };
};

function ranking(counts: Map<string, number>): string[] {
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id]) => id);
}

const DAY_MS = 86400000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function fullEpisodes(cohort: Cohort): Record<string, Episode[]> {
  return buildEpisodes(cohort, Infinity, droppedInvestors(cohort));
}

function isAcceleratorLed(cohort: Cohort, e: Episode | undefined): boolean {
  return !!e?.leadId && cohort.investors[e.leadId]?.kind === "accelerator";
}

function leadName(cohort: Cohort, id: string): string {
  if (cohort.investors[id]) return cohort.investors[id].name;
  for (const r of Object.values(cohort.rounds)) {
    const p = r.participants.find((x) => x.investorId === id);
    if (p) return p.name;
  }
  return id;
}

// The state at asOf as a StartState: the company itself when it has rounds before asOf, else a
// founder about to raise the company's first round.
function startAt(cohort: Cohort, companyId: string, model: SimModel, after: Episode[]): StartState {
  const co = cohort.companies[companyId];
  const before = model.episodes[companyId] ?? [];
  return before.length
    ? { companyId, sectors: { [co.sector]: 1 }, stage: before[before.length - 1].stage, asOf: model.asOf }
    : { sectors: { [co.sector]: 1 }, stage: after[0]?.stage ?? "pre-seed", asOf: model.asOf, geography: co.country ?? co.hq };
}

const BACKTEST_VISION: Vision = { text: "backtest", targetStage: "series-b-plus", horizonYears: 10 };

export function backtest(companyId: string, asOf: string, cohort: Cohort, opts: { runs?: number; seed?: number } = {}): BacktestResult {
  const co = cohort.companies[companyId];
  if (!co) throw new Error(`backtest: unknown company ${companyId}`);
  let asOfMs = toMs(asOf);
  if (asOfMs === undefined) throw new Error(`backtest: bad asOf ${asOf}`);
  const full = fullEpisodes(cohort)[companyId] ?? [];
  let programmeStep: BacktestResult["programmeStep"];
  if (isAcceleratorLed(cohort, full[0]) && asOfMs <= full[0].lastDateMs) {
    programmeStep = { leadName: leadName(cohort, full[0].leadId!), date: isoDay(full[0].dateMs) };
    asOfMs = full[0].lastDateMs + DAY_MS;
    asOf = isoDay(asOfMs);
  }
  const model = fitModel(cohort, asOf);
  const after = full.filter((e) => e.dateMs >= asOfMs);

  const prep = prepare(startAt(cohort, companyId, model, after), BACKTEST_VISION, model);
  const engine = new Engine(model, prep);
  const runs = opts.runs ?? 3000;
  const rnd = mulberry32(opts.seed ?? 7);
  const first = new Map<string, number>();
  const second = new Map<string, number>();
  for (let i = 0; i < runs; i++) {
    const o = engine.run({ l1: null, l2: "now" }, 0, 120, rnd);
    const [a, b] = o.steps;
    if (a?.leadId) first.set(a.leadId, (first.get(a.leadId) ?? 0) + 1);
    if (b?.leadId) second.set(b.leadId, (second.get(b.leadId) ?? 0) + 1);
  }
  const firstRank = ranking(first);
  const secondRank = ranking(second);
  const realFirst = after[0]?.leadId;
  const realNext = after[1]?.leadId;
  const rankOf = (list: string[], id?: string) => (id && list.includes(id) ? list.indexOf(id) + 1 : null);
  const name = (id: string) => model.agents[model.agentIndex[id]]?.name ?? leadName(cohort, id);
  const reachedB = full.some((e) => roundStageIndex(e.stage) >= roundStageIndex("series-b-plus"));
  return {
    realPath: toPrecedent({ ...model, episodes: { [companyId]: full } }, companyId, reachedB),
    rankOfRealFirstLead: rankOf(firstRank, realFirst),
    topLeads: firstRank.slice(0, 5).map(name),
    realFirstLead: realFirst ? name(realFirst) : undefined,
    rankOfRealNextLead: rankOf(secondRank, realNext),
    topNextLeads: secondRank.slice(0, 5).map(name),
    realNextLead: realNext ? name(realNext) : undefined,
    runs,
    asOf,
    programmeStep,
  };
}

// ---- batch ----

export const NEXT_WINDOW_MONTHS = 24;
const TOP_K = [1, 3, 5, 10] as const;

export type BatchCase = {
  companyId: string;
  name: string;
  anchor: "seed" | "series-a";
  asOf: string;
  realLeadId?: string;
  realLeadName?: string;
  leadRank: number | null; // rank of the real lead among simulated leads of the anchor round
  leadEligible: boolean; // the real lead existed in the model as a lead candidate at asOf
  predictedNext?: number; // P(next round within 24 months of the anchor round | anchor closes)
  actualNext?: boolean; // undefined when the 24-month window is not over at the cohort's asOf
  inLeadSet: boolean; // >= 3 rounds, seed 2018-2022 (the lead hit-rate set)
};

export type Calib = { n: number; brier: number; baseRateBrier: number; meanPredicted: number; meanActual: number; bins: { lo: number; hi: number; n: number; predicted: number; actual: number }[] };

export type BatchReport = {
  models: { label: string; cases: BatchCase[]; leadHits: Record<string, number>; leadN: number; leadNEligible: number; calibration: Calib; calibrationLeadSet: Calib }[];
  skippedProgramme: number;
  calibrationPopulation: "seed-sample" | "all";
};

export function calibrationStats(pairs: { p: number; y: boolean }[]): Calib {
  const n = pairs.length;
  const meanActual = n ? pairs.filter((x) => x.y).length / n : 0;
  const meanPredicted = n ? pairs.reduce((s, x) => s + x.p, 0) / n : 0;
  const brier = n ? pairs.reduce((s, x) => s + (x.p - (x.y ? 1 : 0)) ** 2, 0) / n : 0;
  const baseRateBrier = n ? pairs.reduce((s, x) => s + (meanActual - (x.y ? 1 : 0)) ** 2, 0) / n : 0;
  const edges = [0, 0.2, 0.4, 0.6, 0.8, 1.0001];
  const bins = edges.slice(0, -1).map((lo, i) => {
    const xs = pairs.filter((x) => x.p >= lo && x.p < edges[i + 1]);
    return {
      lo,
      hi: Math.min(1, edges[i + 1]),
      n: xs.length,
      predicted: xs.length ? xs.reduce((s, x) => s + x.p, 0) / xs.length : 0,
      actual: xs.length ? xs.filter((x) => x.y).length / xs.length : 0,
    };
  });
  return { n, brier, baseRateBrier, meanPredicted, meanActual, bins };
}

type Anchor = { companyId: string; anchor: "seed" | "series-a"; ep: Episode; next?: Episode; inLeadSet: boolean };

function anchors(cohort: Cohort, fromYear: number, toYear: number): { list: Anchor[]; skippedProgramme: number } {
  const eps = fullEpisodes(cohort);
  const list: Anchor[] = [];
  let skippedProgramme = 0;
  const inYears = (ms: number) => {
    const y = new Date(ms).getUTCFullYear();
    return y >= fromYear && y <= toYear;
  };
  for (const [cid, es] of Object.entries(eps)) {
    const seed = es.find((e) => e.stage === "seed");
    const dated = cohort.companies[cid].roundIds.filter((id) => toMs(cohort.rounds[id]?.date) !== undefined).length;
    const inLeadSet = dated >= 3 && !!seed && inYears(seed.dateMs);
    for (const stage of ["seed", "series-a"] as const) {
      const k = es.findIndex((e) => e.stage === stage);
      if (k < 0 || !inYears(es[k].dateMs)) continue;
      if (k === 0 && isAcceleratorLed(cohort, es[0])) {
        skippedProgramme++;
        continue;
      }
      list.push({ companyId: cid, anchor: stage, ep: es[k], next: es[k + 1], inLeadSet });
    }
  }
  return { list, skippedProgramme };
}

// opts.models: fit options per model label; defaults to calibrated vs cohort-only.
export function batchBacktest(
  cohort: Cohort,
  opts: { runs?: number; seed?: number; fromYear?: number; toYear?: number; models?: { label: string; fit: FitOptions }[] } = {},
): BatchReport {
  const runs = opts.runs ?? 1000;
  const cohortAsOfMs = toMs(cohort.asOf) ?? Date.now();
  const { list, skippedProgramme } = anchors(cohort, opts.fromYear ?? 2018, opts.toYear ?? 2022);
  const seedSample = Object.values(cohort.companies).some((c) => c.sampledBy === "seed-sample");
  const inCalibration = (cid: string) => !seedSample || cohort.companies[cid].sampledBy === "seed-sample";
  const models = opts.models ?? [
    { label: "calibrated", fit: {} },
    { label: "cohort-only (no priors)", fit: { priors: null } },
  ];
  const fitCache = new Map<string, SimModel>();
  const out: BatchReport["models"] = [];
  for (const mdl of models) {
    const cases: BatchCase[] = [];
    for (const a of list) {
      const asOf = isoDay(a.ep.dateMs - DAY_MS);
      const key = `${mdl.label}|${asOf}`;
      let model = fitCache.get(key);
      if (!model) {
        model = fitModel(cohort, asOf, mdl.fit);
        fitCache.set(key, model);
      }
      const prep = prepare(startAt(cohort, a.companyId, model, [a.ep]), BACKTEST_VISION, model);
      const engine = new Engine(model, prep);
      const rnd = mulberry32((opts.seed ?? 7) + a.ep.dateMs / DAY_MS);
      const leads = new Map<string, number>();
      let closed = 0;
      let nextIn = 0;
      for (let i = 0; i < runs; i++) {
        const o = engine.run({ l1: null, l2: "now" }, 0, 120, rnd);
        const [s1, s2] = o.steps;
        if (!s1) continue;
        closed++;
        if (s1.leadId) leads.set(s1.leadId, (leads.get(s1.leadId) ?? 0) + 1);
        if (s2 && s2.monthFromStart - s1.monthFromStart <= NEXT_WINDOW_MONTHS) nextIn++;
      }
      const rank = ranking(leads);
      const real = a.ep.leadId;
      const windowOver = a.ep.dateMs + NEXT_WINDOW_MONTHS * MONTH_MS <= cohortAsOfMs;
      const ai = real !== undefined ? model.agentIndex[real] : undefined;
      cases.push({
        companyId: a.companyId,
        name: cohort.companies[a.companyId].name,
        anchor: a.anchor,
        asOf,
        realLeadId: real,
        realLeadName: real ? leadName(cohort, real) : undefined,
        leadRank: real && rank.includes(real) ? rank.indexOf(real) + 1 : null,
        leadEligible: ai !== undefined && model.agents[ai].leadEligible,
        predictedNext: closed ? nextIn / closed : undefined,
        actualNext: windowOver ? !!a.next && a.next.dateMs - a.ep.dateMs <= NEXT_WINDOW_MONTHS * MONTH_MS : undefined,
        inLeadSet: a.inLeadSet,
      });
    }
    const leadCases = cases.filter((c) => c.inLeadSet && c.realLeadId);
    const leadHits = Object.fromEntries(TOP_K.map((k) => [`top${k}`, leadCases.filter((c) => c.leadRank !== null && c.leadRank <= k).length / (leadCases.length || 1)]));
    const scored = cases.filter((c) => c.predictedNext !== undefined && c.actualNext !== undefined);
    const pairs = (xs: BatchCase[]) => xs.map((c) => ({ p: c.predictedNext!, y: c.actualNext! }));
    out.push({
      label: mdl.label,
      cases,
      leadHits,
      leadN: leadCases.length,
      leadNEligible: leadCases.filter((c) => c.leadEligible).length,
      calibration: calibrationStats(pairs(scored.filter((c) => inCalibration(c.companyId)))),
      calibrationLeadSet: calibrationStats(pairs(scored.filter((c) => c.inLeadSet))),
    });
  }
  return { models: out, skippedProgramme, calibrationPopulation: seedSample ? "seed-sample" : "all" };
}
