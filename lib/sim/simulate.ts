// Monte Carlo over the fitted investor agents. Every probability below is read off the cohort
// (fit.ts); nothing is a forecast. See fit.ts for the smoothing/backoff of raise rates.
//
// One run walks the company forward round by round:
//   1. Founders (no cohort company): the round being raised now (start.stage; pre-idea raises
//      pre-seed) is assumed to close, at month 0 ("now") or 6 ("later_6m"). The cohort only holds
//      companies that raised, so there is no honest rate for closing a first round; paths are
//      conditional on closing it. Cohort companies start from their last real round instead.
//   2. Raise vs stall: P = base(stage) x sectorRatio x the current lead's raise lift, where
//      base(stage) is the calibrated rate (calibration.ts: the knowable cohort rate, replaced by a
//      published prior when the cohort is survivorship-biased) and
//        sectorRatio = clamp(P_knowable(sector, stage) / P_knowable(stage), 0.5, 1.5)
//      with the sector rate shrunk toward the stage (K = 5). For a cohort company already E months
//      past its last round, P is conditioned on not having raised yet:
//      P' = P*S(E) / (1 - P + P*S(E)), S(E) = share of historical gaps longer than E.
//   3. Timing: a gap drawn from the real gaps for (sector, stage), backing off to the stage when
//      the sector has fewer than 5, and to 18 months only when the stage has none at all.
//   4. Lead: P(j | current cap table) with backoff investor -> investor kind -> global, where
//        P(j | m)    = (ties[m][j] + A * P(j | kind m)) / (ties[m] + A),  A = 3
//        P(j | kind) = (kindTies[k][j] + A * Pg(j)) / (kindTies[k] + A)
//        Pg(j)      ~ (leads at stage + 0.25 * participations at stage + 0.1) x sectorFit x geoFit x chequeFit
//      mixed over cap-table members (lead weight 1, others 0.5), then x sectorFit x geoFit again so a
//      tie does not pull a fund far outside its sectors or region. Candidates are lead-eligible
//      investors only (quality.ts). geoFit (geo.ts) is 1 when the founder's geography is unknown.
//      Re-lead: the current lead's share is then set to the cohort's measured re-lead rate for
//      that stage transition (about 11-13%), so one fund does not lead seed, A and B by default.
//   5. Co-investors: each current member re-ups with its real re-up rate, then the lead's real
//      co-investors fill up to a count drawn from the stage's real participant counts (max 3).
//   6. Amounts: drawn from the stage's real round sizes (5th-95th percentile); Series B+ rounds by
//      ordinal (a company's 1st, 2nd, 3rd, 4th+ B+ round), since later rounds are much larger.
//   7. Stop at the vision (see vision.ts), a stall, or the horizon.
import { STAGE_LABELS, type Sector, type Stage } from "@/lib/taxonomy";
import { wilson } from "./calibration";
import { SECTOR_SHRINK_K } from "./fit";
import { investorGeoWeight, parseGeo } from "./geo";
import type {
  Agent,
  Calibration,
  Decision,
  DecisionNode,
  FirstChequeOption,
  InvestorKind,
  PathStep,
  Reality,
  SimModel,
  SimPath,
  SimResult,
  StartState,
  TimingOption,
  Vision,
  VisionBasis,
} from "./types";
import { buildPrecedents, buildRealities } from "./precedents";
import { companyFacts, targetStageIdx, visionBasis } from "./vision";
import { LOW_CONFIDENCE_N, ROUND_STAGES, STALL_MONTHS, fmtMonths, monthsBetween, mulberry32, quantile, roundStageIndex, stageFromLabel, toMs } from "./util";

export const TIE_BACKOFF_A = 3;
const MIN_SECTOR_GAPS = 5;
const DEFAULT_GAP_MONTHS = 18;
const MAX_COINVESTORS = 3;
const MAX_B_PLUS_ROUNDS = 4;
const LEAD_BRANCHES = 4;
const MIN_ORDINAL_AMOUNTS = 5;
const SECTOR_RATIO_RANGE: [number, number] = [0.5, 1.5];

export type RunOutcome = {
  branch: number;
  reached: boolean;
  stalledAt?: Stage;
  finalStage?: Stage;
  months: number;
  firstGap?: number;
  steps: PathStep[];
  sector: Sector | null;
};

type Branch = { l1: Decision | null; l2: TimingOption; forcedLeadIdx?: number; kindFilter?: InvestorKind[] };

const KIND_FOR_OPTION: Record<FirstChequeOption, InvestorKind[]> = {
  angel: ["angel"],
  accelerator: ["accelerator"],
  fund: ["fund", "cvc"],
};

