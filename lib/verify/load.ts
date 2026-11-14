// Server-only: trust attached to the loaded data, for routes and the simulator to filter on.
import type { ContextDoc } from "@/lib/context/types";
import { loadInvestors } from "@/lib/data";
import type { Cohort } from "@/lib/sim/types";
import type { Deal, Investor } from "@/lib/types";
import { cohortRoundClaim, contextDocClaims, ctxFounderId, ctxHeadcountId, ctxInvestorId, ctxRoundId, dealClaim } from "./claims";
import { showAsFact } from "./rules";
import { loadVerifyFile, trustFor } from "./store";
import type { Trust, VerifyFile } from "./types";

export type TrustedDeal = Deal & { trust: Trust };
export type TrustedInvestor = Omit<Investor, "deals"> & { deals: TrustedDeal[] };

export function withDealTrust(investors: Investor[]): TrustedInvestor[] {
  return investors.map((inv) => ({ ...inv, deals: inv.deals.map((d) => ({ ...d, trust: trustFor(dealClaim(inv, d)) })) }));
}

export function loadInvestorsWithTrust(): TrustedInvestor[] {
  return withDealTrust(loadInvestors());
}

export function cohortTrust(cohort: Cohort): Record<string, Trust> {
  const out: Record<string, Trust> = {};
  for (const r of Object.values(cohort.rounds)) out[r.id] = trustFor(cohortRoundClaim(cohort, r));
  return out;
}

export type ContextTrust = {
  trust: Record<string, Trust>; // by claim id (ctx:<company>:round|investor|founder|headcount:...)
  facts: ContextDoc; // only verified/corroborated rounds, investors, founders and headcount
  unconfirmed: { id: string; level: Trust["level"]; text: string; reasons: string[] }[]; // shown as "unconfirmed", never as fact
};

// The demo company file: what Cala's graph says, split into confirmed facts and the rest.
export function contextTrust(doc: ContextDoc, file: VerifyFile | null = loadVerifyFile()): ContextTrust {
  const trust: Record<string, Trust> = {};
  for (const c of contextDocClaims(doc)) trust[c.id] = trustFor(c, file);
  const name = doc.company.name;
  const unconfirmed: ContextTrust["unconfirmed"] = [];
  const keep = (id: string, text: string) => {
    const t = trust[id];
    if (showAsFact(t)) return true;
    if (t) unconfirmed.push({ id, level: t.level, text, reasons: t.reasons });
    return false;
  };
  const facts: ContextDoc = {
    ...doc,
    rounds: doc.rounds.filter((r) => keep(ctxRoundId(name, r), `${r.label}${r.date ? `, ${r.date}` : ""}`)),
    investors: doc.investors.filter((i) => keep(ctxInvestorId(name, i.name), `Investor: ${i.name}`)),
    founders: doc.founders.filter((f) => keep(ctxFounderId(name, f.name), `Founder: ${f.name}`)),
  };
  if (doc.headcount && !keep(ctxHeadcountId(name), `Headcount: ${doc.headcount.value}`)) delete facts.headcount;
  const isConflict = (u: { level: Trust["level"] }) => (u.level === "conflict" ? 1 : 0);
  return { trust, facts, unconfirmed: unconfirmed.sort((a, b) => isConflict(b) - isConflict(a)) };
}
