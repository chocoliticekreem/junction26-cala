// The page builds against the engine's own contracts. Nothing here is a second copy of a shape.
import type { FounderAnalysis } from "@/lib/ai/analyzeFounder";
import type { Analysis } from "@/lib/ai/strict";
import type { CompanyCandidate, ContextDoc, FeedItem, InvestorAction, ResolveResult, Upload } from "@/lib/context/types";
import type { NetworkEdge, NetworkNode as EngineNetworkNode } from "@/lib/sim/network";
import type { Decision, DecisionNode, InvestorKind, Precedent, Reality, RealityStep, SimResult, Vision, VisionBasis } from "@/lib/sim/types";
import type { FounderProfile } from "@/lib/types";

export type { Analysis, CompanyCandidate, ContextDoc, Decision, DecisionNode, FeedItem, FounderAnalysis, InvestorAction, InvestorKind, Precedent, Reality, RealityStep, ResolveResult, SimResult, Upload, Vision, VisionBasis };
export type { NetworkEdge };

// The map's force layout writes positions onto the nodes it is given.
export type NetworkNode = EngineNetworkNode & { x?: number; y?: number };

export type Highway = SimResult["highways"][number];
export type NetworkData = { nodes: NetworkNode[]; edges: NetworkEdge[] };

// POST /api/simulate adds the parsed vision, the pitch analysis and which reader answered.
export type SimulateResponse = SimResult & {
  vision: Vision;
  visionSource: "llm" | "keyword";
  analysis?: Analysis;
  analysisDetail?: { vision?: Analysis; founder?: Analysis; fallbackReasons?: string[] };
  founder?: FounderAnalysis;
  cached?: boolean;
};

export type SimulateBody = { profile: FounderProfile; pitchText?: string; visionText: string; decision?: Decision; companyName?: string };

export type ContextBuildBody = { calaId?: string; name?: string; website?: string; pitchProfile?: FounderProfile; visionText?: string; uploads?: Upload[] };

export const YOU_ID = "you";
