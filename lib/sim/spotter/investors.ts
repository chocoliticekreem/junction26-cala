import type { Cohort, InvestorKind } from "@/lib/sim/types";

export const MIN_ROUNDS = 3;

export type SpotterInvestorOption = { id: string; name: string; kind: InvestorKind; rounds: number };

let cachedFor: Cohort | undefined;
let cachedList: SpotterInvestorOption[] = [];

// Every cohort investor that sat on at least MIN_ROUNDS rounds: fewer than that and the spotter has
// no taste to rank against. The cohort file is read once per process, so the list is memoised on it.
export function spotterInvestorOptions(cohort: Cohort): SpotterInvestorOption[] {
  if (cachedFor === cohort) return cachedList;
  const rounds = new Map<string, number>();
  for (const r of Object.values(cohort.rounds)) for (const p of r.participants) rounds.set(p.investorId, (rounds.get(p.investorId) ?? 0) + 1);
  cachedList = Object.values(cohort.investors)
    .filter((i) => i.id && (rounds.get(i.id) ?? 0) >= MIN_ROUNDS)
    .map((i) => ({ id: i.id, name: i.name, kind: i.kind, rounds: rounds.get(i.id)! }))
    .sort((a, b) => b.rounds - a.rounds || a.name.localeCompare(b.name));
  cachedFor = cohort;
  return cachedList;
}