type Cdf = { idx: Int32Array; cdf: Float64Array };

function stageCounts(a: Agent, s: Stage) {
  return { led: a.leadStageCounts[s] ?? 0, part: (a.stageDist[s] ?? 0) * a.rounds };
}

export type Prepared = ReturnType<typeof prepare>;

export function prepare(start: StartState, vision: Vision, model: SimModel) {
  const sectorsIn = Object.entries(start.sectors ?? {}).filter(([, w]) => (w ?? 0) > 0) as [Sector, number][];
  const co = start.companyId ? model.cohort.companies[start.companyId] : undefined;
  if (!sectorsIn.length && co) sectorsIn.push([co.sector, 1]);
  if (!sectorsIn.length && vision.sector) sectorsIn.push([vision.sector, 1]);
  const sectorTotal = sectorsIn.reduce((a, [, w]) => a + w, 0);
  const sectors = sectorsIn.map(([s, w]) => [s, w / sectorTotal] as [Sector, number]);
  const basis = visionBasis(vision, model);
  const targetIdx = targetStageIdx(basis);

  const eps = co ? (model.episodes[co.id] ?? []) : [];
  const last = eps[eps.length - 1];
  let lastStageIdx = -1;
  let elapsed = 0;
  let members: string[] = [];
  let lastLead: string | undefined;
  let fundedUsd = 0;
  if (co) {
    if (last) {
      lastStageIdx = roundStageIndex(last.stage);
      elapsed = Math.max(0, monthsBetween(last.lastDateMs, model.asOfMs));
      members = last.memberIds;
      lastLead = last.leadId;
    } else if (model.asOfMs >= (toMs(model.cohort.asOf) ?? 0)) {
      // No dated rounds: Cala's present-day funding_stage, trusted only outside backtests.
      const s = stageFromLabel(co.fundingStage);
      lastStageIdx = s ? roundStageIndex(s) : -1;
    }
    fundedUsd = companyFacts(model, co.id).totalUsd;
  }
  const allExisting = [...new Set([...eps.flatMap((e) => e.memberIds), ...(start.existingInvestorIds ?? [])])];
  if (!co) members = (start.existingInvestorIds ?? []).filter((id) => model.agentIndex[id] !== undefined);

  const firstStage: Stage = co
    ? ROUND_STAGES[Math.min(ROUND_STAGES.length - 1, lastStageIdx + 1)]
    : start.stage === "pre-idea"
      ? "pre-seed"
      : start.stage;
  const alreadyThere = co ? lastStageIdx >= targetIdx && fundedUsd >= (basis.fundingThresholdUsd ?? 0) : false;
  const geoInput = start.geography?.trim() || co?.country || co?.hq;
  const geo = parseGeo(geoInput);
  const bPlusSoFar = eps.filter((e) => e.stage === "series-b-plus").length;
  const like = { tags: start.tags ?? co?.tags, text: start.description ?? co?.description };
  return { sectors, basis, targetIdx, company: co, lastStageIdx, elapsed, members, lastLead, fundedUsd, firstStage, allExisting, alreadyThere, geo, geoInput, bPlusSoFar, like };
}

export class Engine {
  private cdfCache = new Map<string, Cdf>();
  private pg = new Map<string, { cand: Int32Array; pg: Float64Array; fit: Float64Array }>();
  private memberCache = new Map<string, Float64Array>();
  private baseCache = new Map<string, number>();
  constructor(
    readonly model: SimModel,
    readonly prep: Prepared,
    readonly raiseUsd?: number,
  ) {}

  // Calibrated base rate x the knowable sector/stage ratio (see header, step 2), before lift.
  baseRaise(sector: Sector | null, stage: Stage): number {
    const key = `${sector}|${stage}`;
    const hit = this.baseCache.get(key);
    if (hit !== undefined) return hit;
    const m = this.model;
    let p = m.baseRates[stage]?.p ?? 0.5;
    const ks = m.knowableByStage[stage];
    const kss = sector ? m.knowableBySectorStage[`${sector}|${stage}`] : undefined;
    if (ks && kss) {
      const stageRate = (ks.raised + 1) / (ks.n + 2);
      const sectorRate = (kss.raised + SECTOR_SHRINK_K * stageRate) / (kss.n + SECTOR_SHRINK_K);
      p *= Math.min(SECTOR_RATIO_RANGE[1], Math.max(SECTOR_RATIO_RANGE[0], sectorRate / stageRate));
    }
    this.baseCache.set(key, p);
    return p;
  }

