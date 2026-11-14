// Pure parsing for Cala's entity graph: FundingRound entities and their participants, and Event
// participants. No network; scripts/ingest-rounds.ts and scripts/ingest-events.ts fetch.
import {
  FX_TO_USD,
  companyKey,
  investorKey,
  dedupeSources,
  normaliseRound,
  toSource,
  type CalaEdge,
  type CalaEntity,
  type CalaRawSource,
} from "./cala";
import type { Deal, Investor, Sector, Source, SourceRank, Stage } from "./types";

// One financing can be both an announced FundingRound and a filed financing event, or two
// FundingRound entities from two announcements; these thresholds call them the same money.
export const SAME_FINANCING_DAYS = 45;
export const SAME_FINANCING_AMOUNT_TOLERANCE = 0.1;
// A graph deal replaces a knowledge-query deal for the same company and round within this many
// days (query dates are often month- or year-pinned).
export const REPLACE_QUERY_DEAL_DAYS = 120;

const DAY_MS = 86_400_000;
const RANKS: readonly SourceRank[] = ["FILING", "PRIMARY", "PRESS", "AGGREGATOR"];

export function isSourceRank(x: unknown): x is SourceRank {
  return typeof x === "string" && (RANKS as readonly string[]).includes(x);
}

export type RankedSource = Source & { rank?: SourceRank };

const rankIndex = (s: RankedSource) => (s.rank ? RANKS.indexOf(s.rank) : RANKS.length);

function unranked(s: RankedSource): Source {
  const out: Source = { name: s.name };
  if (s.url) out.url = s.url;
  if (s.date) out.date = s.date;
  return out;
}

function rankedSources(raw: CalaRawSource[] | undefined): RankedSource[] {
  const out: RankedSource[] = [];
  for (const r of raw ?? []) {
    const s = toSource(r);
    if (!s) continue;
    out.push(isSourceRank(r.source_rank) ? { ...s, rank: r.source_rank } : s);
  }
  return out;
}

// Best-ranked first (stable within a rank), one entry per URL or name.
export function orderByRank(sources: RankedSource[], max = 8): RankedSource[] {
  const sorted = [...sources].sort((a, b) => rankIndex(a) - rankIndex(b));
  return dedupeSources(sorted, max) as RankedSource[];
}

export type RoundParticipant = {
  id: string;
  name: string;
  role?: string;
  isLead: boolean;
  sources: RankedSource[];
};

export type ParsedRound = {
  roundId: string;
  name: string;
  // null = not an equity venture round (debt, grant); never a deal.
  stage: Stage | "unknown" | null;
  amount?: string;
  amountUsd?: number;
  date?: string;
  datePrecision?: Deal["datePrecision"];
  issuer?: { id: string; name: string };
  participants: RoundParticipant[];
  // Some participant carries is_lead, so a participant without it is known not to lead.
  hasLeadData: boolean;
  sources: RankedSource[];
};

type Prop = { value: unknown; sources?: CalaRawSource[] };
const propOf = (e: CalaEntity, k: string): Prop | undefined => e.properties?.[k] as Prop | undefined;
const valueOf = (e: CalaEntity, k: string): unknown => propOf(e, k)?.value;

function isoDay(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
}

function precisionOf(raw: unknown): Deal["datePrecision"] {
  const p = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return p === "day" || p === "month" || p === "year" ? p : undefined;
}

// event_date (first close) when it is a real date, else announcement_date. Cala sometimes stores a
// year-only event_date as YYYY-01-01 with no precision (Cala's own pre-seed: event 2025-01-01,
// announced 2026-05-11); a Jan-1 event date more than 6 months before the announcement is that pin.
export function pickRoundDate(
  eventRaw: unknown,
  announcedRaw: unknown,
  precisionRaw?: unknown,
): { date?: string; precision?: Deal["datePrecision"] } {
  const event = isoDay(eventRaw);
  const announced = isoDay(announcedRaw);
  const precision = precisionOf(precisionRaw);
  const pinned = !!event && precision !== "day" && /-01-01$/.test(event);
  if (event && announced && pinned && Date.parse(announced) - Date.parse(event) > 183 * 86_400_000)
    return { date: announced, precision: "day" };
  if (event) return precision ? { date: event, precision } : { date: event };
  return announced ? { date: announced } : {};
}

const SYMBOL: Record<string, string> = { USD: "$", GBP: "£", EUR: "€" };

function formatAmount(value: number, units: string): string {
  const sym = SYMBOL[units];
  const short =
    value >= 1e9 ? `${+(value / 1e9).toFixed(2)}B` : value >= 1e6 ? `${+(value / 1e6).toFixed(1)}M` : value >= 1e3 ? `${Math.round(value / 1e3)}k` : String(value);
  return sym ? `${sym}${short}` : `${short} ${units}`;
}

