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

export type SpotterInvite = { id: string; name: string; stage: string; year?: string; events: { id: string; name: string; date: string }[] };

// One event the fund could host: a sector lane from its taste, with the founders to invite.
export type SpotterHost = { sector: string; name: string; count: number; attending: number; companies: SpotterInvite[] };

// A Cala event with an attendee list, and how many of the fund's fit companies attend.
export type SpotterEventRow = { id: string; name: string; date: string; place: string; source: { name: string; url: string }; attendees: number; attending: number };

export type SpotterResponse = {
  investor: SpotterInvestor;
  picks: SpotterPick[];
  host: SpotterHost[];
  events: SpotterEventRow[];
  asOf: string;
  basis: string;
  considered: { candidates: number; simulated: number; roundsInCohort: number };
};

// `event` restricts the picks to companies attending that Cala event (an id from the response's events).
export type SpotterRequest = ({ investorId: string } | { investorName: string }) & { event?: string };