  pRaise(sector: Sector | null, stage: Stage, leadId: string | undefined, elapsed = 0): number {
    let p = this.baseRaise(sector, stage);
    const ai = leadId !== undefined ? this.model.agentIndex[leadId] : undefined;
    if (ai !== undefined) p *= this.model.agents[ai].raiseLift;
    p = Math.min(0.97, Math.max(0.02, p));
    if (elapsed > 0) {
      const gaps = this.gaps(sector, stage);
      const longer = gaps.length ? gaps.filter((g) => g > elapsed).length / gaps.length : 0;
      p = (p * longer) / (1 - p + p * longer || 1);
      if (elapsed >= STALL_MONTHS && longer === 0) p = 0;
    }
    return p;
  }

  gaps(sector: Sector | null, stage: Stage): number[] {
    const ss = sector ? this.model.gapsBySectorStage[`${sector}|${stage}`] : undefined;
    if (ss && ss.length >= MIN_SECTOR_GAPS) return ss;
    return this.model.gapsByStage[stage] ?? [];
  }

  sampleGap(sector: Sector | null, stage: Stage, rnd: () => number, elapsed = 0): number {
    const g = this.gaps(sector, stage);
    const pool = elapsed > 0 ? g.filter((x) => x > elapsed) : g;
    if (!pool.length) return DEFAULT_GAP_MONTHS;
    return Math.max(1, pool[Math.floor(rnd() * pool.length)] - elapsed);
  }

  sectorFit(a: Agent, sector: Sector | null): number {
    return 0.15 + (sector ? (a.sectorDist[sector] ?? 0) : 0.5);
  }

  chequeFit(a: Agent): number {
    if (!this.raiseUsd || !a.chequeBand) return 1;
    const [lo, hi] = a.chequeBand;
    if (this.raiseUsd >= lo && this.raiseUsd <= hi) return 1;
    const ratio = this.raiseUsd < lo ? lo / this.raiseUsd : this.raiseUsd / hi;
    return Math.max(0.2, 1 - (ratio - 1) / 2);
  }

  geoFit(a: Agent): number {
    return investorGeoWeight(a.geo, this.model.geoBase, this.prep.geo);
  }

  // Lead candidates at a stage: lead-eligible investors that led at least one real round there
  // (falling back to any eligible participant when nobody led), with their global prior Pg
  // normalised over that set. fit = sectorFit x geoFit per candidate, reused by leadWeights.
  // Restricting to leaders keeps every lead pick O(leaders), not O(all investors).
  globalPrior(stage: Stage, sector: Sector | null): { cand: Int32Array; pg: Float64Array; fit: Float64Array } {
    const key = `${stage}|${sector}`;
    const hit = this.pg.get(key);
    if (hit) return hit;
    const ags = this.model.agents;
    let cand: number[] = [];
    for (let j = 0; j < ags.length; j++) if (ags[j].leadEligible && (ags[j].leadStageCounts[stage] ?? 0) > 0) cand.push(j);
    if (!cand.length) cand = ags.map((_, j) => j).filter((j) => ags[j].leadEligible && (ags[j].stageDist[stage] ?? 0) > 0);
    const pg = new Float64Array(cand.length);
    const fit = new Float64Array(cand.length);
    let tot = 0;
    cand.forEach((j, k) => {
      const { led, part } = stageCounts(ags[j], stage);
      fit[k] = this.sectorFit(ags[j], sector) * this.geoFit(ags[j]);
      pg[k] = (led + 0.25 * part + 0.1) * fit[k] * (roundStageIndex(stage) <= 1 ? this.chequeFit(ags[j]) : 1);
      tot += pg[k];
    });
    if (tot > 0) for (let k = 0; k < pg.length; k++) pg[k] /= tot;
    const out = { cand: Int32Array.from(cand), pg, fit };
    this.pg.set(key, out);
    return out;
  }

  reLeadRate(fromStage: Stage): number {
    return this.model.reLead.byStage[fromStage]?.rate ?? this.model.reLead.overall.rate;
  }

  // P(j | member m) over the stage's candidates, with the investor -> kind -> global backoff.
  memberVector(stage: Stage, sector: Sector | null, mem: string): Float64Array {
    const key = `${stage}|${sector}|${mem}`;
    const hit = this.memberCache.get(key);
    if (hit) return hit;
    const m = this.model;
    const { cand, pg } = this.globalPrior(stage, sector);
    const kind = m.agents[m.agentIndex[mem]]?.kind ?? m.cohort.investors[mem]?.kind ?? "unknown";
    const kt = m.kindTies[kind] ?? {};
    const ktot = m.kindTieTotals[kind] ?? 0;
    const t = m.ties[mem] ?? {};
    const ttot = m.tieTotals[mem] ?? 0;
    const v = new Float64Array(cand.length);
    for (let k = 0; k < cand.length; k++) {
      const id = m.agents[cand[k]].id;
      const pk = ((kt[id] ?? 0) + TIE_BACKOFF_A * pg[k]) / (ktot + TIE_BACKOFF_A);
      v[k] = ((t[id] ?? 0) + TIE_BACKOFF_A * pk) / (ttot + TIE_BACKOFF_A);
    }
    this.memberCache.set(key, v);
    return v;
  }

