// Shared contract types for Room Path. The cohort block is a verbatim copy of Track A's
// lib/cohortTypes.ts; on merge, replace it with a re-export from there.
import type { Sector, Source, Stage } from "@/lib/types";
import type { BaseRate, OutcomePopulation, ReLeadRate } from "./calibration";
import type { SizeBands } from "./stageSize";
import type { GeoCounts, Region } from "./geo";

export type InvestorKind = "fund" | "angel" | "accelerator" | "cvc" | "unknown";

export type SourceRank = "FILING" | "PRIMARY" | "PRESS" | "AGGREGATOR";

export type CohortParticipant = {
  investorId: string; // Cala entity id, or "name:<key>" when Cala named the investor without an id
  name: string;
  kind: InvestorKind;
  isLead?: boolean;
};

export type CohortRound = {
  id: string; // Cala FundingRound id, or "q:<hash>" for a round read from a knowledge/query row
  companyId: string;
  stage: Stage | "unknown";
  label: string;
  date?: string; // ISO yyyy-mm-dd
  datePrecision?: "day" | "month" | "year";
  amountUsd?: number;
  valuationUsd?: number; // as Cala reports it (post-money where stated), USD
  participants: CohortParticipant[];
  participantsDropped?: number; // generic cells ("existing investors", "angels") not kept as investors
  sources: (Source & { rank?: SourceRank })[];
};

export type CohortSampledBy = "seed-sample" | "cala-network" | "london-portfolio" | "must-include";

export type UnicornFlag = { value: boolean; basis: "valuation" | "known_list"; source?: Source };

