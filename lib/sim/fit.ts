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
import type { Sector, Stage } from "@/lib/taxonomy";
import type {
  Agent,
  Cohort,
  Episode,
  FollowOnStats,
  InvestorKind,
  SimModel,
  Transition,
  TransitionStats,
} from "./types";
import { STALL_MONTHS, leadOf, median, monthsBetween, roundStageIndex, stageFromLabel, toMs } from "./util";

export const SECTOR_SHRINK_K = 5;
export const LIFT_SHRINK_L = 3;
const LEAD_WEIGHT = 1.5;

export function buildEpisodes(cohort: Cohort, asOfMs: number): Record<string, Episode[]> {
  const out: Record<string, Episode[]> = {};
  for (const co of Object.values(cohort.companies)) {
    const rs = co.roundIds
      .map((id) => cohort.rounds[id])
      .filter((r) => r)
      .map((r) => ({ r, ms: toMs(r.date), stage: r.stage !== "unknown" ? r.stage : stageFromLabel(r.label) }))
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

export function fitModel(cohort: Cohort, asOf?: string): SimModel {
  const asOfStr = asOf ?? cohort.asOf;
  const asOfMs = toMs(asOfStr) ?? Date.now();
  const trustStatus = asOfMs >= (toMs(cohort.asOf) ?? 0);
  const episodes = buildEpisodes(cohort, asOfMs);
  const kindOf = (id: string): InvestorKind => cohort.investors[id]?.kind ?? "unknown";

  // ---- transitions ----
  const transitions: Transition[] = [];
  for (const [cid, eps] of Object.entries(episodes)) {
    const co = cohort.companies[cid];
    const lastMs = eps[eps.length - 1].lastDateMs;
    const closed = trustStatus && co.status === "closed";
    const acquired = trustStatus && co.status === "acquired";
    eps.forEach((e, k) => {
      const next = eps[k + 1];
      const base = { companyId: cid, sector: co.sector, stage: e.stage, roundId: e.roundIds[0], leadId: e.leadId, memberIds: e.memberIds };
      if (next) {
        transitions.push({
          ...base,
          outcome: "raised",
          months: monthsBetween(e.dateMs, next.dateMs),
          nextStage: next.stage,
          nextLeadId: next.leadId,
          nextMemberIds: next.memberIds,
          stepUp: e.amountUsd && next.amountUsd ? next.amountUsd / e.amountUsd : undefined,
        });
      } else {
        const stalled = closed || (!acquired && monthsBetween(lastMs, asOfMs) >= STALL_MONTHS);
        transitions.push({ ...base, outcome: stalled ? "stalled" : "censored" });
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
  const baseP = (sector: Sector, stage: Stage) => bySectorStage[`${sector}|${stage}`]?.pRaise ?? byStage[stage]?.pRaise ?? 0.5;

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
  const stageAmounts: Partial<Record<Stage, number[]>> = {};
  const stageCoInvestorCounts: Partial<Record<Stage, number[]>> = {};
  for (const [cid, eps] of Object.entries(episodes)) {
    const sector = cohort.companies[cid].sector;
    for (const e of eps) {
      for (const rid of e.roundIds) {
        const r = cohort.rounds[rid];
        const ms = toMs(r.date)!;
        const lead = leadOf(r)?.investorId;
        if (r.amountUsd) (stageAmounts[e.stage] ??= []).push(r.amountUsd);
        (stageCoInvestorCounts[e.stage] ??= []).push(Math.max(0, r.participants.length - 1));
        const ids = [...new Set(r.participants.map((p) => p.investorId))];
        for (const id of ids) {
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
    if (t.outcome !== "censored" && t.leadId) {
      const exp = baseP(t.sector, t.stage);
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
    stageAmounts,
    stageHeadcounts,
    stageCoInvestorCounts,
    cohort,
  };
}

