import type { Sector, Source, Stage } from "@/lib/types";

export type SourceRank = "FILING" | "PRIMARY" | "PRESS" | "AGGREGATOR";
export type RankedSource = Source & { rank?: SourceRank };

export type ClaimBasis = "cala" | "website" | "founder";
export type Claim = { text: string; basis: ClaimBasis; source?: RankedSource };

// website > name_hq > name. The UI asks "Is this you?" unless `autoPick` is set.
export type Confidence = "website" | "name_hq" | "name";

export type CompanyCandidate = {
  calaId: string;
  name: string;
  website?: string;
  hq?: string;
  foundingDate?: string;
  description?: string;
  confidence: Confidence;
  score: number; // 0..1, ordering only
  siblingIds?: string[]; // other Cala entities with the same website (brand vs legal entity)
};

export type ResolveResult = {
  candidates: CompanyCandidate[];
  // Set only when a candidate can be picked without asking: a website match, or a sole exact-name result.
  autoPick?: string;
  mock?: true;
  budgetExhausted?: true;
};

export type ContextPerson = { name: string; calaId?: string; role?: string; source?: RankedSource };
export type ContextInvestor = { name: string; calaId?: string; round?: string; lead?: boolean; source?: RankedSource };
export type ContextRound = {
  id?: string;
  label: string;
  stage: Stage | "unknown";
  date?: string;
  amountUsd?: number;
  amountText?: string;
  leads: string[];
  investors: string[];
  sources: RankedSource[];
};

export type ContextDoc = {
  id: string; // calaId of the primary entity, else a slug of the company name
  calaIds: string[]; // every Cala entity the doc read (a brand and its legal entity can both appear)
  company: { name: string; website?: string; hq?: string; founded?: string; stage?: Stage; sector?: Sector };
  founders: ContextPerson[];
  investors: ContextInvestor[];
  rounds: ContextRound[];
  headcount?: { value: string; source?: RankedSource };
  product?: string;
  customers?: string[];
  pricing?: string;
  team?: string[];
  vision?: string;
  claims: Claim[];
  coverage: { cala: boolean; website: boolean; founder: boolean };
  updatedAt: string;
  mock?: true;
};

// What the Cala graph contributed, before it is merged with website and founder facts.
export type CalaFacts = {
  calaIds: string[];
  name: string;
  website?: string;
  hq?: string;
  founded?: string;
  description?: string;
  fundingStage?: string;
  founders: ContextPerson[];
  investors: ContextInvestor[];
  rounds: ContextRound[];
  headcount?: { value: string; source?: RankedSource };
  source?: RankedSource;
};

export type WebsiteFacts = {
  url: string;
  product?: string;
  customers: string[];
  pricing?: string;
  team: string[];
  source: RankedSource;
};

export type Upload = { name: string; text: string };

export type EventRef = { id: string; name: string; date?: string };

export type Precedent = {
  company: string;
  companyCalaId?: string;
  round: string;
  date?: string;
  led: boolean; // true only when the data marks this investor as lead; false = participated
  source?: Source;
};

export type EmailDraft = { subject: string; body: string; grounded: "llm" | "template" };

export type InvestorAction = {
  investorId: string;
  name: string;
  website?: string;
  calaSources: Source[];
  leadPartner?: { name: string; role?: string; calaId?: string };
  events?: EventRef[];
  precedent?: Precedent;
  emailDraft: EmailDraft;
  mailto: string;
};

export type WatchItem = { investorId: string; name: string; sectors: Sector[]; since: string };
export type Watchlist = { id: string; items: WatchItem[]; updatedAt: string };

export type FeedItem = {
  investorId: string;
  investorName: string;
  company: string;
  companyCalaId?: string;
  round: Stage | "unknown";
  date: string;
  amountUsd?: number;
  sector: Sector;
  led: boolean | null; // null = the data does not say who led
  sources: Source[];
};