  // fromStage: the stage of the round the current lead led; sets the re-lead rate (header, step 4).
  leadWeights(stage: Stage, sector: Sector | null, members: string[], leadId: string | undefined, kinds?: InvestorKind[], fromStage?: Stage): Cdf {
    const key = `${stage}|${sector}|${leadId ?? ""}|${members.join(",")}|${kinds?.join(",") ?? ""}|${fromStage ?? ""}`;
    const hit = this.cdfCache.get(key);
    if (hit) return hit;
    const m = this.model;
    const { cand, pg, fit } = this.globalPrior(stage, sector);
    const n = cand.length;
    const w = new Float64Array(n);
    const known = members.filter((x) => m.agentIndex[x] !== undefined || m.tieTotals[x] !== undefined);
    if (!known.length) {
      w.set(pg);
    } else {
      let wsum = 0;
      for (const mem of known) {
        const mw = mem === leadId ? 1 : 0.5;
        wsum += mw;
        const v = this.memberVector(stage, sector, mem);
        for (let k = 0; k < n; k++) w[k] += mw * v[k];
      }
      for (let k = 0; k < n; k++) w[k] = (w[k] / wsum) * fit[k];
    }
    const self = leadId !== undefined && fromStage ? cand.indexOf(m.agentIndex[leadId] ?? -1) : -1;
    if (self >= 0) {
      let others = 0;
      for (let k = 0; k < n; k++) if (k !== self) others += w[k];
      const r = this.reLeadRate(fromStage!);
      if (others > 0) w[self] = (r / (1 - r)) * others;
    }
    const idx: number[] = [];
    const cum: number[] = [];
    let acc = 0;
    for (let k = 0; k < n; k++) {
      if (w[k] <= 0) continue;
      if (kinds && !kinds.includes(m.agents[cand[k]].kind)) continue;
      acc += w[k];
      idx.push(cand[k]);
      cum.push(acc);
    }
    const out = { idx: Int32Array.from(idx), cdf: Float64Array.from(cum.map((c) => c / (acc || 1))) };
    this.cdfCache.set(key, out);
    return out;
  }

