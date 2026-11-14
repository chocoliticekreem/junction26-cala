// Trust rules. Pure: a claim plus whatever source checks exist -> one trust level with reasons.
//
//   fixture data                                        -> unverified (never real)
//   a checked source does not name the subject, and no
//     checked source confirms it                        -> conflict (never shown as fact)
//   a FILING source confirms it, or a PRIMARY source plus
//     one more independent site confirm it              -> verified
//   2+ independent sites confirm it                     -> corroborated
//   1 site confirms it                                  -> single_source
//   nothing confirms it (no URL, homepage-only citation,
//     knowledge/query row, nothing checked yet)         -> unverified
//   a failed date or amount sanity check, or an entity
//     warning, caps the level at single_source.
//
// "Confirms" = the page (or the source's own title) names the company and, when the claim states
// an amount or investors, also the amount or one of the investors (founder claims: the person).
// A title that does not name the company proves nothing; only a fetched page can contradict.
// "Independent" = a different registrable domain (newsletter.dealflow.es and dealflow.es are one).
import { investorKey } from "@/lib/cala";
import type { SourceRank, Stage } from "@/lib/types";
import type { Claim, SourceCheck, Trust, TrustLevel } from "./types";

const RANK_ORDER: SourceRank[] = ["FILING", "PRIMARY", "PRESS", "AGGREGATOR"];
const LEVEL_ORDER: TrustLevel[] = ["verified", "corroborated", "single_source", "unverified", "conflict"];

const TWO_PART_TLDS = /\.(co|com|org|net|ac|gov|ltd|me)\.[a-z]{2}$/;

export function registrableDomain(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    const parts = host.split(".");
    const n = TWO_PART_TLDS.test(host) ? 3 : 2;
    return parts.slice(-n).join(".");
  } catch {
    return undefined;
  }
}

// A citation that points at a site's root says nothing about the claim (Cala often stores
// "https://www.linkedin.com/" or "https://pitchbook.com/" as the document).
export function isSpecificUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return (u.pathname.replace(/\/+$/, "") !== "" || u.search !== "") && /^https?:$/.test(u.protocol);
  } catch {
    return false;
  }
}

// An investor's own profile on a funding database or its jobs page: the ingest attached it to a
// deal because the investor search cited it, but it is about the fund, not the round.
const PROFILE_URL =
  /\/(investors?|funds?|venture-funds|venture-capital|vc-firms?|firms|profiles\/investor|investor-profile)\/|\/d\/venture-capital\/|jobs\.|\/careers?\b|theventurecodex\.com\/funds/i;

export function isInvestorProfileUrl(url: string | undefined): boolean {
  return !!url && PROFILE_URL.test(url);
}

const dayMs = 86_400_000;
const parseDay = (d: string | undefined) => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? Date.parse(d.slice(0, 10)) : NaN);

export function dateCheck(c: Pick<Claim, "date" | "datePrecision" | "announcementDate">, asOf: string): string[] {
  const problems: string[] = [];
  const t = parseDay(c.date);
  if (!c.date) return ["no date"];
  if (Number.isNaN(t)) return [`unparseable date "${c.date}"`];
  const now = parseDay(asOf);
  // A month-precision date pinned to the 15th can sit a few days past the build date.
  const slack = c.datePrecision === "month" ? 31 : c.datePrecision === "year" ? 366 : 1;
  if (t > now + slack * dayMs) problems.push(`date ${c.date} is after the data date ${asOf.slice(0, 10)}`);
  if (t < Date.parse("1990-01-01")) problems.push(`date ${c.date} predates 1990`);
  const a = parseDay(c.announcementDate);
  if (!Number.isNaN(a) && a - t > 183 * dayMs) {
    const pinned = /-01-01$/.test(c.date) && c.datePrecision !== "day";
    problems.push(
      pinned
        ? `event date ${c.date} looks like a year-only pin; the round was announced ${c.announcementDate}`
        : `event date ${c.date} is more than 6 months before the announcement ${c.announcementDate}`,
    );
  }
  return problems;
}

