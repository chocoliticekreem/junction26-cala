// investorTaste: what an investor actually does, read off its own rounds in the cohort before asOf.
//   sector / stage distributions - lead-weighted (a led round counts 1.5, a participation 1),
//                                  same weight as the founder simulator's agents
//   cheque band                  - IQR of the round sizes it was on (round size, not its own cheque:
//                                  Cala rarely splits a round by investor)
//   entry stage                  - the stage of the first round it joined at each company (mode)
//   follow-on                    - share of its companies' next rounds it re-upped in, and the
//                                  share of its companies that raised again within 24 months
// When the investor is one of the 193 in data/investors.json and the cohort history is thin
// (< THIN_ROUNDS rounds), its revealed S/G vectors are blended in. Only outside backtests: those
// vectors are present-day and would leak the future into an asOf in the past.
import { SECTOR_SHORT, STAGE_LABELS, type Sector, type Stage } from "@/lib/taxonomy";
import type { Revealed } from "@/lib/types";
import type { Cohort, InvestorKind } from "./cohort";
import { MONTH_MS, ROUND_STAGES, median, spotterIndex, type SpotterIndex } from "./base";

export const LEAD_WEIGHT = 1.5;
export const THIN_ROUNDS = 8;

export type InvestorTaste = {
  investorId: string;
  name: string;
  kind: InvestorKind;
  rounds: number;
  led: number;
  leadShare: number;
  companies: number;
  sectorDist: Partial<Record<Sector, number>>;
  stageDist: Partial<Record<Stage, number>>;
  chequeBand?: [number, number];
  chequeMedian?: number;
  entryStage?: Stage;
  coInvestors: { id: string; name: string; count: number }[];
  followOn: { reUpRate: number; raisedAgainWithin24m: number; observed: number };
  portfolio: Set<string>;
  revealedBlended: boolean;
  chips: string[];
};

const norm = <K extends string>(o: Partial<Record<K, number>>): Partial<Record<K, number>> => {
  const tot = Object.values<number | undefined>(o).reduce<number>((a, b) => a + (b ?? 0), 0);
  if (!tot) return {};
  return Object.fromEntries(Object.entries<number | undefined>(o).map(([k, v]) => [k, (v ?? 0) / tot])) as Partial<Record<K, number>>;
};

function blend<K extends string>(a: Partial<Record<K, number>>, b: Partial<Record<K, number>>, wb: number) {
  const out: Partial<Record<K, number>> = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)]) as Set<K>) out[k] = (1 - wb) * (a[k] ?? 0) + wb * (b[k] ?? 0);
  return norm(out);
}

