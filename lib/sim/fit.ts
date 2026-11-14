// fitModel: turns the cohort's round graph into investor agents and stage-transition statistics.
//
// Leakage guard: only rounds dated strictly before asOf are used, and company.status (a present-day
// fact) is only trusted when asOf is on or after the cohort's own asOf. Undated rounds are ignored
// (they cannot be ordered or placed before/after asOf).
//
// Survivorship guard: a company whose last round is STALL_MONTHS or more before asOf (or that is
// closed) counts as a stalled transition at its last stage, so the rates are not computed only from
// companies that kept raising. Too-recent companies are "censored" and kept out of every rate.
// Acquired companies with no further round are censored too (an exit is not a stall).
//
// Smoothing / backoff, everywhere a rate is estimated from few observations:
//   P(raise | stage)          = (raised + 1) / (n + 2)                         (Laplace)
//   P(raise | sector, stage)  = (raised + K * P(stage)) / (n + K),  K = 5       (shrink to stage)
//   lift(kind)                = (raised_k + L) / (expected_k + L),  L = 3       (vs sector/stage base)
//   lift(investor)            = (raised_i + L * lift(kind)) / (expected_i + L)  (shrink to kind)
// where expected = sum of P(raise | sector, stage) over the companies that investor/kind led.
// Next-lead backoff (investor -> kind -> global) lives in simulate.ts, on the counts built here.
//
// Calibration (calibration.ts): the engine's raise rates come from model.baseRates, which anchor
// the knowable cohort rate to a published per-stage prior when the cohort is survivorship-biased.
// Investor quality (quality.ts): generic and non-investor participants are dropped from the round
// graph before anything is counted; thin unresolved investors stay as co-investors but cannot lead.
import type { Sector, Stage } from "@/lib/taxonomy";
import { STAGE_PRIORS, calibrateStage, reLeadRates, type BaseRate, type OutcomePopulation, type StagePriors } from "./calibration";
import { addGeo, emptyGeoCounts, parseGeo, type GeoCounts } from "./geo";
import { investorDropReason, isLeadEligible, type InvestorDropReason } from "./quality";
import { effectiveStage, sizeBands, sizeTercile, type SizeBands } from "./stageSize";
import type {
  Agent,
  Cohort,
  CohortRound,
  Episode,
  FollowOnStats,
  InvestorKind,
  SimModel,
  SizeRates,
  Transition,
  TransitionStats,
} from "./types";
import { MONTH_MS, ROUND_STAGES, STALL_MONTHS, leadOf, median, monthsBetween, roundStageIndex, stageFromLabel, toMs } from "./util";

export const SECTOR_SHRINK_K = 5;
export const LIFT_SHRINK_L = 3;
const LEAD_WEIGHT = 1.5;
const B_PLUS_ORDINALS = 4;
// Below this many seed-sample gaps at a stage, timing backs off to all cohort gaps (timing is less
// selection-sensitive than whether a round happens at all).
const MIN_POP_GAPS = 20;
// Pseudo-observations pulling a size-tercile raise rate toward its stage rate.
export const SIZE_SHRINK_K = 10;

export type FitOptions = { priors?: StagePriors | null };

// Investors removed from the round graph by the quality filter, with the reason.
export function droppedInvestors(cohort: Cohort): Map<string, InvestorDropReason> {
  const out = new Map<string, InvestorDropReason>();
  for (const r of Object.values(cohort.rounds)) {
    for (const p of r.participants) {
      if (out.has(p.investorId)) continue;
      const why = investorDropReason(cohort.investors[p.investorId]?.name ?? p.name);
      if (why) out.set(p.investorId, why);
    }
  }
  return out;
}

function cleanRound(r: CohortRound, drop?: Map<string, InvestorDropReason>): CohortRound {
  if (!drop?.size || !r.participants.some((p) => drop.has(p.investorId))) return r;
  return { ...r, participants: r.participants.filter((p) => !drop.has(p.investorId)) };
}

const labelStage = (r: CohortRound): Stage | undefined => (r.stage !== "unknown" ? r.stage : stageFromLabel(r.label));

// Per-stage USD size quartiles of the rounds dated before asOf, by label (stageSize.ts).
export function labelSizeBands(cohort: Cohort, asOfMs: number): SizeBands {
  const rounds: { stage: Stage; amountUsd?: number }[] = [];
  for (const r of Object.values(cohort.rounds)) {
    const ms = toMs(r.date);
    const stage = labelStage(r);
    if (ms !== undefined && ms < asOfMs && stage) rounds.push({ stage, amountUsd: r.amountUsd });
  }
  return sizeBands(rounds);
}

