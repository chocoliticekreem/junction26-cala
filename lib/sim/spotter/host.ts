// "Host an event": the fund's lane (every candidate that fits its taste, not only event attendees),
// grouped by sector. Groups under MIN_GROUP are dropped and nothing is ever padded. A group's
// weight is the fund's own share of rounds in that sector times the group's mean fit: raw
// fit-weighted size would hand every fund the cohort's biggest sector (applied AI, 40 of ~75
// candidates for any fund), so Seedcamp and Lightspeed would host the same breakfast. When the
// fund has no sector history at all (thin, revealed-only), size by fit decides instead. The event
// name is a template on the sector.
import { SECTOR_SHORT, type Sector, type Stage } from "@/lib/taxonomy";
import type { Revealed } from "@/lib/types";
import type { Cohort } from "../types";
import { resolveInvestor, spotterIndex, type CompanyRow } from "./base";
import { tasteFromIndex } from "./taste";
import { spotterCandidates, SpotterError } from "../spotter";

export const MIN_GROUP = 3;
export const MAX_GROUPS = 2;
export const MAX_INVITES = 8;

export type HostInviteEvent = { id: string; name: string; date: string };

export type HostInvite = { id: string; name: string; stage: Stage; year?: string; events: HostInviteEvent[] };

export type HostEvent = {
  sector: Sector;
  name: string;
  count: number;
  attending: number;
  companies: HostInvite[];
};

export type HostQuery = {
  investorId?: string;
  investorName?: string;
  asOf?: string;
  revealedFor?: (investorId: string) => Revealed | undefined;
  eventsOf?: (company: { id: string; name: string }) => HostInviteEvent[];
};

export function hostEventName(sector: Sector): string {
  return `${SECTOR_SHORT[sector] ?? sector} founders breakfast`;
}

function invite(idx: ReturnType<typeof spotterIndex>, row: CompanyRow, events: HostInviteEvent[]): HostInvite {
  const last = row.eps[row.eps.length - 1];
  const date = idx.cohort.rounds[last.roundIds[last.roundIds.length - 1]]?.date;
  return { id: row.co.id, name: row.co.name, stage: last.stage, year: date?.slice(0, 4), events };
}

export function hostEvents(cohort: Cohort, q: HostQuery): HostEvent[] {
  const idx = spotterIndex(cohort, q.asOf);
  const investorId = resolveInvestor(idx, q);
  if (!investorId) throw new SpotterError("investor_not_found", `No investor "${q.investorName ?? q.investorId}" in the cohort`);
  const taste = tasteFromIndex(idx, investorId, { revealed: q.revealedFor?.(investorId) });
  const eventsOf = q.eventsOf ?? (() => []);
  const groups = new Map<Sector, { fitSum: number; rows: { row: CompanyRow; fit: number }[] }>();
  for (const c of spotterCandidates(idx, taste)) {
    const g = groups.get(c.row.co.sector) ?? { fitSum: 0, rows: [] };
    g.fitSum += c.fit;
    g.rows.push(c);
    groups.set(c.row.co.sector, g);
  }
  const big = [...groups.entries()].filter(([, g]) => g.rows.length >= MIN_GROUP);
  const share = (s: Sector) => taste.sectorDist[s] ?? 0;
  const anyShare = big.some(([s]) => share(s) > 0);
  const weight = ([s, g]: (typeof big)[number]) => (anyShare ? share(s) * (g.fitSum / g.rows.length) : g.fitSum);
  return big
    .sort((a, b) => weight(b) - weight(a) || b[1].rows.length - a[1].rows.length || a[0].localeCompare(b[0]))
    .slice(0, MAX_GROUPS)
    .map(([sector, g]) => {
      const rows = g.rows.map((c) => ({ ...c, events: eventsOf(c.row.co).map(({ id, name, date }) => ({ id, name, date })) }));
      return {
        sector,
        name: hostEventName(sector),
        count: rows.length,
        attending: rows.filter((r) => r.events.length > 0).length,
        companies: rows.slice(0, MAX_INVITES).map((r) => invite(idx, r.row, r.events)),
      };
    });
}