const fmtUsd = (n: number) => (n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${Math.round(n / 1e6)}M` : `$${Math.round(n / 1e3)}k`);

function top<K extends string>(d: Partial<Record<K, number>>, n: number): [K, number][] {
  return (Object.entries(d) as [K, number][]).sort((a, b) => b[1] - a[1]).slice(0, n);
}

export function investorTaste(investorId: string, cohort: Cohort, asOf?: string, opts: { revealed?: Revealed } = {}): InvestorTaste {
  return tasteFromIndex(spotterIndex(cohort, asOf), investorId, opts);
}

export function tasteFromIndex(idx: SpotterIndex, investorId: string, opts: { revealed?: Revealed } = {}): InvestorTaste {
  const meta = idx.investorNames.get(investorId) ?? { name: investorId, kind: "unknown" as InvestorKind };
  const portfolio = idx.portfolios.get(investorId) ?? new Set<string>();
  const sector: Partial<Record<Sector, number>> = {};
  const stage: Partial<Record<Stage, number>> = {};
  const entry: Partial<Record<Stage, number>> = {};
  const amounts: number[] = [];
  let rounds = 0;
  let led = 0;
  let joined = 0;
  let observed = 0;
  let raisedAgain = 0;
  for (const cid of portfolio) {
    const row = idx.rows.get(cid)!;
    let entered = false;
    row.eps.forEach((e, k) => {
      if (!e.memberIds.includes(investorId)) return;
      const isLead = e.leadId === investorId;
      const w = isLead ? LEAD_WEIGHT : 1;
      for (const rid of e.roundIds) {
        const r = idx.cohort.rounds[rid];
        if (!r.participants.some((p) => p.investorId === investorId)) continue;
        rounds++;
        if (r.amountUsd) amounts.push(r.amountUsd);
      }
      joined++;
      if (isLead) led++;
      sector[row.co.sector] = (sector[row.co.sector] ?? 0) + w;
      stage[e.stage] = (stage[e.stage] ?? 0) + w;
      if (!entered) {
        entry[e.stage] = (entry[e.stage] ?? 0) + 1;
        entered = true;
        if ((idx.asOfMs - e.dateMs) / MONTH_MS >= 24) {
          observed++;
          const next = row.eps[k + 1];
          if (next && (next.dateMs - e.dateMs) / MONTH_MS <= 24) raisedAgain++;
        }
      }
    });
  }
  let sectorDist = norm(sector);
  let stageDist = norm(stage);
  let revealedBlended = false;
  if (opts.revealed && idx.trustPresent && rounds < THIN_ROUNDS) {
    const wb = 1 - rounds / THIN_ROUNDS;
    sectorDist = blend(sectorDist, opts.revealed.S, wb);
    stageDist = blend(stageDist, opts.revealed.G, wb);
    revealedBlended = true;
  }
  amounts.sort((a, b) => a - b);
  const chequeBand: [number, number] | undefined = amounts.length
    ? [amounts[Math.floor((amounts.length - 1) * 0.25)], amounts[Math.ceil((amounts.length - 1) * 0.75)]]
    : revealedBlended && opts.revealed
      ? opts.revealed.chequeBand
      : undefined;
  const coInvestors = [...(idx.co.get(investorId) ?? new Map<string, number>()).entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 25)
    .map(([id, count]) => ({ id, name: idx.investorNames.get(id)?.name ?? id, count }));
  const ru = idx.reUp.get(investorId);
  const entryStage = top(entry, 1)[0]?.[0];
  const t: InvestorTaste = {
    investorId,
    name: meta.name,
    kind: meta.kind,
    rounds,
    led,
    leadShare: joined ? led / joined : 0,
    companies: portfolio.size,
    sectorDist,
    stageDist,
    chequeBand,
    chequeMedian: median(amounts) ?? (revealedBlended ? opts.revealed?.chequeMedian : undefined),
    entryStage,
    coInvestors,
    followOn: { reUpRate: ru && ru.raised ? ru.reUp / ru.raised : 0, raisedAgainWithin24m: observed ? raisedAgain / observed : 0, observed },
    portfolio,
    revealedBlended,
    chips: [],
  };
  t.chips = tasteChips(t);
  return t;
}

function tasteChips(t: InvestorTaste): string[] {
  const chips: string[] = [];
  chips.push(`${t.rounds} rounds in ${t.companies} companies`);
  if (t.rounds) chips.push(`Leads ${Math.round(t.leadShare * 100)}%`);
  const sec = top(t.sectorDist, 2).filter(([, v]) => v >= 0.1);
  if (sec.length) chips.push(sec.map(([k, v]) => `${SECTOR_SHORT[k]} ${Math.round(v * 100)}%`).join(" · "));
  if (t.entryStage) chips.push(`Usually enters at ${STAGE_LABELS[t.entryStage]}`);
  if (t.chequeBand) chips.push(`Rounds ${fmtUsd(t.chequeBand[0])}–${fmtUsd(t.chequeBand[1])}`);
  if (t.followOn.reUpRate > 0) chips.push(`Re-ups in ${Math.round(t.followOn.reUpRate * 100)}% of next rounds`);
  if (t.revealedBlended) chips.push("Thin cohort history: blended with revealed deals");
  return chips;
}

// Fit of a company to the taste, 0..1. The investor would join at the company's NEXT round, so the
// stage term reads the taste at that stage. Both terms are relative to the investor's own top
// sector / stage, so a focused and a broad investor are on the same scale.
export const FIT_SECTOR_W = 0.6;
export const FIT_STAGE_W = 0.4;

export function tasteFit(t: InvestorTaste, sector: Sector, nextStage: Stage): number {
  const maxS = Math.max(0, ...Object.values<number | undefined>(t.sectorDist).map((v) => v ?? 0));
  const maxG = Math.max(0, ...ROUND_STAGES.map((s) => t.stageDist[s] ?? 0));
  const s = maxS ? (t.sectorDist[sector] ?? 0) / maxS : 0;
  const g = maxG ? (t.stageDist[nextStage] ?? 0) / maxG : 0;
  return FIT_SECTOR_W * s + FIT_STAGE_W * g;
}
