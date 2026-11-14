// The page builds against the engine's own contracts. Nothing here is a second copy of a shape.
import type { CompanyCandidate, ContextDoc, FeedItem, InvestorAction, ResolveResult, Upload } from "@/lib/context/types";
import type { NetworkEdge, NetworkNode as EngineNetworkNode } from "@/lib/sim/network";
import type { Decision, DecisionNode, InvestorKind, Precedent, Reality, RealityStep, SimResult, Vision, VisionBasis } from "@/lib/sim/types";
import type { FounderProfile } from "@/lib/types";

export type { CompanyCandidate, ContextDoc, Decision, DecisionNode, FeedItem, InvestorAction, InvestorKind, Precedent, Reality, RealityStep, ResolveResult, SimResult, Upload, Vision, VisionBasis };
export type { NetworkEdge };

// The map's force layout writes positions onto the nodes it is given.
export type NetworkNode = EngineNetworkNode & { x?: number; y?: number };

export type Highway = SimResult["highways"][number];
export type NetworkData = { nodes: NetworkNode[]; edges: NetworkEdge[] };

// POST /api/simulate adds the parsed vision to the engine result.
export type SimulateResponse = SimResult & { vision: Vision; visionSource: "llm" | "keyword"; cached?: boolean };

export type SimulateBody = { profile: FounderProfile; visionText: string; decision?: Decision; companyName?: string };

export type ContextBuildBody = { calaId?: string; name?: string; website?: string; pitchProfile?: FounderProfile; visionText?: string; uploads?: Upload[] };

export const YOU_ID = "you";