// Debt or grant instruments are never deals; otherwise the label code (SEED, SERIES_A), then the
// round's name ("Seed", "Series B").
export function roundStage(label: unknown, name: unknown, instrument?: unknown): Stage | "unknown" | null {
  const text = (x: unknown) => (typeof x === "string" ? x.replace(/_/g, " ") : undefined);
  if (typeof instrument === "string" && normaliseRound(text(instrument)) === null) return null;
  const byLabel = normaliseRound(text(label));
  if (byLabel !== "unknown") return byLabel;
  return normaliseRound(text(name));
}

export function parseFundingRound(e: CalaEntity): ParsedRound {
  const nameRaw = valueOf(e, "name");
  const name = typeof nameRaw === "string" && nameRaw ? nameRaw : e.name;
  const stage = roundStage(valueOf(e, "round_label"), name, valueOf(e, "instrument"));

  const out: ParsedRound = { roundId: e.id, name, stage, participants: [], hasLeadData: false, sources: [] };

  const value = Number(valueOf(e, "transaction_value"));
  const unitsRaw = valueOf(e, "transaction_value_units");
  const units = typeof unitsRaw === "string" ? unitsRaw.trim().toUpperCase() : "";
  if (Number.isFinite(value) && value > 0 && units) {
    out.amount = formatAmount(value, units);
    if (units in FX_TO_USD) out.amountUsd = Math.round(value * FX_TO_USD[units as keyof typeof FX_TO_USD]);
  }

  const picked = pickRoundDate(valueOf(e, "event_date"), valueOf(e, "announcement_date"), valueOf(e, "event_date__precision"));
  if (picked.date) out.date = picked.date;
  if (picked.precision) out.datePrecision = picked.precision;

  for (const edge of e.relationships?.incoming?.PARTICIPATES_IN_FUNDING_ROUND ?? []) {
    const props = edge.properties ?? {};
    const role = typeof props.role === "string" ? props.role : undefined;
    const p: RoundParticipant = {
      id: edge.id,
      name: edge.name,
      role,
      isLead: props.is_lead === true,
      sources: rankedSources(props.sources),
    };
    if (role === "ISSUER") out.issuer ??= { id: edge.id, name: edge.name };
    out.participants.push(p);
  }
  out.hasLeadData = out.participants.some((p) => p.isLead);

  const propSources = ["transaction_value", "event_date", "announcement_date", "round_label", "name"].flatMap(
    (k) => rankedSources(propOf(e, k)?.sources),
  );
  const issuerSources = out.participants.find((p) => p.role === "ISSUER")?.sources ?? [];
  out.sources = orderByRank([...propSources, ...issuerSources]);
  return out;
}

// The deal this round is for one investor, matched on any of its Cala ids. Only INVESTOR
// participation counts (a LENDER is debt). isLead is left out when no participant is marked lead.
export function dealFromRound(r: ParsedRound, investorIds: Set<string>, sector: Sector): Deal | undefined {
  if (r.stage === null || !r.issuer) return undefined;
  const mine = r.participants.filter((p) => p.role === "INVESTOR" && investorIds.has(p.id));
  if (!mine.length) return undefined;
  const ranked = orderByRank([...mine.flatMap((p) => p.sources), ...r.sources], 4);
  const deal: Deal = {
    company: r.issuer.name,
    companyCalaId: r.issuer.id,
    round: r.stage,
    sector,
    sources: ranked.map(unranked),
    roundId: r.roundId,
  };
  if (r.date) deal.date = r.date;
  if (r.datePrecision) deal.datePrecision = r.datePrecision;
  if (r.amount) deal.amount = r.amount;
  if (r.amountUsd) deal.amountUsd = r.amountUsd;
  if (mine.some((p) => p.isLead)) deal.isLead = true;
  else if (r.hasLeadData) deal.isLead = false;
  if (ranked[0]?.rank) deal.sourceRank = ranked[0].rank;
  return deal;
}

export type Financing = { company: string; companyCalaId?: string; date?: string; amountUsd?: number; round: Stage | "unknown" };

const sameCompany = (a: Financing, b: Financing) =>
  (!!a.companyCalaId && a.companyCalaId === b.companyCalaId) || companyKey(a.company) === companyKey(b.company);

const daysApart = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / DAY_MS;

