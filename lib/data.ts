import investorsReal from "@/data/investors.json";
import investorsFixture from "@/data/investors.fixture.json";
import foundersSeed from "@/data/founders.seed.json";
import debriefsSeed from "@/data/debriefs.seed.json";
import programmesData from "@/data/programmes.json";
import quotesData from "@/data/quotes.json";
import replayData from "@/data/replay/demo-pitch.json";
import dealTagsData from "@/data/deal-tags.json";
import { isSector, type Sector } from "@/lib/taxonomy";
import type {
  Deal,
  Debrief,
  FounderProfile,
  Investor,
  Programme,
  Quote,
  ReplayEvent,
} from "@/lib/types";

// The build time of data/investors.json (the --now passed to scripts/refinalize.ts). Stored
// revealed vectors and contradiction lines count deals in the 24-month window ending here, so every
// count the UI shows uses the same date instead of the viewer's clock.
export const DATA_AS_OF = new Date("2026-11-14T05:31:21.300Z");

// Overlay key for a deal's company: its Cala id, else its lowercased name.
export function dealKey(d: Pick<Deal, "company" | "companyCalaId">): string {
  return d.companyCalaId ?? `name:${d.company.trim().toLowerCase()}`;
}

// data/deal-tags.json (scripts/tag-deals.ts, Haiku) adds tags to deals and a taxonomy sector to the
// ones ingest left as "other". Revealed vectors were computed at ingest and are not recomputed.
export function withDealTags(investors: Investor[], tags: Record<string, { sector: string; tags: string[] }>): Investor[] {
  if (!Object.keys(tags).length) return investors;
  return investors.map((inv) => ({
    ...inv,
    deals: inv.deals.map((d) => {
      const t = tags[dealKey(d)];
      if (!t) return d;
      const sector: Sector = d.sector === "other" && isSector(t.sector) ? t.sector : d.sector;
      return { ...d, sector, ...(t.tags.length ? { tags: t.tags } : {}) };
    }),
  }));
}

let investorsCache: Investor[] | undefined;

export function loadInvestors(): Investor[] {
  if (investorsCache) return investorsCache;
  const real = investorsReal as unknown as Investor[];
  const base = real.length > 0 ? real : (investorsFixture as unknown as Investor[]);
  investorsCache = withDealTags(base, dealTagsData as Record<string, { sector: string; tags: string[] }>);
  return investorsCache;
}

// The investor view opens on someone a presenter can verify as (partners on record), preferring a
// London-based fund. Array order keeps the pick deterministic.
export function defaultInvestor(investors: Investor[]): Investor | undefined {
  const withPartners = investors.filter((i) => i.partners.length > 0);
  return withPartners.find((i) => /london/i.test(i.description ?? "")) ?? withPartners[0] ?? investors[0];
}

export function usingFixtures(): boolean {
  return loadInvestors().some((i) => i.fixture === true);
}

export function loadFounders(): FounderProfile[] {
  return foundersSeed as unknown as FounderProfile[];
}

export function loadDebriefs(): Debrief[] {
  return debriefsSeed as unknown as Debrief[];
}

export function loadProgrammes(): Programme[] {
  return programmesData as unknown as Programme[];
}

export function loadQuotes(): Quote[] {
  return quotesData as unknown as Quote[];
}

export function loadReplay(): ReplayEvent[] {
  return replayData as unknown as ReplayEvent[];
}
