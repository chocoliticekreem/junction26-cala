import type { Deal, Debrief, FounderProfile, Investor, Match, ScoreBreakdown } from "./types";
import { SECTOR_SHORT, STAGES, stageIndex, type Sector, type Stage } from "./taxonomy";
import {
  THIN_HISTORY_MIN_DEALS,
  countedDeals,
  normalize,
  sectorLabel,
  stageLabel,
} from "./revealed";

export type DebriefStats = {
  adj: number;
  n: number;
  weights: { sector: number; stage: number; cheque: number; activity: number; debrief: number };
};

export const BASE_WEIGHTS: DebriefStats["weights"] = {
  sector: 0.4,
  stage: 0.3,
  cheque: 0.15,
  activity: 0.1,
  debrief: 0.05,
};

const NEUTRAL = 0.5;
const ADJACENT_SOFTENING = 0.5;
const CHEQUE_ZERO_RATIO = 3;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

// Beta(1,1) prior on "fit = yes"; yes=1, maybe=0.5, no=0. A tag that is both repeated and the
// majority shifts that investor's weights (spec 5.4).
export function debriefStats(debriefs: Debrief[], investorId: string): DebriefStats {
  const mine = debriefs.filter((d) => d.investorId === investorId);
  const n = mine.length;
  const sum = mine.reduce((a, d) => a + (d.fit === "yes" ? 1 : d.fit === "maybe" ? 0.5 : 0), 0);
  const weights = { ...BASE_WEIGHTS };
  const tagCount = (t: Debrief["tag"]) => mine.filter((d) => d.tag === t).length;
  const stageTags = tagCount("stage");
  const sectorTags = tagCount("sector");
  if (stageTags >= 2 && stageTags > n / 2) {
    weights.stage = 0.35;
    weights.sector = 0.35;
  } else if (sectorTags >= 2 && sectorTags > n / 2) {
    weights.sector = 0.45;
    weights.stage = 0.25;
  }
  return { adj: (1 + sum) / (2 + n), n, weights };
}

function confidenceOf(f: FounderProfile, key: string): number {
  const c = f.confidence?.[key];
  return typeof c === "number" && Number.isFinite(c) ? clamp01(c) : 1;
}

// Confidence pulls a fit toward neutral, so a half-heard field moves the score half as much
// and a zero-confidence field equals an unknown one.
const withConfidence = (fit: number, c: number) => c * fit + (1 - c) * NEUTRAL;

function blendStated<K extends string>(
  revealed: Partial<Record<K, number>>,
  stated: Partial<Record<K, number>>,
  dealCount: number,
): Partial<Record<K, number>> {
  const s = normalize(stated);
  if (!Object.keys(s).length) return revealed;
  const a = Math.min(dealCount, THIN_HISTORY_MIN_DEALS) / THIN_HISTORY_MIN_DEALS;
  const out: Partial<Record<K, number>> = {};
  const keys = new Set<K>([...(Object.keys(revealed) as K[]), ...(Object.keys(s) as K[])]);
  for (const k of keys) out[k] = a * (revealed[k] ?? 0) + (1 - a) * (s[k] ?? 0);
  return normalize(out);
}

// Thin-history investors keep their stated thesis in the mix (spec 9.2).
export function effectiveSectors(inv: Investor): Partial<Record<Sector, number>> {
  if (!inv.thinHistory) return inv.revealed.S;
  return blendStated(inv.revealed.S, inv.statedThesis.sectors, inv.revealed.dealCount24m);
}

export function effectiveStages(inv: Investor): Partial<Record<Stage, number>> {
  if (!inv.thinHistory) return inv.revealed.G;
  return blendStated(inv.revealed.G, inv.statedThesis.stages, inv.revealed.dealCount24m);
}

function adjacent(s: Stage): Stage[] {
  const i = stageIndex(s);
  return [STAGES[i - 1], STAGES[i + 1]].filter(Boolean) as Stage[];
}

export function stageFitRaw(G: Partial<Record<Stage, number>>, stage: Stage): number {
  const adj = adjacent(stage).reduce((a, s) => a + (G[s] ?? 0), 0);
  return clamp01((G[stage] ?? 0) + ADJACENT_SOFTENING * adj);
}

// 1 inside the IQR, linear decay to 0 at 3x outside. Undefined when the band is unknown.
export function chequeFitRaw(raise: number, band: [number, number]): number | undefined {
  const [lo, hi] = band;
  if (!(hi > 0) || !(raise > 0)) return undefined;
  if (raise >= lo && raise <= hi) return 1;
  const ratio = raise < lo ? lo / raise : raise / hi;
  return clamp01(1 - (ratio - 1) / (CHEQUE_ZERO_RATIO - 1));
}

