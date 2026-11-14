// Cohort shape and loader for the spotter.
// reconcile: the types are a verbatim copy of Track A's lib/cohortTypes.ts and the loader mirrors
// Track B's lib/cohort.ts. On merge, re-export both from there and delete this file's bodies.
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Sector, Source, Stage } from "@/lib/types";

export type InvestorKind = "fund" | "angel" | "accelerator" | "cvc" | "unknown";

export type SourceRank = "FILING" | "PRIMARY" | "PRESS" | "AGGREGATOR";

export type CohortParticipant = {
  investorId: string;
  name: string;
  kind: InvestorKind;
  isLead?: boolean;
};

export type CohortRound = {
  id: string;
  companyId: string;
  stage: Stage | "unknown";
  label: string;
  date?: string;
  datePrecision?: "day" | "month" | "year";
  amountUsd?: number;
  valuationUsd?: number;
  participants: CohortParticipant[];
  sources: (Source & { rank?: SourceRank })[];
};

export type UnicornFlag = { value: boolean; basis: "valuation" | "known_list"; source?: Source };

export type CohortCompany = {
  id: string;
  name: string;
  sector: Sector;
  description?: string;
  hq?: string;
  foundingDate?: string;
  totalFundingUsd?: number;
  fundingStage?: string;
  headcount?: { date: string; value: number }[];
  status: "active" | "acquired" | "closed" | "unknown";
  maxValuationUsd?: number;
  isUnicorn?: UnicornFlag;
  roundIds: string[];
  sources: Source[];
};

export type CohortInvestor = { id: string; name: string; kind: InvestorKind; investorsJsonId?: string };

export type Cohort = {
  version: 1;
  asOf: string;
  companies: Record<string, CohortCompany>;
  rounds: Record<string, CohortRound>;
  investors: Record<string, CohortInvestor>;
};

let cached: { cohort: Cohort; fixture: boolean } | null | undefined;

function readJson(file: string): Cohort | undefined {
  try {
    const c = JSON.parse(readFileSync(path.join(process.cwd(), "data", file), "utf8")) as Cohort;
    return c?.companies && Object.keys(c.companies).length > 0 ? c : undefined;
  } catch {
    return undefined;
  }
}

// data/cohort.json (Track A's ingest), else Track B's synthetic fixture. Read at runtime so the
// build never depends on either file existing.
export function loadSpotterCohort(): { cohort: Cohort; fixture: boolean } | null {
  if (cached !== undefined) return cached;
  const real = readJson("cohort.json");
  const fixture = real ? undefined : readJson("cohort.fixture.json");
  cached = real ? { cohort: real, fixture: false } : fixture ? { cohort: fixture, fixture: true } : null;
  return cached;
}
