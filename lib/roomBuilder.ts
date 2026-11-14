import type { Debrief, FounderProfile, Investor } from "./types";
import type { Sector } from "./taxonomy";
import { debriefStats, scoreInvestor, type FounderMatch } from "./scoring";

export type RoomSuggestion = { sector: Sector; count: number; founderIds: string[] };

export const ROOM_THRESHOLD = 12;
export const ROOM_MIN_SCORE = 50;
export const ROOM_FOUNDERS = 6;
export const ROOM_INVESTORS = 3;

export function topSector(f: FounderProfile): Sector | undefined {
  let best: Sector | undefined;
  let bv = 0;
  for (const [s, v] of Object.entries(f.sectors) as [Sector, number][]) {
    if (v > bv) {
      bv = v;
      best = s;
    }
  }
  return best;
}

// Groups the investor's matched founders (score >= minScore) by their main sector and
// suggests a themed room for every group at or above the threshold.
export function suggestRooms(
  inv: Investor,
  ranked: FounderMatch[],
  founders: FounderProfile[],
  threshold = ROOM_THRESHOLD,
  minScore = ROOM_MIN_SCORE,
): RoomSuggestion[] {
  void inv;
  const byId = new Map(founders.map((f) => [f.id, f]));
  const groups = new Map<Sector, string[]>();
  for (const m of [...ranked].sort((a, b) => b.score - a.score)) {
    if (m.score < minScore) continue;
    const f = byId.get(m.founderId);
    const s = f && topSector(f);
    if (!s) continue;
    groups.set(s, [...(groups.get(s) ?? []), m.founderId]);
  }
  return [...groups]
    .filter(([, ids]) => ids.length >= threshold)
    .map(([sector, founderIds]) => ({ sector, count: founderIds.length, founderIds }))
    .sort((a, b) => b.count - a.count || a.sector.localeCompare(b.sector));
}

function topN<T>(items: T[], n: number, value: (t: T) => number, id: (t: T) => string): T[] {
  return [...items].sort((a, b) => value(b) - value(a) || id(a).localeCompare(id(b))).slice(0, n);
}

// Picks 6 founders and 3 investors that maximise the sum of pairwise scores: start from the
// investors with the strongest top-6 founder fits, then alternate re-picking each side
// against the other until the lineup stops changing.
export function buildRoom(
  sector: Sector,
  founders: FounderProfile[],
  investors: Investor[],
  debriefs: Debrief[] = [],
): { founderIds: string[]; investorIds: string[] } {
  const inSector = founders
    .filter((f) => (f.sectors[sector] ?? 0) > 0)
    .sort((a, b) => (b.sectors[sector] ?? 0) - (a.sectors[sector] ?? 0) || a.id.localeCompare(b.id));
  const pool =
    inSector.length >= ROOM_FOUNDERS
      ? inSector
      : [...inSector, ...founders.filter((f) => !inSector.includes(f))];
  if (!pool.length || !investors.length) return { founderIds: [], investorIds: [] };

  const fit = new Map<string, number>();
  const key = (i: string, f: string) => `${i}\u0000${f}`;
  for (const inv of investors) {
    const stats = debriefs.length ? debriefStats(debriefs, inv.id) : undefined;
    for (const f of pool) fit.set(key(inv.id, f.id), scoreInvestor(f, inv, stats).score);
  }
  const pair = (i: string, f: string) => fit.get(key(i, f)) ?? 0;

  const pickFounders = (invIds: string[]) =>
    topN(pool, ROOM_FOUNDERS, (f) => invIds.reduce((a, i) => a + pair(i, f.id), 0), (f) => f.id).map(
      (f) => f.id,
    );
  const pickInvestors = (fIds: string[]) =>
    topN(investors, ROOM_INVESTORS, (inv) => fIds.reduce((a, f) => a + pair(inv.id, f), 0), (i) => i.id).map(
      (i) => i.id,
    );

  let investorIds = topN(
    investors,
    ROOM_INVESTORS,
    (inv) =>
      pool
        .map((f) => pair(inv.id, f.id))
        .sort((a, b) => b - a)
        .slice(0, ROOM_FOUNDERS)
        .reduce((a, b) => a + b, 0),
    (i) => i.id,
  ).map((i) => i.id);
  let founderIds = pickFounders(investorIds);
  for (let iter = 0; iter < 5; iter++) {
    const nextInv = pickInvestors(founderIds);
    const nextF = pickFounders(nextInv);
    const same =
      nextInv.join() === investorIds.join() && nextF.join() === founderIds.join();
    investorIds = nextInv;
    founderIds = nextF;
    if (same) break;
  }
  return { founderIds, investorIds };
}
