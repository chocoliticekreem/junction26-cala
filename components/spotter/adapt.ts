import type { SpotterResult } from "@/lib/sim/spotter";
import { SECTOR_SHORT, STAGE_LABELS, type Sector, type Stage } from "@/lib/taxonomy";
import type { SpotterPick, SpotterPrecedent, SpotterResponse, SpotterShare } from "./types";

const pct = (x: number | undefined) => Math.round((x ?? 0) * 100);

const STREET = /\b(street|st\.|road|rd\.|avenue|ave\.|floor|suite|building|lane|square)\b/i;

// Cala hq is sometimes a full postal address; the card only has room for the city.
export function cityOf(hq: string | undefined): string | undefined {
  if (!hq) return undefined;
  const parts = hq
    .replace(/\(.*?\)/g, "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && !/\d/.test(s) && !STREET.test(s));
  if (!parts.length) return hq;
  return parts.length >= 3 ? parts[parts.length - 3] : parts[0];
}

function fmtUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${Math.round(n / 1e6)}M`;
  return `$${Math.round(n / 1e3)}k`;
}

function shares<K extends string>(dist: Partial<Record<K, number>>, label: (k: K) => string, n: number): SpotterShare[] {
  return (Object.entries(dist) as [K, number][])
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, share]) => ({ label: label(k), share }));
}

function precedent(n: SpotterResult["picks"][number]["precedents"]["unicorns"][number]): SpotterPrecedent {
  return { id: n.companyId, name: n.name, outcome: n.outcome, steps: n.steps.split(" → ") };
}

function adaptPick(p: SpotterResult["picks"][number]): SpotterPick {
  return {
    company: {
      id: p.company.id,
      name: p.company.name,
      sector: p.company.sector,
      city: cityOf(p.company.hq),
      path: p.company.path,
      latestRound: { stage: p.company.latestRound.stage, date: p.company.latestRound.date, leadName: p.company.latestRound.leadName },
      investors: p.company.investors.map((i) => i.name),
    },
    scores: {
      fit: pct(p.scores.fit),
      shape: pct(p.scores.shape),
      unicornOdds: pct(p.scores.pUnicorn),
      youOnPath: pct(p.scores.pOnPath),
      total: Math.min(100, pct(p.scores.combined)),
    },
    line: p.line,
    precedents: [...p.precedents.unicorns.slice(0, 4), ...p.precedents.stalled.slice(0, 2)].map(precedent),
    sampleSize: p.sample.referenceSize,
    lowConfidence: p.lowConfidence,
    actions: { sharedCoInvestors: p.actions.sharedCoInvestors.map((c) => c.name) },
  };
}

const nameKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

// The cohort still carries a few companies twice under different ids; show each name once, at
// its best rank.
function dedupe(picks: SpotterResult["picks"]): SpotterResult["picks"] {
  const seen = new Set<string>();
  return picks.filter((p) => {
    const k = nameKey(p.company.name);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function adaptSpotter(r: SpotterResult): SpotterResponse {
  const inv = r.investor;
  const [lo, hi] = inv.chequeBand ?? [];
  return {
    investor: {
      id: inv.id,
      name: inv.name,
      kind: inv.kind,
      rounds: inv.rounds,
      companies: inv.companies,
      lowConfidence: inv.lowConfidence,
      taste: {
        sectors: shares(inv.sectorDist, (s: Sector) => SECTOR_SHORT[s] ?? s, 4),
        stages: shares(inv.stageDist, (s: Stage) => STAGE_LABELS[s] ?? s, 3),
        chequeBand: lo !== undefined && hi !== undefined ? `${fmtUsd(lo)}–${fmtUsd(hi)}` : "n/a",
        leadShare: inv.leadShare,
      },
    },
    picks: dedupe(r.picks).map(adaptPick),
    asOf: r.asOf,
    basis: r.basis,
  };
}