// Generous ceilings per stage: outside them the amount is far more likely a parsing or entity
// error (a fund size, a valuation, the wrong company) than a real round.
const AMOUNT_BANDS: Record<Stage | "unknown", [number, number]> = {
  "pre-idea": [1_000, 5_000_000],
  "pre-seed": [5_000, 25_000_000],
  seed: [10_000, 60_000_000],
  "series-a": [500_000, 200_000_000],
  "series-b-plus": [1_000_000, 50_000_000_000],
  unknown: [5_000, 50_000_000_000],
};

export function amountCheck(c: Pick<Claim, "amountUsd" | "amountText" | "stage">): string[] {
  if (c.amountUsd === undefined) return [];
  const problems: string[] = [];
  const [lo, hi] = AMOUNT_BANDS[c.stage ?? "unknown"];
  if (c.amountUsd < lo || c.amountUsd > hi)
    problems.push(`amount $${Math.round(c.amountUsd).toLocaleString("en-US")} is outside the plausible range for ${c.stage ?? "an unknown stage"}`);
  // Currency stated in the text but the USD figure equals the raw number: the conversion was skipped.
  const raw = /\$|usd/i.test(c.amountText ?? "") ? null : c.amountText?.replace(/,/g, "").match(/(€|£|eur|gbp)\s*(\d+(?:\.\d+)?)\s*(m|k|b)?\b/i);
  if (raw) {
    const scale = raw[3] ? { m: 1e6, k: 1e3, b: 1e9 }[raw[3].toLowerCase() as "m" | "k" | "b"] : 1;
    if (Math.abs(parseFloat(raw[2]) * scale - c.amountUsd) < 1) problems.push(`amount ${c.amountText} was not converted to USD`);
  }
  return problems;
}

const fmtRank = (s: SourceRank | undefined) => s ?? "unranked";

function bestRank(ranks: (SourceRank | undefined)[]): SourceRank | undefined {
  return ranks.filter((r): r is SourceRank => !!r).sort((a, b) => RANK_ORDER.indexOf(a) - RANK_ORDER.indexOf(b))[0];
}

export function confirms(c: Claim, chk: SourceCheck): boolean {
  if (chk.status !== "ok" || !chk.mentionsSubject) return false;
  if (c.person) return chk.mentionsPerson === true;
  const wantsDetail = c.amountUsd !== undefined || (c.investors?.length ?? 0) > 0;
  return !wantsDetail || chk.mentionsAmount === true || chk.mentionsInvestor === true;
}

function rankOf(c: Claim, url: string): SourceRank | undefined {
  return c.sources.find((s) => s.url === url)?.rank;
}