export type CohortCompany = {
  id: string; // Cala Company id, or "name:<key>" when Cala named the company without an id
  name: string;
  sector: Sector;
  description?: string;
  hq?: string;
  country?: string; // derived from hq, e.g. "United Kingdom", "Spain"
  foundingDate?: string;
  totalFundingUsd?: number;
  fundingStage?: string;
  headcount?: { date: string; value: number }[];
  status: "active" | "acquired" | "closed" | "unknown";
  maxValuationUsd?: number;
  isUnicorn?: UnicornFlag;
  sampledBy?: CohortSampledBy;
  tags?: string[]; // fine-grained domain from scripts/tag-cohort.ts (Haiku), e.g. "EEG", "neurotech"
  roundIds: string[]; // chronological
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

export type StartState = {
  sectors: Partial<Record<Sector, number>>;
  stage: Stage;
  raiseUsd?: number;
  companyId?: string;
  existingInvestorIds?: string[];
  asOf?: string;
  // Free-text location of the founder ("London", "Barcelona, Spain"); a cohort company's hq is used
  // when absent. Weights lead candidates by their real deal geography (see geo.ts).
  geography?: string;
  // What the company does, for "companies like you" (lib/sim/similarity.ts).
  tags?: string[];
  description?: string;
};

export type Vision = {
  text: string;
  targetStage: Stage;
  targetHeadcount?: number;
  targetFundingUsd?: number;
  targetValuationUsd?: number;
  targetRevenueUsd?: number;
  goesPublic?: boolean;
  profitable?: boolean; // profitable / bootstrapped: funding is optional on this path
  horizonYears: number;
  sector?: Sector;
  // One human line for the UI, e.g. "Unicorn = valuation of $1B or more".
  interpretation?: string;
};

export type FirstChequeOption = "angel" | "accelerator" | "fund";
export type TimingOption = "now" | "later_6m";

export type Decision =
  | { kind: "first_cheque"; option: FirstChequeOption }
  | { kind: "timing"; option: TimingOption }
  | { kind: "lead"; investorId: string };

export type PathStep = {
  stage: Stage;
  leadId?: string;
  leadName?: string;
  coInvestorIds: string[];
  monthFromStart: number;
  amountUsd?: number;
};

export type SimPath = { steps: PathStep[]; reachedVision: boolean; stalledAtStage?: Stage; count: number; share: number };

export type Precedent = {
  companyId: string;
  name: string;
  sector: Sector;
  reachedVision: boolean;
  // Text similarity (tags + description) to the founder, 0..1; present when the founder gave any.
  similarity?: number;
  // True when no closer same-domain company was left and this one only shares the sector family
  // (or less): shown as a looser comparison.
  fallback?: boolean;
  // source: the round's first sourced URL, else "Cala knowledge query" (query rows carry no URL).
  path: { stage: Stage; leadName?: string; date?: string; roundId: string; source?: { name: string; url?: string } }[];
};

export type DecisionNode = {
  decision: Decision | null;
  label: string;
  runs: number;
  reachVisionShare: number;
  medianMonthsToNextRound?: number;
  outcomeBands: { best: string; median: string; worst: string };
  // Distinct real cohort companies whose rounds inform this branch (not simulated runs).
  sampleSize: number;
  lowConfidence: boolean;
  // 95% Wilson interval for reachVisionShare with n = sampleSize: the uncertainty that comes from
  // how few real companies sit behind the branch, not Monte Carlo noise.
  confidenceBand: { lo: number; hi: number };
  children: DecisionNode[];
  topPaths: SimPath[];
};

// How "reached the vision" is judged. valuation: a sourced cohort valuation >= target (precedents)
// and, in simulated runs, total raised >= the median total raised of cohort companies that hit it.
// proxy: no valuation data, so Series B+ with total raised >= PROXY_FUNDING_USD. stage: target stage only.
export type VisionBasis = {
  kind: "stage" | "valuation" | "proxy";
  targetStage: Stage;
  targetValuationUsd?: number;
  fundingThresholdUsd?: number;
  text: string;
};

export type RealityStep = {
  year: number;
  monthFromStart: number;
  stage: Stage;
  label: string;
  leadId?: string;
  leadName?: string;
  amountBand?: string;
  headcountBand?: string;
};

export type Reality = {
  title: string;
  outcome: "reached_vision" | "stalled" | "horizon";
  probability: number;
  runs: number;
  steps: RealityStep[];
  outcomeLine: string;
  // Chip-length form of outcomeLine ("Stalls · no round in 24 mo"); older cached runs lack it.
  outcomeShort?: string;
  precedents: { companyId: string; name: string; roundIds: string[] }[];
  // True when at least one named precedent is a looser, out-of-domain match.
  precedentsFallback?: boolean;
  sampleSize: number;
  lowConfidence: boolean;
};

export type Calibration = {
  // Which companies set outcome rates (seed-sample = drawn without regard to outcome).
  outcomePopulation: { kind: OutcomePopulation; companies: number };
  // The per-stage P(raise next round) the engine used, and where each came from.
  baseRates: BaseRate[];
  // Founders: the round being raised now is assumed to close (the cohort has no failed first rounds).
  conditionalOnFirstRound: boolean;
  reLead: ({ from: Stage } & ReLeadRate)[];
  leadFilter: { candidates: number; droppedGeneric: number; droppedNonInvestor: number; droppedThin: number };
  geography: { input?: string; country?: string; region?: Region; applied: boolean };
  sampleSizeMeaning: string;
  // P(raise next | stage, round-size tercile) from the outcome population (fit.ts).
  sizeRates: SizeRates;
  // The current round's size factor and lead-quality factor applied to the start state.
  startFactors?: {
    stage: Stage;
    amountUsd?: number;
    tercile?: 0 | 1 | 2;
    sizeFactor: number;
    lead?: { id: string; name: string; lift: number; evidence: number; kindLift: number };
  };
  notes: string[];
};

export type SizeTier = { tercile: 0 | 1 | 2; loUsd: number; hiUsd: number; n: number; raised: number; factor: number; p: number };
export type SizeRates = Partial<Record<Stage, { n: number; raised: number; tiers: SizeTier[] }>>;

export type SimResult = {
  asOf: string;
  runs: number;
  start: {
    stage: Stage;
    // The stage the engine starts from after the size check (stageSize.ts); differs from the label
    // when the round's amount belongs to the next stage.
    effectiveStage?: Stage;
    stageNote?: string;
    companyId?: string;
    companyName?: string;
    existingInvestors: { id: string; name: string }[];
  };
  visionBasis: VisionBasis;
  tree: DecisionNode;
  realities: Reality[];
  highways: { from: string; to: string; weight: number }[];
  precedents: Precedent[];
  explanation?: string[];
  calibration: Calibration;
  fixture: boolean;
};

// ---- Fitted model (engine-internal, exported for tests and the network route) ----

// One observed "company closed a round at stage s" event and what happened next.
// raised: a later round at a higher stage exists before asOf. stalled: none, and asOf is at least
// STALL_MONTHS after the company's last round (or it closed). Censored events (too recent to tell)
// are kept out of every rate.
export type Transition = {
  companyId: string;
  sector: Sector;
  stage: Stage;
  roundId: string;
  leadId?: string;
  memberIds: string[];
  outcome: "raised" | "stalled" | "censored";
  // Outcome known at asOf without survivorship bias: stalled, or raised from a round at least
  // STALL_MONTHS old. Only knowable transitions feed the calibrated raise rates.
  knowable: boolean;
  // USD raised in the episode (its rounds at this stage), when known; sets the size tercile.
  amountUsd?: number;
  months?: number;
  nextStage?: Stage;
  nextLeadId?: string;
  nextMemberIds?: string[];
  stepUp?: number;
};

export type FollowOnStats = {
  observed: number;
  raisedWithin24m: number;
  pNextWithin24m: number;
  medianMonthsToNext?: number;
  medianStepUp?: number;
  nextLeads: Record<string, number>;
  reUpRate: number;
};

export type Agent = {
  id: string;
  name: string;
  kind: InvestorKind;
  rounds: number;
  led: number;
  stageDist: Partial<Record<Stage, number>>;
  leadStageCounts: Partial<Record<Stage, number>>;
  sectorDist: Partial<Record<Sector, number>>;
  chequeBand?: [number, number];
  chequeMedian?: number;
  pacePerYear: number;
  coInvestors: Record<string, number>;
  followOn: FollowOnStats;
  // Raise rate of companies it led vs the sector/stage base rate; 1 = average.
  raiseLift: number;
  raiseLiftEvidence: number;
  // Passes the lead quality filter (quality.ts): a resolved Cala entity or >= 2 rounds.
  leadEligible: boolean;
  geo: GeoCounts;
  // USD sizes of the rounds it led, by effective stage (simulate.ts sizeFit).
  ledAmounts: Partial<Record<Stage, number[]>>;
};

// Where the lead of a round at a stage is based, relative to the company: same country, another
// country in the same region, elsewhere (fit.ts leadGeoShares).
export type LeadGeoShares = { n: number; country: number; region: number; elsewhere: number };

export type TransitionStats = {
  n: number;
  raised: number;
  stalled: number;
  pRaise: number;
  months: number[];
  nextStage: Partial<Record<Stage, number>>;
};

// A company's stay at one stage: the first round at a new (higher) stage opens an episode, later
// rounds at the same stage join it. Every Series B+ round opens its own episode, so B+ -> B+
// follow-on rounds are transitions too.
export type Episode = {
  stage: Stage;
  roundIds: string[];
  dateMs: number;
  lastDateMs: number;
  leadId?: string;
  memberIds: string[];
  amountUsd?: number;
  valuationUsd?: number;
};

export type SimModel = {
  asOf: string;
  asOfMs: number;
  agents: Agent[];
  agentIndex: Record<string, number>;
  episodes: Record<string, Episode[]>;
  transitions: Transition[];
  bySectorStage: Record<string, TransitionStats>;
  byStage: Partial<Record<Stage, TransitionStats>>;
  // tie[i][j] = (weighted) times a company with i on its round at stage s had j lead its next round.
  ties: Record<string, Record<string, number>>;
  tieTotals: Record<string, number>;
  kindTies: Partial<Record<InvestorKind, Record<string, number>>>;
  kindTieTotals: Partial<Record<InvestorKind, number>>;
  kindRaiseLift: Partial<Record<InvestorKind, number>>;
  // Calibrated P(raise next | stage), see calibration.ts. byStage / bySectorStage keep the raw
  // cohort counts; the engine scales the calibrated rate by the knowable sector/stage ratio.
  baseRates: Partial<Record<Stage, BaseRate>>;
  // Companies allowed to set outcome rates: the outcome-blind seed sample when the cohort has one.
  outcomePopulation: { kind: OutcomePopulation; companies: number };
  // Gaps between rounds from the outcome population, backing off to all cohort gaps when thin.
  gapsByStage: Partial<Record<Stage, number[]>>;
  gapsBySectorStage: Record<string, number[]>;
  knowableByStage: Partial<Record<Stage, { n: number; raised: number }>>;
  knowableBySectorStage: Record<string, { n: number; raised: number }>;
  reLead: { byStage: Partial<Record<Stage, ReLeadRate>>; overall: ReLeadRate };
  geoBase: GeoCounts;
  dropped: { generic: number; nonInvestor: number };
  stageAmounts: Partial<Record<Stage, number[]>>;
  // Round sizes by label (sets the effective stage) and episode sizes by effective stage (sets the
  // size tercile); see stageSize.ts.
  labelBands: SizeBands;
  episodeBands: SizeBands;
  sizeRates: SizeRates;
  // Amounts of a company's 1st, 2nd, 3rd and 4th+ Series B+ rounds (later rounds are larger).
  bPlusAmounts: number[][];
  stageHeadcounts: Partial<Record<Stage, number[]>>;
  stageCoInvestorCounts: Partial<Record<Stage, number[]>>;
  // Sizes of rounds led by each investor kind, by stage: backoff for an investor with no sized lead.
  kindLedAmounts: Partial<Record<InvestorKind, Partial<Record<Stage, number[]>>>>;
  // Next-round size / this-round size, by the stage of this round (next stage one above it).
  stepUps: Partial<Record<Stage, number[]>>;
  // Measured lead geography by the stage of the round led, plus all stages pooled.
  leadGeoShares: { byStage: Partial<Record<Stage, LeadGeoShares>>; overall: LeadGeoShares };
  cohort: Cohort;
};
