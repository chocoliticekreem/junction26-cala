import type { Deal, Investor, Revealed } from "./types";
import { SECTOR_SHORT, STAGE_LABELS, stageIndex, type Sector, type Stage } from "./taxonomy";

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

// Below this top share a stated distribution is spread across the board: no stated preference.
export const STATED_LEAD_MIN = 0.4;
const TIE_EPSILON = 1e-9;

// A stated dimension is a claim only when one category clearly leads it ("across the full
// continuum" is not a claim, so it can neither score nor word a contradiction).
export function hasClearLead<K extends string>(w: Partial<Record<K, number>>): boolean {
  const shares = (Object.values(normalize(w)) as number[]).sort((a, b) => b - a);
  if (!shares.length || shares[0] < STATED_LEAD_MIN) return false;
  return shares.length === 1 || shares[0] - shares[1] > TIE_EPSILON;
}

// Average of the sector TVD and the stage TVD, over the dimensions where both sides have data
// and the stated side has a clear lead.
export function contradictionScore(stated: Investor["statedThesis"], revealed: Revealed): number {
  const parts: number[] = [];
  const ss = normalize(stated.sectors);
  const sg = normalize(stated.stages);
  if (hasClearLead(ss) && !isEmpty(revealed.S)) parts.push(tvd(ss, revealed.S));
  if (hasClearLead(sg) && !isEmpty(revealed.G)) parts.push(tvd(sg, revealed.G));
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

// A stated weight below this is a passing mention, not part of the thesis.
export const STATED_MIN_WEIGHT = 0.1;
// A line is strong when the off-thesis category is at least this share of counted deals.
export const STRONG_LINE_SHARE = 0.4;
// Below this share the contrast is too weak to call a contradiction at all.
export const MIN_LINE_SHARE = 0.25;
const MIN_LINE_COUNT = 2;

type Contrast = { said: string; was: string; count: number; total: number; gap: number };

// "other" is the taxonomy's catch-all, never a thesis or a revealed category worth naming.
const UNNAMED = "other";

// Up to two stated sectors read naturally; a wider thesis is summarised by its size.
function saidSectors(stated: Sector[], top: Sector): string {
  if (stated.length <= 2) return stated.map(sectorLabel).join(" and ");
  return `${stated.length} sectors, not ${sectorLabel(top)}`;
}

// Stages read in order; a contiguous span of three or more reads as a range.
function saidStages(stated: Stage[], top: Stage): string {
  const ordered = [...stated].sort((a, b) => stageIndex(a) - stageIndex(b));
  if (ordered.length <= 2) return ordered.map(stageLabel).join(" and ");
  const first = stageIndex(ordered[0]);
  const contiguous = ordered.every((s, i) => stageIndex(s) === first + i);
  if (contiguous) return `${stageLabel(ordered[0])} to ${stageLabel(ordered[ordered.length - 1])}`;
  return `${ordered.length} stages, not ${stageLabel(top)}`;
}

// The biggest revealed category the stated thesis leaves out. gap = share of the dimension's
// counted deals that fall outside the stated thesis.
function contrast<K extends string>(
  statedW: Partial<Record<K, number>>,
  values: K[],
  label: (k: K) => string,
  said: (stated: K[], top: K) => string,
): Contrast | undefined {
  const stated = (Object.entries(normalize(statedW)) as [K, number][])
    .filter(([k, w]) => w >= STATED_MIN_WEIGHT && k !== UNNAMED)
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k);
  if (!hasClearLead(statedW) || !stated.length || values.length < THIN_HISTORY_MIN_DEALS) return undefined;
  const counts = new Map<K, number>();
  let outside = 0;
  for (const v of values) {
    if (stated.includes(v)) continue;
    outside++;
    if (v !== UNNAMED) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let top: K | undefined;
  let topN = 0;
  for (const [k, n] of counts) {
    if (n > topN) {
      top = k;
      topN = n;
    }
  }
  if (!top || topN < MIN_LINE_COUNT || topN / values.length < MIN_LINE_SHARE) return undefined;
  return {
    said: said(stated, top),
    was: label(top),
    count: topN,
    total: values.length,
    gap: outside / values.length,
  };
}

// Built only from counted (dated, in-window) deals. Prefers a contrast where the off-thesis
// category is >= 40% of counted deals; then the dimension with the larger gap.
export function contradictionLine(
  inv: Pick<Investor, "statedThesis" | "deals">,
  now: Date = new Date(),
): string | undefined {
  const counted = countedDeals(inv.deals, now).map((c) => c.deal);
  const candidates = [
    contrast(
      inv.statedThesis.stages,
      counted.filter((d) => d.round !== "unknown").map((d) => d.round as Stage),
      stageLabel,
      saidStages,
    ),
    contrast(
      inv.statedThesis.sectors,
      counted.map((d) => d.sector),
      sectorLabel,
      saidSectors,
    ),
  ].filter((c): c is Contrast => !!c);
  const strong = (c: Contrast) => (c.count / c.total >= STRONG_LINE_SHARE ? 1 : 0);
  const pick = candidates.sort(
    (a, b) => strong(b) - strong(a) || b.gap - a.gap || b.count / b.total - a.count / a.total,
  )[0];
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
