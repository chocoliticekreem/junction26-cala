// Turns the app's records (investor deals, cohort rounds, a company's context doc) into Claims with
// stable ids, so a stored trust result can be found again at load time.
import { companyKey, investorKey } from "@/lib/cala";
import type { ContextDoc } from "@/lib/context/types";
import type { Cohort, CohortRound } from "@/lib/sim/types";
import type { Deal, Investor } from "@/lib/types";
import type { Claim, ClaimSource } from "./types";

const QUERY_SOURCE = "Cala knowledge query";

// Descriptions that say the entity is not a startup or an investor at all.
const NOT_A_VENTURE =
  /\b(restaurant|bar and grill|law firm|legal services|solicitors|accountancy|estate agent|construction and engineering|plumbing|transportation and logistics|dormant|shell company|nonprofit-focused|charity)\b/i;

export function entityWarning(description: string | undefined, role: "company" | "investor"): string | undefined {
  if (!description) return undefined;
  if (NOT_A_VENTURE.test(description)) return `the Cala entity for this ${role} is described as "${description.slice(0, 90)}"`;
  return undefined;
}

function sourcesOf(list: { name: string; url?: string; date?: string; rank?: string }[]): ClaimSource[] {
  return list.map((s) => ({
    name: s.name,
    ...(s.url ? { url: s.url } : {}),
    ...(s.date ? { date: s.date } : {}),
    ...(s.rank === "FILING" || s.rank === "PRIMARY" || s.rank === "PRESS" || s.rank === "AGGREGATOR" ? { rank: s.rank } : {}),
  }));
}

export function dealClaimId(investorId: string, d: Deal): string {
  return `deal:${investorId}:${d.roundId ?? companyKey(d.company)}:${d.round}:${d.date ?? "-"}`;
}

export function dealClaim(inv: Investor, d: Deal, opts: { entityWarnings?: string[] } = {}): Claim {
  const fromQuery = !d.roundId;
  const sources = sourcesOf(d.sources.filter((s) => s.name !== QUERY_SOURCE));
  if (d.sourceRank && sources[0] && !sources[0].rank) sources[0].rank = d.sourceRank;
  return {
    id: dealClaimId(inv.id, d),
    kind: "deal",
    subject: d.company,
    investors: [inv.name],
    ...(d.isLead ? { leads: [inv.name], leadFrom: "graph" as const } : {}),
    stage: d.round,
    ...(d.date ? { date: d.date } : {}),
    ...(d.datePrecision ? { datePrecision: d.datePrecision } : {}),
    ...(d.amountUsd !== undefined ? { amountUsd: d.amountUsd } : {}),
    ...(d.amount ? { amountText: d.amount } : {}),
    sources,
    ...(fromQuery ? { fromQuery } : {}),
    ...(inv.fixture ? { fixture: true } : {}),
    ...(opts.entityWarnings?.length && !fromQuery ? { entityWarnings: opts.entityWarnings } : {}),
  };
}

export function roundClaimId(r: CohortRound): string {
  return `round:${r.id}`;
}

const isFixtureSource = (s: { name: string }) => /synthetic fixture/i.test(s.name);

export function cohortRoundClaim(cohort: Cohort, r: CohortRound): Claim {
  const co = cohort.companies[r.companyId];
  const warnings: string[] = [];
  const w = entityWarning(co?.description, "company");
  if (w) warnings.push(w);
  if (r.companyId.startsWith("name:")) warnings.push("company not resolved to a Cala entity (name only)");
  return {
    id: roundClaimId(r),
    kind: "round",
    subject: co?.name.replace(/\s*\(fixture\)\s*/i, "") ?? r.companyId,
    investors: r.participants.map((p) => p.name),
    leads: r.participants.filter((p) => p.isLead).map((p) => p.name),
    leadFrom: r.id.startsWith("q:") ? ("query" as const) : ("graph" as const),
    stage: r.stage,
    label: r.label,
    ...(r.date ? { date: r.date } : {}),
    ...(r.datePrecision ? { datePrecision: r.datePrecision } : {}),
    ...(r.amountUsd !== undefined ? { amountUsd: r.amountUsd } : {}),
    sources: sourcesOf(r.sources.filter((s) => s.name !== QUERY_SOURCE)),
    ...(r.id.startsWith("q:") ? { fromQuery: true } : {}),
    ...(r.sources.some(isFixtureSource) || co?.sources.some(isFixtureSource) ? { fixture: true } : {}),
    ...(warnings.length ? { entityWarnings: warnings } : {}),
  };
}

// ---------- context doc (the founder's own company) ----------

export const ctxPrefix = (companyName: string) => `ctx:${companyKey(companyName)}`;

export function ctxRoundId(company: string, r: { id?: string; label: string; date?: string }): string {
  return `${ctxPrefix(company)}:round:${r.id ?? `${companyKey(r.label)}-${r.date ?? "-"}`}`;
}
export const ctxInvestorId = (company: string, investor: string) => `${ctxPrefix(company)}:investor:${investorKey(investor)}`;
export const ctxFounderId = (company: string, person: string) => `${ctxPrefix(company)}:founder:${companyKey(person)}`;
export const ctxHeadcountId = (company: string) => `${ctxPrefix(company)}:headcount`;

// Claims for what a context doc states. The doc keeps one source per investor and founder; the
// verify script builds richer claims (every edge source) under the same ids.
export function contextDocClaims(doc: ContextDoc): Claim[] {
  const company = doc.company.name;
  const out: Claim[] = [];
  for (const r of doc.rounds)
    out.push({
      id: ctxRoundId(company, r),
      kind: "round",
      subject: company,
      investors: r.investors,
      leads: r.leads,
      label: r.label,
      ...(r.id ? { leadFrom: "graph" as const } : {}),
      stage: r.stage,
      ...(r.date ? { date: r.date } : {}),
      ...(r.amountUsd !== undefined ? { amountUsd: r.amountUsd } : {}),
      ...(r.amountText ? { amountText: r.amountText } : {}),
      sources: sourcesOf(r.sources.filter((s) => s.name !== QUERY_SOURCE)),
      ...(r.sources.some((s) => s.name === QUERY_SOURCE) && !r.id ? { fromQuery: true } : {}),
      ...(doc.mock ? { fixture: true } : {}),
    });
  for (const i of doc.investors)
    out.push({
      id: ctxInvestorId(company, i.name),
      kind: "investor",
      subject: company,
      investors: [i.name],
      sources: i.source ? sourcesOf([i.source]) : [],
      ...(doc.mock ? { fixture: true } : {}),
    });
  for (const f of doc.founders)
    out.push({
      id: ctxFounderId(company, f.name),
      kind: "founder",
      subject: company,
      person: f.name,
      sources: f.source ? sourcesOf([f.source]) : [],
      ...(doc.mock ? { fixture: true } : {}),
    });
  if (doc.headcount)
    out.push({
      id: ctxHeadcountId(company),
      kind: "headcount",
      subject: company,
      sources: doc.headcount.source ? sourcesOf([doc.headcount.source]) : [],
      ...(doc.mock ? { fixture: true } : {}),
    });
  return out;
}
