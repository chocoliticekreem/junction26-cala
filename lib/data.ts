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

export function loadInvestors(): Investor[] {
  const real = investorsReal as unknown as Investor[];
  return real.length > 0 ? real : (investorsFixture as unknown as Investor[]);
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
