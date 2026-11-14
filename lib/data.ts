import investorsReal from "@/data/investors.json";
import investorsFixture from "@/data/investors.fixture.json";
import foundersSeed from "@/data/founders.seed.json";
import debriefsSeed from "@/data/debriefs.seed.json";
import programmesData from "@/data/programmes.json";
import quotesData from "@/data/quotes.json";
import replayData from "@/data/replay/demo-pitch.json";
import type {
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

export function loadInvestors(): Investor[] {
  const real = investorsReal as unknown as Investor[];
  return real.length > 0 ? real : (investorsFixture as unknown as Investor[]);
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
