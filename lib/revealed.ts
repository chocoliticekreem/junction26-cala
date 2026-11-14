import type { Deal, Investor, Revealed } from "./types";
import { SECTOR_SHORT, STAGE_LABELS, type Sector, type Stage } from "./taxonomy";

export const WINDOW_MONTHS = 24;
export const HALF_LIFE_MONTHS = 12;
export const CONTRADICTION_THRESHOLD = 0.4;
// 12 dated deals in the last 12 months saturates activity at 1.
export const ACTIVITY_SATURATION = 12;
export const THIN_HISTORY_MIN_DEALS = 3;

const DAY_MS = 86_400_000;
const MONTH_DAYS = 30.4375;

export type CountedDeal = { deal: Deal; months: number };

export function monthsBetween(dateIso: string, now: Date): number | undefined {
  const t = Date.parse(dateIso);
  if (Number.isNaN(t)) return undefined;
  return (now.getTime() - t) / DAY_MS / MONTH_DAYS;
}

// Dated deals inside the 24-month window. A deal dated up to one month in the future is
// treated as today, so timezone or month-only dates do not drop fresh deals.
export function countedDeals(deals: Deal[], now: Date = new Date()): CountedDeal[] {
  const out: CountedDeal[] = [];
  for (const deal of deals) {
    if (!deal.date) continue;
    const m = monthsBetween(deal.date, now);
    if (m === undefined || m < -1 || m > WINDOW_MONTHS) continue;
    out.push({ deal, months: Math.max(0, m) });
  }
  return out;
}

export function normalize<K extends string>(
  w: Partial<Record<K, number>>,
): Partial<Record<K, number>> {
  let total = 0;
  for (const v of Object.values(w) as (number | undefined)[]) {
    if (typeof v === "number" && v > 0) total += v;
  }
  if (total <= 0) return {};
  const out: Partial<Record<K, number>> = {};
  for (const [k, v] of Object.entries(w) as [K, number | undefined][]) {
    if (typeof v === "number" && v > 0) out[k] = v / total;
  }
  return out;
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function computeRevealed(deals: Deal[], now: Date = new Date()): Revealed {
  const counted = countedDeals(deals, now);
  const S: Partial<Record<Sector, number>> = {};
  const G: Partial<Record<Stage, number>> = {};
  const amounts: number[] = [];
  let last12 = 0;
  for (const { deal, months } of counted) {
    const w = Math.pow(0.5, months / HALF_LIFE_MONTHS);
    S[deal.sector] = (S[deal.sector] ?? 0) + w;
    if (deal.round !== "unknown") G[deal.round] = (G[deal.round] ?? 0) + w;
    if (typeof deal.amountUsd === "number" && deal.amountUsd > 0) amounts.push(deal.amountUsd);
    if (months <= 12) last12++;
  }
  amounts.sort((a, b) => a - b);
  const chequeBand: [number, number] = amounts.length
    ? [quantile(amounts, 0.25), quantile(amounts, 0.75)]
    : [0, 0];
  return {
    S: normalize(S),
    G: normalize(G),
    chequeBand,
    chequeMedian: amounts.length ? quantile(amounts, 0.5) : undefined,
    activity: Math.min(1, Math.log1p(last12) / Math.log1p(ACTIVITY_SATURATION)),
    dealCount24m: counted.length,
  };
}

function tvd<K extends string>(p: Partial<Record<K, number>>, q: Partial<Record<K, number>>) {
  const keys = new Set<K>([...(Object.keys(p) as K[]), ...(Object.keys(q) as K[])]);
  let d = 0;
  for (const k of keys) d += Math.abs((p[k] ?? 0) - (q[k] ?? 0));
  return d / 2;
}

const isEmpty = (o: object) => Object.keys(o).length === 0;

// Average of the sector TVD and the stage TVD, over whichever dimensions both sides have.
export function contradictionScore(stated: Investor["statedThesis"], revealed: Revealed): number {
  const parts: number[] = [];
  const ss = normalize(stated.sectors);
  const sg = normalize(stated.stages);
  if (!isEmpty(ss) && !isEmpty(revealed.S)) parts.push(tvd(ss, revealed.S));
  if (!isEmpty(sg) && !isEmpty(revealed.G)) parts.push(tvd(sg, revealed.G));
  if (!parts.length) return 0;
  return parts.reduce((a, b) => a + b, 0) / parts.length;
}

export function sectorLabel(s: Sector): string {
  const short = SECTOR_SHORT[s];
  return /^[A-Z][a-z]/.test(short) ? short[0].toLowerCase() + short.slice(1) : short;
}

export function stageLabel(s: Stage): string {
  const l = STAGE_LABELS[s];
  return l.startsWith("Series") ? l : l.toLowerCase();
}

function argmax<K extends string>(w: Partial<Record<K, number>>): K | undefined {
  let best: K | undefined;
  let bv = -Infinity;
  for (const [k, v] of Object.entries(w) as [K, number][]) {
    if (v > bv) {
      bv = v;
      best = k;
    }
  }
  return best;
}

type Mismatch = { said: string; was: string; count: number; total: number };

function mismatch<K extends string>(
  statedW: Partial<Record<K, number>>,
  values: K[],
  label: (k: K) => string,
): Mismatch | undefined {
  const said = argmax(normalize(statedW));
  if (!said || values.length < THIN_HISTORY_MIN_DEALS) return undefined;
  const counts = new Map<K, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let top: K | undefined;
  let topN = 0;
  for (const [k, n] of counts) {
    if (n > topN) {
      top = k;
      topN = n;
    }
  }
  if (!top || top === said || topN <= (counts.get(said) ?? 0)) return undefined;
  return { said: label(said), was: label(top), count: topN, total: values.length };
}

// Built only from counted (dated, in-window) deals; picks whichever dimension disagrees harder.
export function contradictionLine(
  inv: Pick<Investor, "statedThesis" | "deals">,
  now: Date = new Date(),
): string | undefined {
  const counted = countedDeals(inv.deals, now).map((c) => c.deal);
  const stage = mismatch(
    inv.statedThesis.stages,
    counted.filter((d) => d.round !== "unknown").map((d) => d.round as Stage),
    stageLabel,
  );
  const sector = mismatch(
    inv.statedThesis.sectors,
    counted.map((d) => d.sector),
    sectorLabel,
  );
  const pick =
    stage && sector ? (stage.count / stage.total >= sector.count / sector.total ? stage : sector) : (stage ?? sector);
  if (!pick) return undefined;
  return `Says ${pick.said}; ${pick.count} of last ${pick.total} deals were ${pick.was}`;
}

export function finalizeInvestor(
  raw: Omit<Investor, "revealed" | "contradiction" | "contradictionLine" | "thinHistory">,
  now: Date = new Date(),
): Investor {
  const revealed = computeRevealed(raw.deals, now);
  const thinHistory = revealed.dealCount24m < THIN_HISTORY_MIN_DEALS;
  // Too few counted deals to claim a contradiction; never invent one.
  const contradiction = thinHistory ? 0 : contradictionScore(raw.statedThesis, revealed);
  const line =
    contradiction > CONTRADICTION_THRESHOLD ? contradictionLine(raw, now) : undefined;
  const inv: Investor = { ...raw, revealed, contradiction, thinHistory };
  if (line) inv.contradictionLine = line;
  return inv;
}
