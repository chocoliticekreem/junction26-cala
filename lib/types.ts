import type { Sector, Stage } from "./taxonomy";

export type { Sector, Stage };

export type Source = { name: string; url?: string; date?: string };

export type Deal = {
  company: string;
  companyCalaId?: string;
  round: Stage | "unknown";
  date?: string; // ISO yyyy-mm-dd when known
  amount?: string; // raw text as Cala returned it
  amountUsd?: number; // normalised, when parseable
  sector: Sector;
  sources: Source[];
};

export type DoorKind = "programme" | "office_hours" | "scout" | "warm_intro" | "room";

export type Door = { kind: DoorKind; label: string; url?: string; via?: string[] };

export type Partner = { calaId: string; name: string; role?: string; linkedinUrl?: string };

export type InvestorKind = "fund" | "angel_network" | "accelerator" | "cvc";

export type Revealed = {
  S: Partial<Record<Sector, number>>;
  G: Partial<Record<Stage, number>>;
  chequeBand: [number, number]; // USD, IQR of round sizes
  chequeMedian?: number;
  activity: number; // 0..1
  leadShare?: number;
  dealCount24m: number;
};

export type Investor = {
  id: string;
  calaId: string;
  name: string;
  kind: InvestorKind;
  description?: string;
  website?: string;
  statedThesis: {
    text: string;
    sectors: Partial<Record<Sector, number>>;
    stages: Partial<Record<Stage, number>>;
    sources: Source[];
  };
  deals: Deal[];
  revealed: Revealed;
  contradiction: number; // 0..1, total variation distance stated vs revealed
  contradictionLine?: string; // e.g. "Says pre-seed; 9 of last 14 deals were Series A"
  thinHistory: boolean;
  partners: Partner[];
  doors: Door[];
  fixture?: true;
};

export type Traction = { revenue?: string; users?: string; growth?: string };

export type FounderProfile = {
  id: string;
  name?: string;
  company?: string;
  oneLiner?: string;
  sectors: Partial<Record<Sector, number>>; // weights sum to 1 when any are present
  stage?: Stage;
  raise?: number; // USD
  traction?: Traction;
  teamSignals: string[];
  geography?: string;
  businessModel?: string;
  confidence: Record<string, number>; // keys: sectors, stage, raise, traction, ...
  website?: string;
  email?: string;
  seeded?: true;
};

// Output of one extraction pass (LLM or keyword fallback), merged into the running profile.
export type Extraction = {
  sectors: { label: Sector; confidence: number }[];
  stage?: { value: Stage; confidence: number };
  raise_amount?: { value: number; confidence: number };
  traction?: { revenue?: string; users?: string; growth?: string; confidence: number };
  team_signals?: { value: string; confidence: number }[];
  geography?: { value: string; confidence: number };
  business_model?: { value: string; confidence: number };
  // the transcript word that triggered each detection, for chip highlighting
  triggers?: Record<string, string>;
};

export type Debrief = {
  roomId: string;
  founderId: string;
  investorId: string;
  fit: "yes" | "maybe" | "no";
  again: boolean;
  tag: "stage" | "sector" | "team" | "traction" | "timing";
  seeded: boolean;
};

export type ReplayEvent = {
  t: number; // ms from start
  kind: "transcript" | "profile";
  text?: string;
  profile?: Partial<FounderProfile>;
  extraction?: Extraction;
};

export type Programme = {
  id: string;
  name: string;
  kind: "accelerator" | "programme" | "office_hours" | "scout" | "fellowship";
  stages: Stage[];
  sectors: Sector[] | "any";
  description: string;
  url: string;
  checkedOn: string; // ISO date
  investorIds?: string[]; // investors this programme is a door into
};

export type ScoreBreakdown = {
  sectorFit: number;
  stageFit: number;
  chequeFit: number;
  activity: number;
  debriefAdj: number;
};

export type Match = {
  investorId: string;
  score: number; // 0..100
  breakdown: ScoreBreakdown;
  reason: string;
  evidence: Deal[];
};

export type Quote = { text: string; name: string; role: string; consent: boolean };

// Interest mechanism (spec 4.1)
export type InterestState =
  | "interested"
  | "accepted"
  | "pending_verification"
  | "chat_open"
  | "declined"
  | "expired";

export type Interest = {
  id: string;
  investorId: string;
  founderId: string;
  state: InterestState;
  createdAt: string;
  updatedAt: string;
};

export type Verification = {
  subjectId: string;
  side: "investor" | "founder";
  checks: { name: string; passed: boolean; detail?: string }[];
};

export type Message = { interestId: string; from: "investor" | "founder"; text: string; at: string };

export type SeatRequest = {
  roomId: string;
  founderId: string;
  state: "requested" | "seated" | "waitlisted";
  at: string;
};

export type Room = {
  id: string;
  title: string;
  sector: Sector;
  date: string;
  venue: string;
  founderIds: string[];
  investorIds: string[];
  hostInvestorId?: string;
  seeded?: true;
};