  sampleFrom(c: Cdf, rnd: () => number): number | undefined {
    if (!c.idx.length) return undefined;
    const r = rnd();
    let lo = 0;
    let hi = c.cdf.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (c.cdf[mid] < r) lo = mid + 1;
      else hi = mid;
    }
    return c.idx[lo];
  }

  coInvestors(stage: Stage, leadIdx: number | undefined, prevMembers: string[], rnd: () => number): string[] {
    const m = this.model;
    const out = new Set<string>();
    const leadId = leadIdx !== undefined ? m.agents[leadIdx].id : undefined;
    for (const p of prevMembers) {
      const ai = m.agentIndex[p];
      if (ai === undefined || p === leadId) continue;
      if (rnd() < m.agents[ai].followOn.reUpRate) out.add(p);
    }
    const counts = m.stageCoInvestorCounts[stage] ?? [];
    const target = Math.min(MAX_COINVESTORS, counts.length ? counts[Math.floor(rnd() * counts.length)] : 1);
    if (leadIdx !== undefined && out.size < target) {
      const co = Object.entries(m.agents[leadIdx].coInvestors).filter(([id]) => !out.has(id) && id !== leadId);
      let tot = co.reduce((a, [, c]) => a + c, 0);
      while (out.size < target && co.length && tot > 0) {
        let r = rnd() * tot;
        let k = 0;
        for (; k < co.length - 1; k++) {
          r -= co[k][1];
          if (r <= 0) break;
        }
        out.add(co[k][0]);
        tot -= co[k][1];
        co.splice(k, 1);
      }
    }
    return [...out].slice(0, MAX_COINVESTORS);
  }

  // bPlusOrdinal: how many Series B+ rounds the company has already closed (0 = this is its first).
  amount(stage: Stage, rnd: () => number, bPlusOrdinal = 0): number | undefined {
    const byOrdinal = stage === "series-b-plus" ? this.model.bPlusAmounts[Math.min(this.model.bPlusAmounts.length - 1, bPlusOrdinal)] : undefined;
    const xs = byOrdinal && byOrdinal.length >= MIN_ORDINAL_AMOUNTS ? byOrdinal : this.model.stageAmounts[stage];
    if (!xs?.length) return undefined;
    return Math.round(quantile(xs, 0.05 + 0.9 * rnd())! / 1e4) * 1e4;
  }

  sampleSector(rnd: () => number): Sector | null {
    const s = this.prep.sectors;
    if (!s.length) return null;
    let r = rnd();
    for (const [sec, w] of s) {
      r -= w;
      if (r <= 0) return sec;
    }
    return s[s.length - 1][0];
  }

  step(stage: Stage, leadIdx: number | undefined, co: string[], month: number, amountUsd: number | undefined): PathStep {
    const a = leadIdx !== undefined ? this.model.agents[leadIdx] : undefined;
    return { stage, leadId: a?.id, leadName: a?.name, coInvestorIds: co, monthFromStart: Math.round(month * 10) / 10, amountUsd };
  }

  run(branch: Branch, branchIdx: number, horizonMonths: number, rnd: () => number): RunOutcome {
    const p = this.prep;
    const sector = this.sampleSector(rnd);
    const threshold = p.basis.fundingThresholdUsd ?? 0;
    const steps: PathStep[] = [];
    let month = branch.l2 === "later_6m" ? 6 : 0;
    let funded = p.fundedUsd;
    let members = p.members;
    let leadId = p.lastLead;
    let stageIdx = p.lastStageIdx;
    let firstGap: number | undefined;
    let bPlusRounds = 0;
    const reached = () => stageIdx >= p.targetIdx && funded >= threshold;
    const out = (o: Partial<RunOutcome>): RunOutcome => ({
      branch: branchIdx,
      reached: false,
      months: steps.length ? steps[steps.length - 1].monthFromStart : 0,
      firstGap,
      steps,
      sector,
      finalStage: stageIdx >= 0 ? ROUND_STAGES[stageIdx] : undefined,
      ...o,
    });
    if (p.alreadyThere) return out({ reached: true });

    let firstRound = true;
    if (!p.company) {
      const stage = p.firstStage;
      const c = this.leadWeights(stage, sector, members, leadId, branch.kindFilter);
      const li = branch.forcedLeadIdx ?? this.sampleFrom(c, rnd);
      const co = this.coInvestors(stage, li, members, rnd);
      const amt = this.amount(stage, rnd, p.bPlusSoFar);
      funded += amt ?? 0;
      steps.push(this.step(stage, li, co, month, amt));
      stageIdx = roundStageIndex(stage);
      leadId = li !== undefined ? this.model.agents[li].id : undefined;
      members = leadId ? [leadId, ...co] : co;
      if (stage === "series-b-plus") bPlusRounds++;
      firstRound = false;
    }
    let elapsed = p.company ? p.elapsed : 0;
    while (!reached()) {
      const cur = ROUND_STAGES[stageIdx];
      if (stageIdx < 0) {
        // Cohort company with no usable rounds: treat as raising pre-seed now.
        stageIdx = -1;
      } else if (cur === "series-b-plus" && bPlusRounds >= MAX_B_PLUS_ROUNDS) {
        return out({});
      } else if (rnd() >= this.pRaise(sector, cur, leadId, elapsed)) {
        // A Series B+ company without another round has not failed; it just raises no more.
        return out(cur === "series-b-plus" ? {} : { stalledAt: cur });
      }
      const gap = stageIdx < 0 ? 0 : this.sampleGap(sector, cur, rnd, elapsed);
      elapsed = 0;
      if (month + gap > horizonMonths) return out({});
      month += gap;
      if (firstGap === undefined && (p.company || steps.length === 1)) firstGap = p.company ? month - (branch.l2 === "later_6m" ? 6 : 0) : gap;
      const nextIdx = Math.min(ROUND_STAGES.length - 1, stageIdx + 1);
      const next = ROUND_STAGES[nextIdx];
      const kinds = firstRound ? branch.kindFilter : undefined;
      const forced = firstRound ? branch.forcedLeadIdx : undefined;
      const li = forced ?? this.sampleFrom(this.leadWeights(next, sector, members, leadId, kinds, stageIdx >= 0 ? cur : undefined), rnd);
      const co = this.coInvestors(next, li, members, rnd);
      const amt = this.amount(next, rnd, p.bPlusSoFar + bPlusRounds);
      funded += amt ?? 0;
      steps.push(this.step(next, li, co, month, amt));
      stageIdx = nextIdx;
      if (next === "series-b-plus") bPlusRounds++;
      leadId = li !== undefined ? this.model.agents[li].id : undefined;
      members = leadId ? [leadId, ...co] : co;
      firstRound = false;
    }
    return out({ reached: true });
  }
}

