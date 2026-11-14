// View model for the spotter page: what the components render, built from /api/spotter by adapt.ts.
export type SpotterShare = { label: string; share: number };

export type SpotterTaste = {
  sectors: SpotterShare[];
  stages: SpotterShare[];
  entryStage?: string;
  chequeBand?: string;
  leadShare: number;
};

export type SpotterInvestor = { id: string; name: string; kind: string; rounds: number; companies: number; lowConfidence: boolean; taste: SpotterTaste };

export type SpotterCompany = {
  id: string;
  name: string;
  sector: string;
  city?: string;
  rounds: string[];
  latestRound: { stage: string; date?: string; leadName?: string };
  investors: string[];
};

// All 0..100.
export type SpotterScores = { fit: number; shape: number; unicornOdds: number; youOnPath: number; total: number };

export type SpotterPrecedent = { id: string; name: string; outcome: "unicorn" | "stalled"; steps: string[] };

export type SpotterEvent = { name: string; date: string; place: string };

export type SpotterPick = {
  company: SpotterCompany;
  event?: SpotterEvent;
  scores: SpotterScores;
  precedents: SpotterPrecedent[];
  sampleSize: number;
  runs: number;
  lowConfidence: boolean;
  actions: { sharedCoInvestors: string[] };
};

export type SpotterInvite = { id: string; name: string; stage: string; year?: string; atSlush: boolean };

// One event the fund could host: a sector lane from its taste, with the founders to invite.
export type SpotterHost = { sector: string; name: string; count: number; atSlush: number; companies: SpotterInvite[] };

export type SpotterResponse = {
  investor: SpotterInvestor;
  picks: SpotterPick[];
  host: SpotterHost[];
  asOf: string;
  basis: string;
  considered: { candidates: number; simulated: number; roundsInCohort: number };
};

// `at` restricts the picks to companies attending that Cala event (today: "slush-2026").
export type SpotterRequest = ({ investorId: string } | { investorName: string }) & { at?: string };
