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

export type SpotterPick = {
  company: SpotterCompany;
  scores: SpotterScores;
  precedents: SpotterPrecedent[];
  sampleSize: number;
  runs: number;
  lowConfidence: boolean;
  actions: { sharedCoInvestors: string[] };
};

export type SpotterResponse = {
  investor: SpotterInvestor;
  picks: SpotterPick[];
  asOf: string;
  basis: string;
  considered: { candidates: number; simulated: number; roundsInCohort: number };
};

export type SpotterRequest = { investorId: string } | { investorName: string };
