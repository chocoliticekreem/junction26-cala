import fixtureJson from "@/data/cohort.fixture.json";
import type { Sector, Stage } from "@/lib/taxonomy";
import type { Cohort, CohortCompany, CohortRound, InvestorKind } from "@/lib/sim/types";

export const fixture = fixtureJson as unknown as Cohort;

type R = { stage: Stage; date: string; lead?: string; others?: string[]; amount?: number; valuation?: number; noLeadFlag?: boolean };

// Small hand-made cohorts: company -> rounds; investor kinds from the `kinds` map (default fund).
export function makeCohort(
  asOf: string,
  companies: { id: string; sector?: Sector; status?: CohortCompany["status"]; rounds: R[]; maxValuationUsd?: number }[],
  kinds: Record<string, InvestorKind> = {},
): Cohort {
  const c: Cohort = { version: 1, asOf, companies: {}, rounds: {}, investors: {} };
  const inv = (id: string) => (c.investors[id] ??= { id, name: id.toUpperCase(), kind: kinds[id] ?? "fund" });
  for (const co of companies) {
    const roundIds: string[] = [];
    co.rounds.forEach((r, i) => {
      const id = `${co.id}-r${i}`;
      const parts = [...(r.lead ? [r.lead] : []), ...(r.others ?? [])].map((p) => {
        inv(p);
        return { investorId: p, name: p.toUpperCase(), kind: kinds[p] ?? "fund", ...(r.noLeadFlag ? {} : { isLead: p === r.lead }) };
      });
      const round: CohortRound = { id, companyId: co.id, stage: r.stage, label: r.stage, date: r.date, amountUsd: r.amount, valuationUsd: r.valuation, participants: parts, sources: [] };
      c.rounds[id] = round;
      roundIds.push(id);
    });
    c.companies[co.id] = {
      id: co.id,
      name: co.id,
      sector: co.sector ?? "fintech",
      status: co.status ?? "active",
      roundIds,
      sources: [],
      maxValuationUsd: co.maxValuationUsd,
    };
  }
  return c;
}

// The fixture copied k times with distinct ids: a cohort the size Track A expects (~900 companies).
export function scaledFixture(k: number): Cohort {
  const out: Cohort = { version: 1, asOf: fixture.asOf, companies: {}, rounds: {}, investors: {} };
  for (let i = 0; i < k; i++) {
    const sfx = `-x${i}`;
    // Investors are only partly shared across copies so the agent count grows too.
    const invId = (id: string) => (i % 2 === 0 ? id : `${id}${sfx}`);
    for (const inv of Object.values(fixture.investors)) out.investors[invId(inv.id)] = { ...inv, id: invId(inv.id) };
    for (const r of Object.values(fixture.rounds)) {
      out.rounds[r.id + sfx] = { ...r, id: r.id + sfx, companyId: r.companyId + sfx, participants: r.participants.map((p) => ({ ...p, investorId: invId(p.investorId) })) };
    }
    for (const co of Object.values(fixture.companies)) {
      out.companies[co.id + sfx] = { ...co, id: co.id + sfx, roundIds: co.roundIds.map((r) => r + sfx) };
    }
  }
  return out;
}
