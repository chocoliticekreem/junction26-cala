import type { Extraction, FounderProfile } from "./types";
import type { Sector } from "./taxonomy";

// Confidence keys written here: sectors, stage, raise, traction, teamSignals, geography,
// businessModel, company, oneLiner, name. "sectors.evidence" holds the accumulated evidence mass so later chunks add
// to earlier ones instead of replacing them.
const EVIDENCE_KEY = "sectors.evidence";
const MAX_CONFIDENCE = 0.99;
const MAX_TAGS = 12;

export function emptyProfile(id = "live"): FounderProfile {
  return { id, sectors: {}, teamSignals: [], confidence: {} };
}

function mergeSectors(p: FounderProfile, e: Extraction, confidence: Record<string, number>) {
  const hits = e.sectors.filter((s) => s.confidence > 0);
  if (!hits.length) return p.sectors;
  const hasExisting = Object.keys(p.sectors).length > 0;
  const mass = hasExisting ? (confidence[EVIDENCE_KEY] ?? 1) : 0;
  const raw: Partial<Record<Sector, number>> = {};
  for (const [s, w] of Object.entries(p.sectors) as [Sector, number][]) raw[s] = w * mass;
  for (const h of hits) raw[h.label] = (raw[h.label] ?? 0) + h.confidence;
  const total = Object.values(raw).reduce((a, b) => a + (b ?? 0), 0);
  const sectors: Partial<Record<Sector, number>> = {};
  for (const [s, v] of Object.entries(raw) as [Sector, number][]) sectors[s] = v / total;
  confidence[EVIDENCE_KEY] = total;
  const strongest = Math.max(...hits.map((h) => h.confidence));
  const prev = confidence.sectors ?? 0;
  confidence.sectors = Math.min(MAX_CONFIDENCE, 1 - (1 - prev) * (1 - strongest));
  return sectors;
}

const wins = (incoming: number, existing: number | undefined) =>
  existing === undefined || incoming >= existing;

export function mergeProfile(p: FounderProfile, e: Extraction): FounderProfile {
  const confidence = { ...p.confidence };
  const next: FounderProfile = {
    ...p,
    sectors: mergeSectors(p, e, confidence),
    teamSignals: [...p.teamSignals],
    confidence,
  };

  if (e.stage && (!p.stage || wins(e.stage.confidence, p.confidence.stage))) {
    next.stage = e.stage.value;
    confidence.stage = e.stage.confidence;
  }
  if (e.raise_amount && (p.raise === undefined || wins(e.raise_amount.confidence, p.confidence.raise))) {
    next.raise = e.raise_amount.value;
    confidence.raise = e.raise_amount.confidence;
  }
  if (e.traction) {
    const override = wins(e.traction.confidence, p.confidence.traction);
    const traction = { ...(p.traction ?? {}) };
    for (const k of ["revenue", "users", "growth"] as const) {
      const v = e.traction[k];
      if (v && (override || !traction[k])) traction[k] = v;
    }
    next.traction = traction;
    confidence.traction = Math.max(p.confidence.traction ?? 0, e.traction.confidence);
  }
  if (e.team_signals?.length) {
    for (const t of e.team_signals) {
      if (!next.teamSignals.some((s) => s.toLowerCase() === t.value.toLowerCase()))
        next.teamSignals.push(t.value);
    }
    const strongest = Math.max(...e.team_signals.map((t) => t.confidence));
    confidence.teamSignals = Math.max(p.confidence.teamSignals ?? 0, strongest);
  }
  if (e.geography && (!p.geography || wins(e.geography.confidence, p.confidence.geography))) {
    next.geography = e.geography.value;
    confidence.geography = e.geography.confidence;
  }
  if (
    e.business_model &&
    (!p.businessModel || wins(e.business_model.confidence, p.confidence.businessModel))
  ) {
    next.businessModel = e.business_model.value;
    confidence.businessModel = e.business_model.confidence;
  }
  if (e.company && (!p.company || wins(e.company.confidence, p.confidence.company))) {
    next.company = e.company.value;
    confidence.company = e.company.confidence;
  }
  if (e.one_liner && (!p.oneLiner || wins(e.one_liner.confidence, p.confidence.oneLiner))) {
    next.oneLiner = e.one_liner.value;
    confidence.oneLiner = e.one_liner.confidence;
  }
  if (e.founder_name && (!p.name || wins(e.founder_name.confidence, p.confidence.name))) {
    next.name = e.founder_name.value;
    confidence.name = e.founder_name.confidence;
  }
  if (e.tags?.length) {
    const tags = [...(p.tags ?? [])];
    for (const t of e.tags) if (!tags.some((x) => x.toLowerCase() === t.toLowerCase())) tags.push(t);
    next.tags = tags.slice(0, MAX_TAGS);
  }
  return next;
}