// ---- aggregation ----

function score(o: RunOutcome, targetIdx: number): number {
  const idx = o.finalStage ? roundStageIndex(o.finalStage) : -1;
  return (o.reached ? 100000 : 0) + Math.min(idx, targetIdx) * 1000 + (o.stalledAt ? 0 : 300) - o.months;
}

const when = (m: number) => (m < 0.5 ? "now" : `in ${fmtMonths(m)}`);

export function describeOutcome(o: RunOutcome, basis: VisionBasis, startLabel: string): string {
  const last = o.steps[o.steps.length - 1];
  const stage = o.finalStage ? STAGE_LABELS[o.finalStage] : startLabel;
  const lead = last?.leadName ? `, lead ${last.leadName}` : "";
  if (o.reached) {
    if (!last) return `Already at ${STAGE_LABELS[basis.targetStage]}`;
    return `${STAGE_LABELS[last.stage]} ${when(o.months)}${lead}`;
  }
  if (o.stalledAt) return last ? `${STAGE_LABELS[last.stage]} ${when(o.months)}, then stalls` : `Stalls at ${stage}`;
  return last ? `${STAGE_LABELS[last.stage]} ${when(o.months)}, no round after` : `No new round within the horizon`;
}

function pathSignature(o: RunOutcome): string {
  return `${o.steps.map((s) => `${s.stage}:${s.leadId ?? "?"}`).join(">")}|${o.reached ? "R" : o.stalledAt ? `S:${o.stalledAt}` : "H"}`;
}

export function topPaths(outs: RunOutcome[], k = 5): SimPath[] {
  const groups = new Map<string, { first: RunOutcome; count: number }>();
  for (const o of outs) {
    const sig = pathSignature(o);
    const g = groups.get(sig);
    if (g) g.count++;
    else groups.set(sig, { first: o, count: 1 });
  }
  return [...groups.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, k)
    .map(({ first, count }) => ({
      steps: first.steps,
      reachedVision: first.reached,
      stalledAtStage: first.stalledAt,
      count,
      share: Math.round((count / outs.length) * 1000) / 1000,
    }));
}

function buildNode(
  decision: Decision | null,
  label: string,
  outs: RunOutcome[],
  sampleSize: number,
  children: DecisionNode[],
  basis: VisionBasis,
  targetIdx: number,
  startLabel: string,
): DecisionNode {
  const sorted = [...outs].sort((a, b) => score(b, targetIdx) - score(a, targetIdx));
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const gaps = outs.map((o) => o.firstGap).filter((g): g is number => g !== undefined).sort((a, b) => a - b);
  const med = quantile(gaps, 0.5);
  const share = outs.length ? outs.filter((o) => o.reached).length / outs.length : 0;
  const band = wilson(share * sampleSize, sampleSize);
  return {
    decision,
    label,
    runs: outs.length,
    reachVisionShare: Math.round(share * 1000) / 1000,
    medianMonthsToNextRound: med !== undefined ? Math.round(med * 10) / 10 : undefined,
    outcomeBands: sorted.length
      ? { best: describeOutcome(at(0.1), basis, startLabel), median: describeOutcome(at(0.5), basis, startLabel), worst: describeOutcome(at(0.9), basis, startLabel) }
      : { best: "n/a", median: "n/a", worst: "n/a" },
    sampleSize,
    lowConfidence: sampleSize < LOW_CONFIDENCE_N,
    confidenceBand: { lo: Math.round(band.lo * 1000) / 1000, hi: Math.round(band.hi * 1000) / 1000 },
    children,
    topPaths: topPaths(outs),
  };
}

const OPTION_LABEL: Record<FirstChequeOption, string> = { angel: "Angel first", accelerator: "Accelerator first", fund: "Fund first" };
const TIMING_LABEL: Record<TimingOption, string> = { now: "Raise now", later_6m: "Raise in 6 months" };