// bands: when given, each round is placed at its effective stage (stageSize.ts) instead of its label.
export function buildEpisodes(cohort: Cohort, asOfMs: number, drop?: Map<string, InvestorDropReason>, bands?: SizeBands): Record<string, Episode[]> {
  const out: Record<string, Episode[]> = {};
  for (const co of Object.values(cohort.companies)) {
    const rs = co.roundIds
      .map((id) => cohort.rounds[id])
      .filter((r) => r)
      .map((r) => cleanRound(r, drop))
      .map((r) => {
        const label = labelStage(r);
        return { r, ms: toMs(r.date), stage: label && label !== "pre-idea" ? effectiveStage(label, r.amountUsd, bands) : label };
      })
      .filter((x): x is typeof x & { ms: number; stage: Stage } => x.ms !== undefined && x.ms < asOfMs && !!x.stage && x.stage !== "pre-idea")
      .sort((a, b) => a.ms - b.ms);
    const eps: Episode[] = [];
    for (const { r, ms, stage } of rs) {
      const cur = eps[eps.length - 1];
      const idx = roundStageIndex(stage);
      const curIdx = cur ? roundStageIndex(cur.stage) : -1;
      const members = r.participants.map((p) => p.investorId);
      if (cur && (idx < curIdx || (idx === curIdx && stage !== "series-b-plus"))) {
        cur.roundIds.push(r.id);
        cur.lastDateMs = ms;
        for (const m of members) if (!cur.memberIds.includes(m)) cur.memberIds.push(m);
        if (r.amountUsd) cur.amountUsd = (cur.amountUsd ?? 0) + r.amountUsd;
        if (r.valuationUsd) cur.valuationUsd = Math.max(cur.valuationUsd ?? 0, r.valuationUsd);
        continue;
      }
      eps.push({
        stage,
        roundIds: [r.id],
        dateMs: ms,
        lastDateMs: ms,
        leadId: leadOf(r)?.investorId,
        memberIds: [...new Set(members)],
        amountUsd: r.amountUsd,
        valuationUsd: r.valuationUsd,
      });
    }
    if (eps.length) out[co.id] = eps;
  }
  return out;
}

function emptyStats(): TransitionStats {
  return { n: 0, raised: 0, stalled: 0, pRaise: 0, months: [], nextStage: {} };
}

function addToStats(s: TransitionStats, t: Transition) {
  if (t.outcome === "censored") return;
  s.n++;
  if (t.outcome === "raised") {
    s.raised++;
    if (t.months !== undefined) s.months.push(t.months);
    if (t.nextStage) s.nextStage[t.nextStage] = (s.nextStage[t.nextStage] ?? 0) + 1;
  } else s.stalled++;
}

