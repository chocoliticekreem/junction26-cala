// Investor network for the map: top investors by rounds, with co-invest and follow-on edges.
import type { Sector } from "@/lib/taxonomy";
import type { InvestorKind, SimModel } from "./types";

export type NetworkNode = { id: string; name: string; kind: InvestorKind; sector: Sector; ledCount: number; rounds: number };
export type NetworkEdge = { from: string; to: string; kind: "coinvest" | "follow_on"; weight: number };
export type Network = { nodes: NetworkNode[]; edges: NetworkEdge[]; asOf: string; fixture?: boolean };

export const MAX_NODES = 250;
export const MAX_EDGES = 2000;

export function buildNetwork(model: SimModel, maxNodes = MAX_NODES): Network {
  const top = model.agents.slice(0, maxNodes);
  const inSet = new Set(top.map((a) => a.id));
  const nodes: NetworkNode[] = top.map((a) => {
    const sector = (Object.entries(a.sectorDist) as [Sector, number][]).sort((x, y) => y[1] - x[1])[0]?.[0] ?? "other";
    return { id: a.id, name: a.name, kind: a.kind, sector, ledCount: a.led, rounds: a.rounds };
  });
  const edges: NetworkEdge[] = [];
  for (const a of top) {
    for (const [b, w] of Object.entries(a.coInvestors)) {
      if (a.id < b && inSet.has(b)) edges.push({ from: a.id, to: b, kind: "coinvest", weight: w });
    }
    for (const [b, w] of Object.entries(model.ties[a.id] ?? {})) {
      if (b !== a.id && inSet.has(b)) edges.push({ from: a.id, to: b, kind: "follow_on", weight: Math.round(w * 10) / 10 });
    }
  }
  edges.sort((x, y) => y.weight - x.weight || x.from.localeCompare(y.from) || x.to.localeCompare(y.to));
  return { nodes, edges: edges.slice(0, MAX_EDGES), asOf: model.asOf };
}
