// Per event: how many companies in the fund's lane (its fit candidates) attend it.
import type { Revealed } from "@/lib/types";
import type { Cohort } from "../types";
import { resolveInvestor, spotterIndex } from "./base";
import { tasteFromIndex } from "./taste";
import { spotterCandidates, SpotterError } from "../spotter";

export type EventAttendance<E extends { id: string }> = E & { attending: number };

export function eventAttendance<E extends { id: string }>(
  cohort: Cohort,
  q: { investorId?: string; investorName?: string; asOf?: string; revealedFor?: (investorId: string) => Revealed | undefined },
  events: E[],
  eventsOf: (company: { id: string; name: string }) => { id: string }[],
): EventAttendance<E>[] {
  const idx = spotterIndex(cohort, q.asOf);
  const investorId = resolveInvestor(idx, q);
  if (!investorId) throw new SpotterError("investor_not_found", `No investor "${q.investorName ?? q.investorId}" in the cohort`);
  const taste = tasteFromIndex(idx, investorId, { revealed: q.revealedFor?.(investorId) });
  const counts = new Map<string, number>();
  for (const c of spotterCandidates(idx, taste)) for (const e of eventsOf(c.row.co)) counts.set(e.id, (counts.get(e.id) ?? 0) + 1);
  return events.map((e) => ({ ...e, attending: counts.get(e.id) ?? 0 }));
}
