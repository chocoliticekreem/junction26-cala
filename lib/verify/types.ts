import type { SourceRank, Stage } from "@/lib/types";

export type TrustLevel = "verified" | "corroborated" | "single_source" | "unverified" | "conflict";

export type EntityConfidence = "website" | "name_hq" | "name";

export type TrustChecks = {
  sourceMentionsSubject?: boolean; // true: a checked source names the subject; false: one was checked and does not
  sourceRank?: SourceRank; // best rank among the sources that confirm the claim (else among all sources)
  corroborations: number; // independent sites (registrable domains) that confirm the claim
  entityConfidence?: EntityConfidence;
  dateSane: boolean;
  amountSane: boolean;
  leadAnswers?: number; // other answers (query rows, FundingRound is_lead) that name a lead for this round
};

// Field-level trust where one field is less reliable than the claim (Cala's query answers disagree
// on leads far more often than on the round itself). The round can be shown while its lead is not.
export type FieldTrust = { lead?: TrustLevel };

export type Trust = { level: TrustLevel; reasons: string[]; checks: TrustChecks; fields?: FieldTrust };

export type ClaimSource = { name: string; url?: string; date?: string; rank?: SourceRank };

// One factual statement the app may show: a deal, a funding round, a founder, an investor, a headcount.
export type Claim = {
  id: string;
  kind: "deal" | "round" | "founder" | "investor" | "headcount";
  subject: string; // the company the claim is about
  person?: string; // founder claims: the person who must also be named
  investors?: string[];
  leads?: string[];
  stage?: Stage | "unknown";
  label?: string; // the round's own name ("Series D Extension"), for matching answers to rounds
  date?: string;
  datePrecision?: "day" | "month" | "year";
  announcementDate?: string; // when Cala gives both, so a year-pinned event_date can be caught
  amountUsd?: number;
  amountText?: string;
  sources: ClaimSource[];
  fromQuery?: boolean; // a knowledge/query row: Cala returns no per-row source
  leadFrom?: "query" | "graph"; // where `leads` came from: a query row's text, or FundingRound is_lead
  leadAnswers?: string[][]; // lead sets other answers give for the same round (cross-query check)
  fixture?: boolean;
  entityConfidence?: EntityConfidence;
  entityWarnings?: string[];
};

// What a source check found. "title" checks read the source's title as Cala returned it (free);
// "page" checks fetched the page; "haiku" means a page check settled by Haiku on an excerpt.
export type SourceCheck = {
  url: string;
  method: "title" | "page" | "haiku";
  status: "ok" | "unreachable" | "not_specific"; // not_specific: a bare homepage, nothing to check
  mentionsSubject?: boolean;
  mentionsAmount?: boolean;
  mentionsInvestor?: boolean;
  mentionsPerson?: boolean;
  note?: string;
};

export type VerifyFile = {
  version: 1;
  generatedAt: string;
  asOf: string;
  summary: Record<string, Record<TrustLevel, number>>;
  evidence: Record<string, SourceCheck[]>;
  trust: Record<string, Trust>;
};