// Same issuer, dated within 45 days, and amounts within 10% (or, with an amount missing, the same
// known round).
export function sameFinancing(a: Financing, b: Financing): boolean {
  if (!a.date || !b.date || !sameCompany(a, b) || daysApart(a.date, b.date) > SAME_FINANCING_DAYS) return false;
  if (a.amountUsd && b.amountUsd)
    return Math.abs(a.amountUsd - b.amountUsd) <= SAME_FINANCING_AMOUNT_TOLERANCE * Math.max(a.amountUsd, b.amountUsd);
  return a.round !== "unknown" && a.round === b.round;
}

const completeness = (d: Deal) =>
  [d.isLead !== undefined, !!d.amountUsd, d.round !== "unknown", !!d.sourceRank].filter(Boolean).length;

// Collapses records of one financing; keeps the most complete record, earlier one on ties.
export function dedupeFinancings(deals: Deal[]): Deal[] {
  const kept: Deal[] = [];
  for (const d of deals) {
    const i = kept.findIndex((k) => sameFinancing(k, d));
    if (i < 0) kept.push(d);
    else if (completeness(d) > completeness(kept[i])) kept[i] = d;
  }
  return kept;
}

// Graph deals replace knowledge-query deals for the same company and round (or a query deal with
// an unknown round) dated within REPLACE_QUERY_DEAL_DAYS, keeping the query deal's sector and
// citations after the graph's. A re-run replaces the same roundId. Everything else is kept.
export function mergeGraphDeals(existing: Deal[], graph: Deal[]): { deals: Deal[]; replaced: number; added: number } {
  const deals = [...existing];
  let replaced = 0;
  let added = 0;
  for (const g of graph) {
    const again = deals.findIndex((d) => d.roundId && d.roundId === g.roundId);
    if (again >= 0) {
      // Keep the sector chosen last time unless it was the "other" fallback.
      const prev = deals[again].sector;
      deals[again] = { ...g, sector: prev !== "other" ? prev : g.sector };
      continue;
    }
    const i = deals.findIndex(
      (d) =>
        !d.roundId &&
        sameCompany(d, g) &&
        (d.round === g.round || d.round === "unknown") &&
        (!d.date || !g.date || daysApart(d.date, g.date) <= REPLACE_QUERY_DEAL_DAYS),
    );
    if (i < 0) {
      deals.push(g);
      added++;
      continue;
    }
    const q = deals[i];
    const merged: Deal = { ...g, sector: q.sector, sources: dedupeSources([...g.sources, ...q.sources], 4) };
    if (!merged.companyCalaId && q.companyCalaId) merged.companyCalaId = q.companyCalaId;
    if (!merged.amountUsd && q.amountUsd) {
      merged.amountUsd = q.amountUsd;
      if (q.amount) merged.amount = q.amount;
    }
    if (!merged.date && q.date) merged.date = q.date;
    deals[i] = merged;
    replaced++;
  }
  return { deals, replaced, added };
}


// ---------- events ----------

export type EventMatch = { source?: Source; via: "id" | "name"; attendeeId: string };

// Name fallback needs 5+ characters of key and one unique participant. It matches the full company
// key ("Balderton Capital" = "Balderton Capital Ltd"), or the investor key when the participant's
// own name carries an investor word ("Point Nine Capital" for "Point Nine"), never a bare word
// ("Form" for "Form Ventures", "Techstars" for "Techstars London").
const MIN_NAME_KEY = 5;

function participantKeys(name: string): string[] {
  const full = companyKey(name);
  const inv = investorKey(name);
  return inv !== full ? [full, `inv:${inv}`] : [full];
}

// Our investors among an Event's incoming PARTICIPATES_IN_EVENT edges, by Cala id, else by name.
// A name match is the same investor under another Cala entity, so attendeeId is worth keeping.
export function matchEventParticipants(
  participants: CalaEdge[],
  investors: Pick<Investor, "id" | "calaId" | "name">[],
): Map<string, EventMatch> {
  const byId = new Map<string, CalaEdge>();
  const byName = new Map<string, CalaEdge[]>();
  for (const a of participants) {
    byId.set(a.id, a);
    for (const k of participantKeys(a.name))
      if (k.replace(/^inv:/, "").length >= MIN_NAME_KEY) byName.set(k, [...(byName.get(k) ?? []), a]);
  }
  const out = new Map<string, EventMatch>();
  for (const inv of investors) {
    const hit = inv.calaId ? byId.get(inv.calaId) : undefined;
    const named = byName.get(companyKey(inv.name)) ?? byName.get(`inv:${investorKey(inv.name)}`);
    const edge = hit ?? (named?.length === 1 ? named[0] : undefined);
    if (!edge) continue;
    const m: EventMatch = { via: hit ? "id" : "name", attendeeId: edge.id };
    const source = rankedSources(edge.properties?.sources).map(unranked)[0];
    if (source) m.source = source;
    out.set(inv.id, m);
  }
  return out;
}