function founderSectors(f: FounderProfile): Partial<Record<Sector, number>> {
  return normalize(f.sectors ?? {});
}

type Term = { key: keyof ScoreBreakdown; contrib: number; known: boolean };

type Computed = {
  score: number;
  breakdown: ScoreBreakdown;
  terms: Term[];
  S: Partial<Record<Sector, number>>;
  G: Partial<Record<Stage, number>>;
  fs: Partial<Record<Sector, number>>;
};

function compute(f: FounderProfile, inv: Investor, stats?: DebriefStats): Computed {
  const w = stats?.weights ?? BASE_WEIGHTS;
  const S = effectiveSectors(inv);
  const G = effectiveStages(inv);
  const fs = founderSectors(f);

  const sectorKnown = Object.keys(fs).length > 0;
  let sectorFit = NEUTRAL;
  if (sectorKnown) {
    let raw = 0;
    for (const [s, v] of Object.entries(fs) as [Sector, number][]) raw += v * (S[s] ?? 0);
    sectorFit = withConfidence(clamp01(raw), confidenceOf(f, "sectors"));
  }

  const stageKnown = !!f.stage;
  const stageFit = f.stage
    ? withConfidence(stageFitRaw(G, f.stage), confidenceOf(f, "stage"))
    : NEUTRAL;

  const chequeRaw = f.raise ? chequeFitRaw(f.raise, inv.revealed.chequeBand) : undefined;
  const chequeKnown = chequeRaw !== undefined;
  const chequeFit = chequeKnown ? withConfidence(chequeRaw, confidenceOf(f, "raise")) : NEUTRAL;

  const activity = clamp01(inv.revealed.activity);
  const debriefAdj = stats && stats.n > 0 ? stats.adj : NEUTRAL;

  const breakdown: ScoreBreakdown = { sectorFit, stageFit, chequeFit, activity, debriefAdj };
  const terms: Term[] = [
    { key: "sectorFit", contrib: w.sector * sectorFit, known: sectorKnown },
    { key: "stageFit", contrib: w.stage * stageFit, known: stageKnown },
    { key: "chequeFit", contrib: w.cheque * chequeFit, known: chequeKnown },
    { key: "activity", contrib: w.activity * activity, known: true },
    { key: "debriefAdj", contrib: w.debrief * debriefAdj, known: !!stats && stats.n > 0 },
  ];
  const total = terms.reduce((a, t) => a + t.contrib, 0);
  return { score: Math.round(total * 1000) / 10, breakdown, terms, S, G, fs };
}

export function formatUsd(n: number): string {
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1).replace(/\.0$/, "")}m`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}k`;
  return `$${Math.round(n)}`;
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

function bestSharedSector(c: Computed): Sector | undefined {
  let best: Sector | undefined;
  let bv = 0;
  for (const [s, v] of Object.entries(c.fs) as [Sector, number][]) {
    const x = v * (c.S[s] ?? 0);
    if (x > bv) {
      bv = x;
      best = s;
    }
  }
  return best ?? argmax(c.fs);
}