export function simulate(start: StartState, vision: Vision, model: SimModel, opts: { runs?: number; seed?: number; decision?: Decision } = {}): SimResult {
  const runs = Math.max(1, Math.floor(opts.runs ?? 5000));
  const rnd = mulberry32(opts.seed ?? 20261114);
  const prep = prepare(start, vision, model);
  const engine = new Engine(model, prep, start.raiseUsd);
  const horizonMonths = (vision.horizonYears || 5) * 12;
  const decision = opts.decision;
  const sectorSet = new Set(prep.sectors.map(([s]) => s));
  const inSectors = (s: Sector) => !sectorSet.size || sectorSet.has(s);
  const decisionStage = prep.company ? ROUND_STAGES[Math.max(0, prep.lastStageIdx)] : prep.firstStage;
  const stageTransitions = model.transitions.filter((t) => t.outcome !== "censored" && t.stage === decisionStage && inSectors(t.sector));
  const companies = (ts: { companyId: string }[]) => new Set(ts.map((t) => t.companyId)).size;
  const kindOf = (id: string) => model.agents[model.agentIndex[id]]?.kind ?? model.cohort.investors[id]?.kind ?? "unknown";
  // Distinct real companies with a round at `stage` led by `id`, plus those where a current cap-table
  // member's next round was led by `id` (the evidence behind a "next lead" branch).
  const leadEvidence = (id: string, stage: Stage, members: string[]) => {
    const ids = new Set<string>();
    for (const [cid, eps] of Object.entries(model.episodes)) if (eps.some((e) => e.stage === stage && e.leadId === id)) ids.add(cid);
    for (const t of model.transitions) if (t.nextLeadId === id && t.memberIds.some((mm) => members.includes(mm))) ids.add(t.companyId);
    ids.delete(prep.company?.id ?? "");
    return ids.size;
  };

  // Level 1: next-lead options for a cohort company (forced lead), cheque type for a founder.
  type L1 = { decision: Decision | null; label: string; forcedLeadIdx?: number; kindFilter?: InvestorKind[]; sampleSize: number };
  let l1: L1[];
  if (prep.company) {
    const next = prep.firstStage;
    const seedSector = prep.sectors[0]?.[0] ?? model.cohort.companies[prep.company.id]?.sector ?? null;
    const from = prep.lastStageIdx >= 0 ? ROUND_STAGES[prep.lastStageIdx] : undefined;
    const c = engine.leadWeights(next, seedSector, prep.members, prep.lastLead, undefined, from);
    const w = Array.from(c.idx).map((j, i) => ({ j, p: c.cdf[i] - (i ? c.cdf[i - 1] : 0) }));
    w.sort((a, b) => b.p - a.p);
    l1 = w.slice(0, LEAD_BRANCHES).map(({ j }) => {
      const a = model.agents[j];
      return {
        decision: { kind: "lead", investorId: a.id } as Decision,
        label: `Next lead: ${a.name}`,
        forcedLeadIdx: j,
        sampleSize: leadEvidence(a.id, next, prep.members),
      };
    });
    if (decision?.kind === "lead") {
      const j = model.agentIndex[decision.investorId];
      l1 = j === undefined ? l1 : [{ decision, label: `Next lead: ${model.agents[j].name}`, forcedLeadIdx: j, sampleSize: leadEvidence(decision.investorId, next, prep.members) }];
    }
  } else {
    const opt = (o: FirstChequeOption): L1 => ({
      decision: { kind: "first_cheque", option: o },
      label: OPTION_LABEL[o],
      kindFilter: KIND_FOR_OPTION[o],
      sampleSize: companies(stageTransitions.filter((t) => t.leadId && KIND_FOR_OPTION[o].includes(kindOf(t.leadId)))),
    });
    l1 = (["angel", "accelerator", "fund"] as FirstChequeOption[])
      .filter((o) => engine.leadWeights(prep.firstStage, null, [], undefined, KIND_FOR_OPTION[o]).idx.length > 0)
      .map(opt);
    if (decision?.kind === "first_cheque") l1 = l1.filter((x) => (x.decision as { option: string }).option === decision.option);
    if (decision?.kind === "lead") {
      const j = model.agentIndex[decision.investorId];
      if (j !== undefined) l1 = [{ decision, label: `First lead: ${model.agents[j].name}`, forcedLeadIdx: j, sampleSize: leadEvidence(decision.investorId, prep.firstStage, []) }];
    }
  }
  if (!l1.length) l1 = [{ decision: null, label: "Any first cheque", sampleSize: companies(stageTransitions) }];
  const timings: TimingOption[] = decision?.kind === "timing" ? [decision.option] : ["now", "later_6m"];

  const branches: Branch[] = [];
  for (const a of l1) for (const t of timings) branches.push({ l1: a.decision, l2: t, forcedLeadIdx: a.forcedLeadIdx, kindFilter: a.kindFilter });
  const outs: RunOutcome[] = [];
  for (let r = 0; r < runs; r++) {
    const b = r % branches.length;
    outs.push(engine.run(branches[b], b, horizonMonths, rnd));
  }

  const startLabel = STAGE_LABELS[prep.company ? ROUND_STAGES[Math.max(0, prep.lastStageIdx)] : prep.firstStage];
  const node = (d: Decision | null, label: string, o: RunOutcome[], n: number, children: DecisionNode[]) =>
    buildNode(d, label, o, n, children, prep.basis, prep.targetIdx, startLabel);
  const l1Nodes = l1.map((a, i) => {
    const kids = timings.map((t, k) => {
      const bi = i * timings.length + k;
      return node({ kind: "timing", option: t }, TIMING_LABEL[t], outs.filter((o) => o.branch === bi), a.sampleSize, []);
    });
    return node(a.decision, a.label, outs.filter((o) => Math.floor(o.branch / timings.length) === i), a.sampleSize, kids);
  });
  l1Nodes.sort((x, y) => y.reachVisionShare - x.reachVisionShare || (x.medianMonthsToNextRound ?? 1e9) - (y.medianMonthsToNextRound ?? 1e9));
  const rootLabel = prep.company ? `${prep.company.name} today` : "You today";
  const tree = node(null, rootLabel, outs, companies(stageTransitions.filter((t) => t.knowable)), l1Nodes);

  const flows = new Map<string, number>();
  for (const o of outs) {
    let from = "you";
    for (const s of o.steps) {
      if (!s.leadId) continue;
      const key = `${from}\u0000${s.leadId}`;
      flows.set(key, (flows.get(key) ?? 0) + 1);
      from = s.leadId;
    }
  }
  const highways = [...flows.entries()]
    .map(([k, c]) => {
      const [from, to] = k.split("\u0000");
      return { from, to, weight: Math.round((c / runs) * 1000) / 1000 };
    })
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 80);

  const realities: Reality[] = buildRealities(outs, prep, model, startLabel);
  const precedents = buildPrecedents(model, prep);
  const existing = prep.allExisting.map((id) => ({ id, name: model.agents[model.agentIndex[id]]?.name ?? model.cohort.investors[id]?.name ?? id }));

  return {
    asOf: model.asOf,
    runs,
    start: { stage: decisionStage, companyId: prep.company?.id, companyName: prep.company?.name, existingInvestors: existing },
    visionBasis: prep.basis,
    tree,
    realities,
    highways,
    precedents,
    calibration: buildCalibration(model, prep),
    fixture: false,
  };
}

