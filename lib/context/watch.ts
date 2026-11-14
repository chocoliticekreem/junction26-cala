// Watchlist + in-app feed: recent rounds by watched investors in watched sectors. The feed is read
// from the ingested data on request; an email digest is roadmap, not built.
import { isSector } from "@/lib/taxonomy";
import type { Investor, Sector } from "@/lib/types";
import type { CohortLite } from "./cohortRead";
import type { FeedItem, Watchlist } from "./types";

export const FEED_DEFAULT_DAYS = 180;
export const MAX_WATCH_ITEMS = 50;

export function cleanSectors(raw: unknown): Sector[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((s): s is Sector => typeof s === "string" && isSector(s)))];
}

export function upsertWatch(
  list: Watchlist | undefined,
  id: string,
  inv: { id: string; name: string },
  sectors: Sector[],
  now: Date,
): Watchlist {
  const items = (list?.items ?? []).filter((i) => i.investorId !== inv.id);
  const prev = list?.items.find((i) => i.investorId === inv.id);
  items.push({ investorId: inv.id, name: inv.name, sectors, since: prev?.since ?? now.toISOString().slice(0, 10) });
  return { id, items: items.slice(-MAX_WATCH_ITEMS), updatedAt: now.toISOString() };
}

export function defaultSince(asOf: Date, days = FEED_DEFAULT_DAYS): string {
  return new Date(asOf.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

// Cohort rounds carry lead flags (led true/false); investors.json deals do not (led null).
export function buildFeed(list: Watchlist, investors: Investor[], cohort: CohortLite | null, since: string): FeedItem[] {
  const out: FeedItem[] = [];
  for (const w of list.items) {
    const inv = investors.find((i) => i.id === w.investorId || i.calaId === w.investorId);
    if (!inv) continue;
    const want = (s: Sector) => w.sectors.length === 0 || w.sectors.includes(s);
    const push = (item: FeedItem) => {
      const dup = out.find(
        (o) => o.investorId === item.investorId && o.company.toLowerCase() === item.company.toLowerCase() && o.date === item.date,
      );
      if (!dup) out.push(item);
      else if (dup.led === null) dup.led = item.led;
    };
    if (cohort) {
      for (const r of Object.values(cohort.rounds)) {
        if (!r.date || r.date < since) continue;
        const p = r.participants.find(
          (x) => x.investorId === inv.calaId || cohort.investors[x.investorId]?.investorsJsonId === inv.id,
        );
        const company = cohort.companies[r.companyId];
        if (!p || !company || !want(company.sector)) continue;
        push({
          investorId: inv.id,
          investorName: inv.name,
          company: company.name,
          companyCalaId: company.id,
          round: r.stage,
          date: r.date,
          ...(r.amountUsd ? { amountUsd: r.amountUsd } : {}),
          sector: company.sector,
          led: p.isLead === true,
          sources: r.sources.slice(0, 2),
        });
      }
    }
    for (const d of inv.deals) {
      if (!d.date || d.date < since || !want(d.sector)) continue;
      push({
        investorId: inv.id,
        investorName: inv.name,
        company: d.company,
        ...(d.companyCalaId ? { companyCalaId: d.companyCalaId } : {}),
        round: d.round,
        date: d.date,
        ...(d.amountUsd ? { amountUsd: d.amountUsd } : {}),
        sector: d.sector,
        led: null,
        sources: d.sources.slice(0, 2),
      });
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}