export function fitModel(cohort: Cohort, asOf?: string, opts: FitOptions = {}): SimModel {
  const asOfStr = asOf ?? cohort.asOf;
  const asOfMs = toMs(asOfStr) ?? Date.now();
  const trustStatus = asOfMs >= (toMs(cohort.asOf) ?? 0);
  const drop = droppedInvestors(cohort);
  const labelBands = labelSizeBands(cohort, asOfMs);
  const episodes = buildEpisodes(cohort, asOfMs, drop, labelBands);
  const episodeBands = sizeBands(Object.values(episodes).flat());
  const kindOf = (id: string): InvestorKind => cohort.investors[id]?.kind ?? "unknown";
  const knowableBefore = asOfMs - STALL_MONTHS * MONTH_MS;

  // ---- transitions ----
  const transitions: Transition[] = [];
  for (const [cid, eps] of Object.entries(episodes)) {
    const co = cohort.companies[cid];
    const lastMs = eps[eps.length - 1].lastDateMs;
    const closed = trustStatus && co.status === "closed";
    const acquired = trustStatus && co.status === "acquired";
    eps.forEach((e, k) => {
      const next = eps[k + 1];
      const base = { companyId: cid, sector: co.sector, stage: e.stage, roundId: e.roundIds[0], leadId: e.leadId, memberIds: e.memberIds, amountUsd: e.amountUsd };
      if (next) {
        transitions.push({
          ...base,
          outcome: "raised",
          knowable: e.dateMs <= knowableBefore,
          months: monthsBetween(e.dateMs, next.dateMs),
          nextStage: next.stage,
          nextLeadId: next.leadId,
          nextMemberIds: next.memberIds,
          stepUp: e.amountUsd && next.amountUsd ? next.amountUsd / e.amountUsd : undefined,
        });
      } else {
        const stalled = closed || (!acquired && monthsBetween(lastMs, asOfMs) >= STALL_MONTHS);
        transitions.push({ ...base, outcome: stalled ? "stalled" : "censored", knowable: stalled });
      }
    });
  }

  // ---- transition stats with backoff ----
  const byStage: Partial<Record<Stage, TransitionStats>> = {};
  const bySectorStage: Record<string, TransitionStats> = {};
  for (const t of transitions) {
    addToStats((byStage[t.stage] ??= emptyStats()), t);
    addToStats((bySectorStage[`${t.sector}|${t.stage}`] ??= emptyStats()), t);
  }
  for (const s of Object.values(byStage)) {
    s.pRaise = (s.raised + 1) / (s.n + 2);
    s.months.sort((a, b) => a - b);
  }
  for (const [key, s] of Object.entries(bySectorStage)) {
    const stage = key.split("|")[1] as Stage;
    const prior = byStage[stage]?.pRaise ?? 0.5;
    s.pRaise = (s.raised + SECTOR_SHRINK_K * prior) / (s.n + SECTOR_SHRINK_K);
    s.months.sort((a, b) => a - b);
  }

  // ---- outcome population ----
  // Only companies sampled without regard to outcome ("seed-sample") may set raise rates, stall
  // rates, timing and raise lift. Every other company (Cala network, London portfolios,
  // must-includes) was picked partly because it did well, so it informs investor behaviour and
  // precedents only. A cohort without a seed sample falls back to all companies, and the
  // calibration then treats it as selection-biased (calibration.ts).
  const seedSample = new Set(Object.values(cohort.companies).filter((c) => c.sampledBy === "seed-sample").map((c) => c.id));
  const population: OutcomePopulation = seedSample.size ? "seed-sample" : "full-cohort";
  const inPop = (cid: string) => population === "full-cohort" || seedSample.has(cid);

  const popMonths: Partial<Record<Stage, number[]>> = {};
  const popSectorMonths: Record<string, number[]> = {};
  for (const t of transitions) {
    if (!inPop(t.companyId) || t.outcome !== "raised" || t.months === undefined) continue;
    (popMonths[t.stage] ??= []).push(t.months);
    (popSectorMonths[`${t.sector}|${t.stage}`] ??= []).push(t.months);
  }
  const gapsByStage: Partial<Record<Stage, number[]>> = {};
  for (const s of ROUND_STAGES) {
    const own = popMonths[s] ?? [];
    gapsByStage[s] = [...(own.length >= MIN_POP_GAPS ? own : (byStage[s]?.months ?? own))].sort((a, b) => a - b);
  }
  const gapsBySectorStage: Record<string, number[]> = {};
  for (const [k, xs] of Object.entries(popSectorMonths)) gapsBySectorStage[k] = xs.sort((a, b) => a - b);

  // ---- calibrated base rates (knowable transitions of the outcome population only) ----
  const knowableByStage: Partial<Record<Stage, { n: number; raised: number }>> = {};
  const knowableBySectorStage: Record<string, { n: number; raised: number }> = {};
  for (const t of transitions) {
    if (!t.knowable || !inPop(t.companyId)) continue;
    const got = t.outcome === "raised" ? 1 : 0;
    const a = (knowableByStage[t.stage] ??= { n: 0, raised: 0 });
    a.n++;
    a.raised += got;
    const b = (knowableBySectorStage[`${t.sector}|${t.stage}`] ??= { n: 0, raised: 0 });
    b.n++;
    b.raised += got;
  }
  const priors = opts.priors === undefined ? STAGE_PRIORS : opts.priors;
  const baseRates: Partial<Record<Stage, BaseRate>> = {};
  for (const s of ROUND_STAGES) baseRates[s] = calibrateStage(s, knowableByStage[s]?.raised ?? 0, knowableByStage[s]?.n ?? 0, priors, population);

  // ---- P(raise next | stage, round-size tercile), as a factor on the stage rate ----
  // Knowable outcome-population transitions with a known amount. factor = shrunk tercile rate over
  // the stage rate of the same sized transitions: (raised_t + K r_s) / (n_t + K) / r_s, K = 10, so a
  // thin tercile backs off to 1 and the calibrated stage rate (with its prior) stays the anchor.
  const sizeRates: SizeRates = {};
  for (const s of ROUND_STAGES) {
    const tiers = [0, 1, 2].map(() => ({ n: 0, raised: 0 }));
    for (const t of transitions) {
      if (t.stage !== s || !t.knowable || !inPop(t.companyId)) continue;
      const k = sizeTercile(s, t.amountUsd, episodeBands);
      if (k === undefined) continue;
      tiers[k].n++;
      if (t.outcome === "raised") tiers[k].raised++;
    }
    const n = tiers.reduce((a, x) => a + x.n, 0);
    const raised = tiers.reduce((a, x) => a + x.raised, 0);
    const band = episodeBands[s];
    if (!n || !band) continue;
    const rs = (raised + 1) / (n + 2);
    const p = baseRates[s]?.p ?? rs;
    const edges: [number, number][] = [[0, band.p33], [band.p33, band.p67], [band.p67, Infinity]];
    sizeRates[s] = {
      n,
      raised,
      tiers: tiers.map((x, k) => {
        const factor = (x.raised + SIZE_SHRINK_K * rs) / (x.n + SIZE_SHRINK_K) / rs;
        return { tercile: k as 0 | 1 | 2, loUsd: edges[k][0], hiUsd: edges[k][1], n: x.n, raised: x.raised, factor, p: Math.min(0.97, p * factor) };
      }),
    };
  }
  const sizeFactor = (stage: Stage, amountUsd: number | undefined) => {
    const k = sizeTercile(stage, amountUsd, episodeBands);
    return k === undefined ? 1 : (sizeRates[stage]?.tiers[k].factor ?? 1);
  };
  // Expected raise rate of a knowable outcome-population transition, before the lead: the knowable
  // sector/stage rate (shrunk to the stage, as in simulate.ts baseRaise) x the size factor.
  const expectedRaise = (sector: Sector, stage: Stage, amountUsd: number | undefined) => {
    const ks = knowableByStage[stage];
    const stageRate = ks ? (ks.raised + 1) / (ks.n + 2) : 0.5;
    const kss = knowableBySectorStage[`${sector}|${stage}`];
    const rate = kss ? (kss.raised + SECTOR_SHRINK_K * stageRate) / (kss.n + SECTOR_SHRINK_K) : stageRate;
    return Math.min(0.97, rate * sizeFactor(stage, amountUsd));
  };

  const reLead = reLeadRates(
    transitions
      .filter((t) => t.outcome === "raised" && t.leadId && t.nextLeadId)
      .map((t) => ({ from: t.stage, same: t.leadId === t.nextLeadId })),
  );

  // ---- agents ----
  type Acc = {
    rounds: number;
    led: number;
    stage: Partial<Record<Stage, number>>;
    leadStage: Partial<Record<Stage, number>>;
    sector: Partial<Record<Sector, number>>;
    amounts: number[];
    dates: number[];
    co: Record<string, number>;
  };
  const acc: Record<string, Acc> = {};
  const geoAcc: Record<string, GeoCounts> = {};
  const geoBase = emptyGeoCounts();
  const stageAmounts: Partial<Record<Stage, number[]>> = {};
  const bPlusAmounts: number[][] = Array.from({ length: B_PLUS_ORDINALS }, () => []);
  const stageCoInvestorCounts: Partial<Record<Stage, number[]>> = {};
  for (const [cid, eps] of Object.entries(episodes)) {
    const sector = cohort.companies[cid].sector;
    const geo = parseGeo(cohort.companies[cid].country ?? cohort.companies[cid].hq);
    let bPlusK = 0;
    for (const e of eps) {
      if (e.stage === "series-b-plus" && e.amountUsd) bPlusAmounts[Math.min(B_PLUS_ORDINALS - 1, bPlusK)].push(e.amountUsd);
      if (e.stage === "series-b-plus") bPlusK++;
      for (const rid of e.roundIds) {
        const r = cleanRound(cohort.rounds[rid], drop);
        const ms = toMs(r.date)!;
        const lead = leadOf(r)?.investorId;
        if (r.amountUsd) (stageAmounts[e.stage] ??= []).push(r.amountUsd);
        (stageCoInvestorCounts[e.stage] ??= []).push(Math.max(0, r.participants.length - 1));
        addGeo(geoBase, geo);
        const ids = [...new Set(r.participants.map((p) => p.investorId))];
        for (const id of ids) {
          addGeo((geoAcc[id] ??= emptyGeoCounts()), geo, id === lead ? LEAD_WEIGHT : 1);
          const a = (acc[id] ??= { rounds: 0, led: 0, stage: {}, leadStage: {}, sector: {}, amounts: [], dates: [], co: {} });
          const isLead = id === lead;
          const w = isLead ? LEAD_WEIGHT : 1;
          a.rounds++;
          if (isLead) {
            a.led++;
            a.leadStage[e.stage] = (a.leadStage[e.stage] ?? 0) + 1;
          }
          a.stage[e.stage] = (a.stage[e.stage] ?? 0) + w;
          a.sector[sector] = (a.sector[sector] ?? 0) + w;
          if (r.amountUsd) a.amounts.push(r.amountUsd);
          a.dates.push(ms);
          for (const o of ids) if (o !== id) a.co[o] = (a.co[o] ?? 0) + 1;
        }
      }
    }
  }
  for (const xs of Object.values(stageAmounts)) xs.sort((a, b) => a - b);
  for (const xs of bPlusAmounts) xs.sort((a, b) => a - b);

  const stageHeadcounts: Partial<Record<Stage, number[]>> = {};
  for (const [cid, eps] of Object.entries(episodes)) {
    for (const h of cohort.companies[cid].headcount ?? []) {
      const ms = toMs(h.date);
      if (ms === undefined || ms >= asOfMs) continue;
      const ep = [...eps].reverse().find((e) => e.dateMs <= ms);
      if (ep) (stageHeadcounts[ep.stage] ??= []).push(h.value);
    }
  }
  for (const xs of Object.values(stageHeadcounts)) xs.sort((a, b) => a - b);

  // ---- follow-on stats, raise lift, ties ----
  const fo: Record<string, { obs: number; within: number; months: number[]; steps: number[]; next: Record<string, number>; raised: number; reUp: number }> = {};
  const liftAcc: Record<string, { raised: number; expected: number }> = {};
  const kindLiftAcc: Partial<Record<InvestorKind, { raised: number; expected: number }>> = {};
  const ties: Record<string, Record<string, number>> = {};
  const tieTotals: Record<string, number> = {};
  const kindTies: Partial<Record<InvestorKind, Record<string, number>>> = {};
  const kindTieTotals: Partial<Record<InvestorKind, number>> = {};
  for (const t of transitions) {
    const windowDone = t.outcome !== "censored" || monthsBetween(episodes[t.companyId].find((e) => e.roundIds[0] === t.roundId)!.dateMs, asOfMs) >= STALL_MONTHS;
    for (const m of t.memberIds) {
      const f = (fo[m] ??= { obs: 0, within: 0, months: [], steps: [], next: {}, raised: 0, reUp: 0 });
      if (windowDone) {
        f.obs++;
        if (t.outcome === "raised" && (t.months ?? Infinity) <= 24) f.within++;
      }
      if (t.outcome === "raised") {
        f.raised++;
        if (t.months !== undefined) f.months.push(t.months);
        if (t.stepUp) f.steps.push(t.stepUp);
        if (t.nextLeadId) f.next[t.nextLeadId] = (f.next[t.nextLeadId] ?? 0) + 1;
        if (t.nextMemberIds?.includes(m)) f.reUp++;
      }
    }
    // Lead quality: knowable outcome-population transitions only, against the same population's
    // sector/stage/size expectation, so an average lead has lift 1 and the size factor is not
    // counted twice (big rounds attract top leads). Expecting the all-company rate here deflated
    // every lift (~0.82 for funds) because that rate includes survivors and recent raisers.
    if (t.knowable && t.leadId && inPop(t.companyId)) {
      const exp = expectedRaise(t.sector, t.stage, t.amountUsd);
      const got = t.outcome === "raised" ? 1 : 0;
      const l = (liftAcc[t.leadId] ??= { raised: 0, expected: 0 });
      l.raised += got;
      l.expected += exp;
      const k = (kindLiftAcc[kindOf(t.leadId)] ??= { raised: 0, expected: 0 });
      k.raised += got;
      k.expected += exp;
    }
    if (t.outcome === "raised" && t.nextLeadId) {
      for (const m of t.memberIds) {
        const w = m === t.leadId ? 1 : 0.5;
        (ties[m] ??= {})[t.nextLeadId] = (ties[m][t.nextLeadId] ?? 0) + w;
        tieTotals[m] = (tieTotals[m] ?? 0) + w;
        const kd = kindOf(m);
        (kindTies[kd] ??= {})[t.nextLeadId] = (kindTies[kd]![t.nextLeadId] ?? 0) + w;
        kindTieTotals[kd] = (kindTieTotals[kd] ?? 0) + w;
      }
    }
  }
  const kindRaiseLift: Partial<Record<InvestorKind, number>> = {};
  for (const [k, v] of Object.entries(kindLiftAcc) as [InvestorKind, { raised: number; expected: number }][]) {
    kindRaiseLift[k] = (v.raised + LIFT_SHRINK_L) / (v.expected + LIFT_SHRINK_L);
  }

  const norm = <K extends string>(o: Partial<Record<K, number>>) => {
    const tot = Object.values(o).reduce<number>((x, y) => x + (y as number), 0);
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, (v as number) / (tot || 1)])) as Partial<Record<K, number>>;
  };

  const agents: Agent[] = [];
  for (const [id, a] of Object.entries(acc)) {
    const inv = cohort.investors[id];
    const kind = inv?.kind ?? "unknown";
    const f = fo[id];
    const amounts = [...a.amounts].sort((x, y) => x - y);
    const span = Math.max(12, monthsBetween(Math.min(...a.dates), Math.max(...a.dates)));
    const followOn: FollowOnStats = {
      observed: f?.obs ?? 0,
      raisedWithin24m: f?.within ?? 0,
      pNextWithin24m: f && f.obs ? f.within / f.obs : 0,
      medianMonthsToNext: f ? median(f.months) : undefined,
      medianStepUp: f ? median(f.steps) : undefined,
      nextLeads: f?.next ?? {},
      reUpRate: f && f.raised ? f.reUp / f.raised : 0,
    };
    const l = liftAcc[id];
    const kl = kindRaiseLift[kind] ?? 1;
    agents.push({
      id,
      name: inv?.name ?? id,
      kind,
      rounds: a.rounds,
      led: a.led,
      stageDist: norm(a.stage),
      leadStageCounts: a.leadStage,
      sectorDist: norm(a.sector),
      chequeBand: amounts.length ? [amounts[Math.floor((amounts.length - 1) * 0.25)], amounts[Math.ceil((amounts.length - 1) * 0.75)]] : undefined,
      chequeMedian: median(amounts),
      pacePerYear: a.rounds / (span / 12),
      coInvestors: a.co,
      followOn,
      raiseLift: l ? (l.raised + LIFT_SHRINK_L * kl) / (l.expected + LIFT_SHRINK_L) : kl,
      raiseLiftEvidence: l ? Math.round(l.expected * 10) / 10 : 0,
      leadEligible: isLeadEligible(id, a.rounds),
      geo: geoAcc[id] ?? emptyGeoCounts(),
    });
  }
  agents.sort((x, y) => y.rounds - x.rounds || x.id.localeCompare(y.id));
  const agentIndex = Object.fromEntries(agents.map((a, i) => [a.id, i]));
  // Names come from the participants when the investor table lacks an entry.
  for (const r of Object.values(cohort.rounds)) {
    for (const p of r.participants) {
      const i = agentIndex[p.investorId];
      if (i !== undefined && !cohort.investors[p.investorId]) {
        agents[i].name = p.name;
        agents[i].kind = p.kind;
      }
    }
  }

  return {
    asOf: asOfStr,
    asOfMs,
    agents,
    agentIndex,
    episodes,
    transitions,
    bySectorStage,
    byStage,
    ties,
    tieTotals,
    kindTies,
    kindTieTotals,
    kindRaiseLift,
    baseRates,
    outcomePopulation: { kind: population, companies: population === "seed-sample" ? seedSample.size : Object.keys(episodes).length },
    gapsByStage,
    gapsBySectorStage,
    knowableByStage,
    knowableBySectorStage,
    reLead,
    geoBase,
    dropped: {
      generic: [...drop.values()].filter((r) => r === "generic").length,
      nonInvestor: [...drop.values()].filter((r) => r === "non_investor").length,
    },
    stageAmounts,
    labelBands,
    episodeBands,
    sizeRates,
    bPlusAmounts,
    stageHeadcounts,
    stageCoInvestorCounts,
    cohort,
  };
}

