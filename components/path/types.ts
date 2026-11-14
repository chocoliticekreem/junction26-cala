// Mirrors the shared Room Path contract (lib/sim + /api/simulate + /api/network) so the UI can
// build against the mock and swap to the engine's exports with one import change.
import type { FounderProfile, Sector, Stage } from "@/lib/types";

export type InvestorKind = "fund" | "angel" | "accelerator" | "cvc" | "unknown";

export type Decision =
  | { kind: "first_cheque"; option: "angel" | "accelerator" | "fund" }
  | { kind: "timing"; option: "now" | "later_6m" }
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
  path: { stage: Stage; leadName?: string; date?: string; roundId: string }[];
};

export type DecisionNode = {
  decision: Decision | null;
  label: string;
  runs: number;
  reachVisionShare: number;
  medianMonthsToNextRound?: number;
  outcomeBands: { best: string; median: string; worst: string };
  sampleSize: number;
  lowConfidence: boolean;
  children: DecisionNode[];
  topPaths: SimPath[];
};

export type Highway = { from: string; to: string; weight: number };

export type RealityStep = { year: number; stage: Stage; leadName?: string; amountBand?: string; headcountBand?: string };

export type Reality = {
  id: string;
  label: string;
  probability: number;
  outcome: string;
  steps: RealityStep[];
  precedents: { name: string; companyId: string }[];
};

export type SimResult = {
  asOf: string;
  runs: number;
  tree: DecisionNode;
  highways: Highway[];
  precedents: Precedent[];
  explanation?: string[];
  realities?: Reality[];
  visionBasis?: string;
  fixture: boolean;
};

// Start state the engine resolves for a named company (shown before the interview).
export type CompanyState = {
  found: boolean;
  name: string;
  founded?: string;
  hq?: string;
  stage?: Stage;
  backers: { id?: string; name: string }[];
  companyId?: string;
};

export type NetworkNode = { id: string; name: string; kind: InvestorKind; sector: Sector; ledCount: number; x?: number; y?: number };
export type NetworkEdge = { from: string; to: string; kind: "coinvest" | "follow_on"; weight: number };
export type NetworkData = { nodes: NetworkNode[]; edges: NetworkEdge[] };

export type SimulateBody = { profile: FounderProfile; visionText: string; decision?: Decision; companyName?: string };

export const YOU_ID = "you";

// Track D panels: company resolve, context doc, next-move actions.
export type CompanyCandidate = { calaId: string; name: string; website?: string; hq?: string; foundingDate?: string; description?: string; confidence: number };

export type Basis = "Cala" | "Website" | "You";
export type ContextClaim = { text: string; basis: Basis };
export type ContextDoc = {
  id: string;
  company: ContextClaim;
  founders: ContextClaim[];
  investors: ContextClaim[];
  rounds: ContextClaim[];
  product: ContextClaim[];
  vision?: ContextClaim;
};
export type ContextBuildBody = { calaId?: string; website?: string; pitchProfile?: FounderProfile; visionText?: string; uploads?: { name: string; text: string }[] };

export type ActionCard = {
  investorId: string;
  name: string;
  website?: string;
  calaSources: { name: string; url?: string }[];
  leadPartner?: string;
  events?: { id: string; name: string; date?: string }[];
  precedent?: { name: string; companyId: string };
  emailDraft: { subject: string; body: string };
  mailto: string;
};
export type WatchEvent = { at: string; text: string };
