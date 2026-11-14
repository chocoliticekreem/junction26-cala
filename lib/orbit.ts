import { angularTarget, computeHalos, dominantSector, radialTarget, sectorAngle, type GraphNode, type Halo } from "./physics";
import { SECTOR_SHORT, STAGE_LABELS, STAGES, type Sector, type Stage } from "./taxonomy";
import type { FounderProfile } from "./types";
import type { FounderMatch } from "./scoring";

export const INVESTOR_CENTER_ID = "__investor__";
export const ORBIT_TOP_N = 8;
export const GROUP_HALO_MIN = 2;

export type OrbitGroupBy = "none" | "sector" | "stage";

// Founders reuse the GraphNode shape so lib/physics forces drive them unchanged: the
// centre investor is kind "founder" (pinned, skipped by the forces) and every founder
// is kind "investor" (pulled to its radial and angular targets).
export type OrbitNode = GraphNode & {
  sectors: Partial<Record<Sector, number>>;
  stage?: Stage;
  live: boolean;
};

export type StageArc = { stage: StageKey; label: string; count: number; angle: number; halfWidth: number };

export type GroupHalo = Halo & { label: string };

export type StageKey = Stage | "unknown";

// Only the stages present in the pool get an arc, so two stages split the circle in
// half rather than crowding into two of six slots. Order follows STAGES; "unknown" last.
export function presentStages(nodes: OrbitNode[]): StageKey[] {
  const seen = new Set<StageKey>();
  for (const n of nodes) if (n.kind === "investor") seen.add(n.stage ?? "unknown");
  return [...STAGES, "unknown" as const].filter((s) => seen.has(s));
}

export function stageAngle(stage: StageKey, present: StageKey[]): number {
  const slots = Math.max(1, present.length);
  const i = present.indexOf(stage);
  const slot = i === -1 ? slots - 1 : i;
  return (slot / slots) * Math.PI * 2 - Math.PI / 2;
}

export function stageArcHalfWidth(present: StageKey[]): number {
  return Math.PI / Math.max(1, present.length);
}

export function orbitAngularTarget(n: OrbitNode, groupBy: OrbitGroupBy, present: StageKey[]): number {
  if (groupBy === "sector") return sectorAngle(n.sector);
  if (groupBy === "stage") return stageAngle(n.stage ?? "unknown", present);
  return angularTarget(n.sectors);
}

export function makeOrbitNodes(investorName: string, founders: FounderProfile[], liveId: string): OrbitNode[] {
  const centre: OrbitNode = {
    id: INVESTOR_CENTER_ID,
    kind: "founder",
    name: investorName,
    sector: "other",
    sectors: {},
    score: 100,
    rank: -1,
    targetR: 0,
    targetA: 0,
    fx: 0,
    fy: 0,
    x: 0,
    y: 0,
    live: false,
  };
  const list = founders.map<OrbitNode>((f) => ({
    id: f.id,
    kind: "investor",
    name: f.company ?? f.name ?? f.id,
    sector: dominantSector(f.sectors),
    sectors: f.sectors,
    stage: f.stage,
    score: 50,
    rank: Infinity,
    targetR: radialTarget(50),
    targetA: angularTarget(f.sectors),
    live: f.id === liveId,
  }));
  return [centre, ...list];
}

export function applyFounderMatches(byId: Map<string, OrbitNode>, matches: FounderMatch[], groupBy: OrbitGroupBy, snap: boolean) {
  const present = presentStages([...byId.values()]);
  matches.forEach((m, i) => {
    const n = byId.get(m.founderId);
    if (!n) return;
    n.score = Math.round(m.score);
    n.rank = i;
    n.targetR = radialTarget(m.score);
    n.targetA = orbitAngularTarget(n, groupBy, present);
    if (snap) {
      n.x = Math.cos(n.targetA) * n.targetR;
      n.y = Math.sin(n.targetA) * n.targetR;
      n.vx = 0;
      n.vy = 0;
    }
  });
}

// Ungrouped: the founder-view rule (dense sector clusters near the centre). Grouped by
// sector: every sector with at least GROUP_HALO_MIN founders gets a halo wherever it sits.
export function computeSectorHalos(nodes: OrbitNode[], groupBy: OrbitGroupBy): GroupHalo[] {
  if (groupBy !== "sector") {
    return computeHalos(nodes).map((h) => ({ ...h, label: `${SECTOR_SHORT[h.sector]} · ${h.count} founders` }));
  }
  const groups = new Map<Sector, OrbitNode[]>();
  for (const n of nodes) {
    if (n.kind !== "investor" || n.x === undefined || n.y === undefined) continue;
    groups.set(n.sector, [...(groups.get(n.sector) ?? []), n]);
  }
  const halos: GroupHalo[] = [];
  for (const [sector, list] of groups) {
    if (list.length < GROUP_HALO_MIN) continue;
    let cx = 0;
    let cy = 0;
    for (const n of list) {
      cx += n.x!;
      cy += n.y!;
    }
    cx /= list.length;
    cy /= list.length;
    let r = 0;
    for (const n of list) r = Math.max(r, Math.hypot(n.x! - cx, n.y! - cy));
    halos.push({ sector, count: list.length, cx, cy, r: r + 24, label: `${SECTOR_SHORT[sector]} · ${list.length}` });
  }
  return halos;
}

export function computeStageArcs(nodes: OrbitNode[]): StageArc[] {
  const present = presentStages(nodes);
  const counts = new Map<StageKey, number>();
  for (const n of nodes) {
    if (n.kind !== "investor") continue;
    const k = n.stage ?? "unknown";
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return present.map((stage) => ({
    stage,
    count: counts.get(stage) ?? 0,
    label: stage === "unknown" ? "Stage unknown" : STAGE_LABELS[stage],
    angle: stageAngle(stage, present),
    halfWidth: stageArcHalfWidth(present),
  }));
}