export function assessTrust(c: Claim, checks: SourceCheck[] = [], asOf: string): Trust {
  const reasons: string[] = [];
  const dated = c.kind === "deal" || c.kind === "round";
  const dateProblems = dated ? dateCheck(c, asOf) : [];
  const amountProblems = amountCheck(c);
  const base = {
    corroborations: 0,
    dateSane: dateProblems.length === 0,
    amountSane: amountProblems.length === 0,
    ...(c.entityConfidence ? { entityConfidence: c.entityConfidence } : {}),
  };

  if (c.fixture) {
    return { level: "unverified", reasons: ["synthetic fixture data, not a real record"], checks: { ...base, dateSane: true, amountSane: true } };
  }

  const confirming = checks.filter((k) => confirms(c, k));
  const contradicting = checks.filter((k) => k.status === "ok" && k.mentionsSubject === false && k.method !== "title");
  // An investor's profile page listing the company is weaker than a report of the round: it can
  // make a claim single_source, never count towards corroboration.
  const reports = confirming.filter((k) => !((c.kind === "deal" || c.kind === "round") && isInvestorProfileUrl(k.url)));
  const sites = new Set(reports.map((k) => registrableDomain(k.url)).filter(Boolean));
  const corroborations = sites.size;
  const confirmRanks = reports.map((k) => rankOf(c, k.url));
  const sourceRank = bestRank(confirming.map((k) => rankOf(c, k.url))) ?? bestRank(c.sources.map((s) => s.rank));
  const mention = confirming.length > 0 ? true : contradicting.length > 0 ? false : checks.some((k) => k.mentionsSubject) ? true : undefined;
  // A deal claims this investor took part: a filing or the company's own post confirms that only
  // when it names the investor (a Form D records the money, never who put it in).
  const strong = (rank: SourceRank) =>
    reports.some((k) => rankOf(c, k.url) === rank && (c.kind !== "deal" || k.mentionsInvestor === true));

  let level: TrustLevel;
  if (contradicting.length > 0 && confirming.length === 0) {
    level = "conflict";
    for (const k of contradicting.slice(0, 2)) reasons.push(`cited source does not mention ${c.person ?? c.subject}: ${k.url}`);
  } else if (strong("FILING")) {
    level = "verified";
    reasons.push("a filing confirms it");
  } else if (strong("PRIMARY") && corroborations >= 2) {
    level = "verified";
    reasons.push(`the company or an investor confirms it, plus ${corroborations - 1} more independent site(s)`);
  } else if (corroborations >= 2) {
    level = "corroborated";
    reasons.push(`${corroborations} independent sites confirm it`);
  } else if (corroborations === 1) {
    level = "single_source";
    reasons.push(`one site confirms it (${[...sites][0]}, ${fmtRank(confirmRanks[0])})`);
  } else if (confirming.length > 0) {
    level = "single_source";
    reasons.push(`only the investor's profile page lists it (${registrableDomain(confirming[0].url)})`);
  } else {
    level = "unverified";
    if (c.fromQuery) reasons.push("Cala knowledge query row: no per-row source");
    const specific = c.sources.filter((s) => isSpecificUrl(s.url));
    const aboutDeal = specific.filter((s) => !(c.kind === "deal" || c.kind === "round") || !isInvestorProfileUrl(s.url));
    if (c.sources.length === 0) reasons.push("no source");
    else if (specific.length === 0) reasons.push("no checkable source (no URL, or only a site homepage)");
    else if (aboutDeal.length === 0) reasons.push("only cites investor profile pages, not a report of this round");
    else if (aboutDeal.every((s) => /(^|\.)linkedin\.com\//i.test(s.url!.replace(/^https?:\/\//, "")))) reasons.push("only LinkedIn sources (linked, never fetched)");
    else if (checks.length === 0) reasons.push(`${specific.length} cited URL(s) not checked yet`);
    else reasons.push("no checked source confirms it");
  }
  if (contradicting.length > 0 && level !== "conflict")
    reasons.push(`${contradicting.length} other cited source(s) do not mention ${c.subject}`);

  const lead = leadConsistency(c.leads, c.leadAnswers, c.leadFrom ?? (c.fromQuery ? "query" : undefined));
  if (lead.disagreeing.length) reasons.push(`lead disputed: other Cala answers name ${lead.disagreeing.slice(0, 2).join(" / ")}`);
  else if (lead.agreeing) {
    reasons.push(`${lead.agreeing + 1} Cala answers agree on the lead`);
    // Agreement between Cala answers is still Cala only: it lifts a sourceless row one step, no more.
    if (level === "unverified" && c.fromQuery && checks.length === 0) level = "single_source";
  }

  const capped = [...dateProblems, ...amountProblems, ...(c.entityWarnings ?? [])];
  if (capped.length && LEVEL_ORDER.indexOf(level) < LEVEL_ORDER.indexOf("single_source")) level = "single_source";
  reasons.push(...capped);

  return {
    level,
    reasons,
    checks: {
      ...base,
      corroborations,
      ...(mention !== undefined ? { sourceMentionsSubject: mention } : {}),
      ...(sourceRank ? { sourceRank } : {}),
      ...(lead.answers ? { leadAnswers: lead.answers } : {}),
    },
    ...(lead.level ? { fields: { lead: lead.level } } : {}),
  };
}

// "Series D Extension" -> "series-d-ext", "Seed+" -> "seed-ext", "Pre-Seed" -> "pre-seed".
export function roundLabelKey(label: string | undefined): string | undefined {
  if (!label) return undefined;
  const s = label.toLowerCase().replace(/\(.*?\)/g, " ");
  const ext = /\bext(ension)?\b|\+|\bbridge\b|\btop[- ]?up\b/.test(s) ? "-ext" : "";
  const series = s.match(/\bseries[- ]?([a-k])(?:[- ]?(\d))?\b/);
  if (series) return `series-${series[1]}${series[2] ? `-${series[2]}` : ""}${ext}`;
  if (/pre[- ]?seed/.test(s)) return `pre-seed${ext}`;
  if (/\bseed\b/.test(s)) return `seed${ext}`;
  // Anything else ("Crowdfunding", "Amazon investment") is compared as written.
  const plain = s.replace(/[^a-z0-9]+/g, " ").trim();
  return plain || undefined;
}

export type RoundRef = { stage?: Stage | "unknown"; label?: string; date?: string };

// Two answers describe the same round when their dates are within 60 days (month-pinned dates
// sit on the 15th) and, where both say, the stage and the round label agree. Coarser matching
// (same stage bucket and year) wrongly paired Ramp's Series B with its Series C.
export function sameRound(a: RoundRef, b: RoundRef): boolean {
  const ta = parseDay(a.date);
  const tb = parseDay(b.date);
  if (Number.isNaN(ta) || Number.isNaN(tb) || Math.abs(ta - tb) > 60 * dayMs) return false;
  if (a.stage && b.stage && a.stage !== "unknown" && b.stage !== "unknown" && a.stage !== b.stage) return false;
  const la = roundLabelKey(a.label);
  const lb = roundLabelKey(b.label);
  return !la || !lb || la === lb;
}

// A query row's free-text lead field -> names. "Heartfelt Capital (German fund, Porsche)" stays
// one name; "& others", "(lead)" and placeholders are dropped.
export function splitLeads(v: unknown): string[] {
  const parts = Array.isArray(v) ? v.map(String) : typeof v === "string" ? v.replace(/\(.*?\)/g, " ").split(/\s*[,;/]\s*|\s+and\s+|\s+&\s+/) : [];
  return parts
    .map((s) => s.replace(/\(.*?\)/g, " ").replace(/\s+/g, " ").trim())
    .filter((s) => s && !/^(none|null|n\/a|—|-|unknown|undisclosed|others?|co-?leads?|various)$/i.test(s));
}

// Cross-query consistency for the lead investor. `answers` are the lead sets other answers give for
// the same round (other knowledge/query rows, FundingRound is_lead). An answer identical to the
// claim's own leads may be the same row seen twice, so it counts as agreement but is not required.
//   no leads claimed                       -> no field trust
//   another answer names a different lead  -> conflict (the round can still be shown; the lead not)
//   another answer agrees                  -> corroborated (Cala-only agreement, never "verified")
//   no other answer: FundingRound is_lead  -> single_source; query text only -> unverified
const leadKey = (n: string) => investorKey(n.replace(/\((co-)?leads?\)/gi, " "));

export function leadConsistency(
  leads: string[] | undefined,
  answers: string[][] | undefined,
  from: "query" | "graph" | undefined,
): { level?: TrustLevel; agreeing: number; disagreeing: string[]; answers: number } {
  const mine = new Set((leads ?? []).map(leadKey).filter(Boolean));
  const others = (answers ?? []).map((a) => a.map(leadKey).filter(Boolean)).filter((a) => a.length);
  if (!mine.size) return { agreeing: 0, disagreeing: [], answers: others.length };
  const disagreeing = (answers ?? []).filter((a) => a.length && !a.some((n) => mine.has(leadKey(n)))).map((a) => a.join(", "));
  const agreeing = others.filter((a) => a.some((k) => mine.has(k))).length;
  const level: TrustLevel = disagreeing.length ? "conflict" : agreeing ? "corroborated" : from === "graph" ? "single_source" : "unverified";
  return { level, agreeing, disagreeing, answers: others.length };
}

// The demo rule: facts are shown plainly only when verified or corroborated.
export function showAsFact(t: Trust | undefined): boolean {
  return t?.level === "verified" || t?.level === "corroborated";
}

export function hide(t: Trust | undefined): boolean {
  return t?.level === "conflict";
}