export const SAMPLE_SIZE_MEANING =
  "sampleSize = distinct real cohort companies behind a branch: for the root, companies with a knowable outcome at this stage in these sectors; " +
  "for a cheque type, companies whose round at this stage that kind of investor led; for a next lead, companies where that investor led a round " +
  "at that stage or followed one of your current investors. Bands are 95% Wilson intervals on that n.";

function buildCalibration(model: SimModel, prep: Prepared): Calibration {
  const baseRates = ROUND_STAGES.map((s) => model.baseRates[s]).filter((b): b is NonNullable<typeof b> => !!b);
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const pop = model.outcomePopulation;
  const notes: string[] = [
    pop.kind === "seed-sample"
      ? `Raise rates, stall rates and timing come from the ${pop.companies} seed-sample companies, drawn without regard to outcome; the rest of the cohort informs investor behaviour and precedents only.`
      : `No outcome-blind seed sample in this cohort: rates are read off all ${pop.companies} companies and capped by published priors where they look survivorship-biased.`,
  ];
  for (const b of baseRates) {
    if (b.biased) {
      notes.push(
        `${STAGE_LABELS[b.stage]}: ${b.cohort.raised} of ${b.cohort.n} knowable cohort companies raised again (${pct(b.cohort.rate ?? 0)}), ` +
          `above what published funnels allow, so the prior ${pct(b.p)} is used (cohort is survivorship-biased).`,
      );
    } else if (b.source === "prior") notes.push(`${STAGE_LABELS[b.stage]}: no knowable cohort outcomes, prior ${pct(b.p)} used.`);
  }
  if (!prep.company) notes.push(`Paths assume the ${STAGE_LABELS[prep.firstStage]} being raised now closes; the cohort has no record of failed first rounds.`);
  const agents = model.agents;
  const leaders = agents.filter((a) => a.led > 0);
  return {
    outcomePopulation: pop,
    baseRates,
    conditionalOnFirstRound: !prep.company,
    reLead: ROUND_STAGES.flatMap((s) => {
      const r = model.reLead.byStage[s];
      return r ? [{ from: s, ...r }] : [];
    }),
    leadFilter: {
      candidates: leaders.filter((a) => a.leadEligible).length,
      droppedGeneric: model.dropped.generic,
      droppedNonInvestor: model.dropped.nonInvestor,
      droppedThin: leaders.filter((a) => !a.leadEligible).length,
    },
    geography: { input: prep.geoInput, country: prep.geo.country, region: prep.geo.region, applied: !!prep.geo.region },
    sampleSizeMeaning: SAMPLE_SIZE_MEANING,
    notes,
  };
}