function phrase(term: Term, f: FounderProfile, inv: Investor, c: Computed, now: Date): string {
  const counted = countedDeals(inv.deals, now);
  switch (term.key) {
    case "sectorFit": {
      const s = bestSharedSector(c);
      if (!s) return "Sector overlap with your pitch";
      const n = counted.filter((x) => x.deal.sector === s).length;
      if (n > 0) return `Backed ${n} ${sectorLabel(s)} deal${n === 1 ? "" : "s"} in 24 months`;
      if (inv.thinHistory && (inv.statedThesis.sectors[s] ?? 0) > 0)
        return `Says it backs ${sectorLabel(s)} (thin history)`;
      return `Some ${sectorLabel(s)} exposure`;
    }
    case "stageFit": {
      const st = f.stage as Stage;
      const top = argmax(c.G);
      const share = c.G[st] ?? 0;
      if (top === st) return `mostly ${stageLabel(st)}`;
      if (share >= 0.15) return `${Math.round(share * 100)}% of deals at ${stageLabel(st)}`;
      if (top) return `mostly ${stageLabel(top)}, next to your stage`;
      return "stage overlap";
    }
    case "chequeFit": {
      const [lo, hi] = inv.revealed.chequeBand;
      const band = `rounds of ${formatUsd(lo)}-${formatUsd(hi)}`;
      return c.breakdown.chequeFit >= 0.99 ? `${band} fit your raise` : band;
    }
    case "activity": {
      const n = counted.filter((x) => x.months <= 12).length;
      return `${n} deal${n === 1 ? "" : "s"} in the last 12 months`;
    }
    case "debriefAdj":
      return "positive room debriefs";
  }
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function reasonFor(f: FounderProfile, inv: Investor, c: Computed, now: Date): string {
  const top = c.terms
    .filter((t) => t.known && t.contrib > 0)
    .sort((a, b) => b.contrib - a.contrib)
    .slice(0, 2);
  const line = capitalize(top.map((t) => phrase(t, f, inv, c, now)).join("; "));
  const onlyOther = Object.keys(c.fs).length > 0 && Object.keys(c.fs).every((s) => s === "other");
  if (onlyOther && f.stage) return `Sector unclear, matched on stage; ${line}`;
  return line;
}

function dealTime(d: Deal): number {
  const t = d.date ? Date.parse(d.date) : NaN;
  return Number.isNaN(t) ? -Infinity : t;
}

// The 2-3 counted deals that contribute most to sectorFit + stageFit; newest first on ties.
// Topped up with the newest remaining deals so a card always has two chips when it can.
function evidenceFor(f: FounderProfile, inv: Investor, c: Computed, now: Date): Deal[] {
  const w = BASE_WEIGHTS;
  const counted = new Set(countedDeals(inv.deals, now).map((x) => x.deal));
  const contribution = (d: Deal) => {
    if (!counted.has(d)) return 0;
    const sec = w.sector * (c.fs[d.sector] ?? 0);
    let stg = 0;
    if (f.stage && d.round !== "unknown") {
      if (d.round === f.stage) stg = w.stage;
      else if (Math.abs(stageIndex(d.round) - stageIndex(f.stage)) === 1)
        stg = w.stage * ADJACENT_SOFTENING;
    }
    return sec + stg;
  };
  const scored = inv.deals
    .map((d) => ({ d, v: contribution(d), t: dealTime(d) }))
    .sort((a, b) => b.v - a.v || b.t - a.t);
  const picked = scored.filter((x) => x.v > 0).slice(0, 3).map((x) => x.d);
  if (picked.length < 2) {
    const rest = [...inv.deals].filter((d) => !picked.includes(d)).sort((a, b) => dealTime(b) - dealTime(a));
    while (picked.length < 2 && rest.length) picked.push(rest.shift() as Deal);
  }
  return picked;
}

export function scoreInvestor(
  f: FounderProfile,
  inv: Investor,
  stats?: DebriefStats,
  now: Date = new Date(),
): Match {
  const c = compute(f, inv, stats);
  return {
    investorId: inv.id,
    score: c.score,
    breakdown: c.breakdown,
    reason: reasonFor(f, inv, c, now),
    evidence: evidenceFor(f, inv, c, now),
  };
}

export function rankInvestors(
  f: FounderProfile,
  investors: Investor[],
  debriefs: Debrief[] = [],
): Match[] {
  return investors
    .map((inv) =>
      scoreInvestor(f, inv, debriefs.length ? debriefStats(debriefs, inv.id) : undefined),
    )
    .sort((a, b) => b.score - a.score || a.investorId.localeCompare(b.investorId));
}

export type FounderMatch = {
  founderId: string;
  score: number;
  breakdown: ScoreBreakdown;
  reason: string;
};

function founderReason(f: FounderProfile, inv: Investor, c: Computed, now: Date): string {
  const parts: string[] = [];
  const s = argmax(c.fs);
  if (s) parts.push(SECTOR_SHORT[s]);
  if (f.stage) parts.push(stageLabel(f.stage));
  if (f.raise) parts.push(`raising ${formatUsd(f.raise)}`);
  const head = parts.join(", ") || "Profile still forming";
  const shared = bestSharedSector(c);
  const n = shared
    ? countedDeals(inv.deals, now).filter((x) => x.deal.sector === shared).length
    : 0;
  if (shared && n > 0)
    return `${head}; you backed ${n} ${sectorLabel(shared)} deal${n === 1 ? "" : "s"} in 24 months`;
  return head;
}

export function rankFounders(
  inv: Investor,
  founders: FounderProfile[],
  debriefs: Debrief[] = [],
  now: Date = new Date(),
): FounderMatch[] {
  const stats = debriefs.length ? debriefStats(debriefs, inv.id) : undefined;
  return founders
    .map((f) => {
      const c = compute(f, inv, stats);
      return {
        founderId: f.id,
        score: c.score,
        breakdown: c.breakdown,
        reason: founderReason(f, inv, c, now),
      };
    })
    .sort((a, b) => b.score - a.score || a.founderId.localeCompare(b.founderId));
}
