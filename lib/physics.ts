import { SECTORS, type Sector } from "./taxonomy";

export const R_MAX = 420;
export const RADIAL_STRENGTH = 0.08;
export const ANGULAR_STRENGTH = 0.03;
export const HALO_RADIUS = 0.35 * R_MAX;
export const HALO_MIN = 5;

export type GraphNode = {
  id: string;
  kind: "founder" | "investor";
  name: string;
  sector: Sector;
  score: number;
  rank: number;
  targetR: number;
  targetA: number;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number;
  fy?: number;
};

export function radialTarget(score: number): number {
  const s = Math.min(100, Math.max(0, score)) / 100;
  return R_MAX * Math.pow(1 - s, 1.3);
}

// Each taxonomy sector owns an equal arc, walked clockwise from the top in taxonomy
// order (which already puts related sectors next to each other). "other" sits between
// the last and first arc.
export function sectorAngle(sector: Sector): number {
  const i = (SECTORS as readonly string[]).indexOf(sector);
  const slot = i === -1 ? SECTORS.length : i;
  return (slot / (SECTORS.length + 1)) * Math.PI * 2 - Math.PI / 2;
}

export function sectorArcHalfWidth(): number {
  return Math.PI / (SECTORS.length + 1);
}

// Circular weighted mean of the sector arcs an investor's revealed deals fall into.
export function angularTarget(S: Partial<Record<Sector, number>>): number {
  let x = 0;
  let y = 0;
  for (const [sector, w] of Object.entries(S) as [Sector, number][]) {
    if (!w) continue;
    const a = sectorAngle(sector);
    x += Math.cos(a) * w;
    y += Math.sin(a) * w;
  }
  if (x === 0 && y === 0) return sectorAngle("other");
  return Math.atan2(y, x);
}

export function dominantSector(S: Partial<Record<Sector, number>>): Sector {
  let best: Sector = "other";
  let bestW = -1;
  for (const [sector, w] of Object.entries(S) as [Sector, number][]) {
    if ((w ?? 0) > bestW) {
      bestW = w ?? 0;
      best = sector;
    }
  }
  return best;
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

type ForceFn = ((alpha: number) => void) & { initialize?: (nodes: GraphNode[]) => void };

// Pulls each investor along its radius toward targetR. Founder (fx/fy set) is skipped.
export function forceRadialTarget(strength = RADIAL_STRENGTH): ForceFn {
  let nodes: GraphNode[] = [];
  const force: ForceFn = (alpha) => {
    for (const n of nodes) {
      if (n.kind !== "investor" || n.x === undefined || n.y === undefined) continue;
      const r = Math.hypot(n.x, n.y) || 1e-3;
      const k = ((n.targetR - r) * strength * alpha) / r;
      n.vx = (n.vx ?? 0) + n.x * k;
      n.vy = (n.vy ?? 0) + n.y * k;
    }
  };
  force.initialize = (ns) => {
    nodes = ns;
  };
  return force;
}

// Tangential nudge toward the sector arc; the push scales with radius so outer nodes
// sweep at the same angular speed as inner ones.
export function forceAngularTarget(strength = ANGULAR_STRENGTH): ForceFn {
  let nodes: GraphNode[] = [];
  const force: ForceFn = (alpha) => {
    for (const n of nodes) {
      if (n.kind !== "investor" || n.x === undefined || n.y === undefined) continue;
      const r = Math.hypot(n.x, n.y);
      if (r < 4) continue;
      const a = Math.atan2(n.y, n.x);
      const d = wrapAngle(n.targetA - a);
      const step = d * strength * alpha * Math.max(r, 40);
      n.vx = (n.vx ?? 0) + -Math.sin(a) * step;
      n.vy = (n.vy ?? 0) + Math.cos(a) * step;
    }
  };
  force.initialize = (ns) => {
    nodes = ns;
  };
  return force;
}

export function initialPosition(n: GraphNode, jitter = 0.35): { x: number; y: number } {
  const a = n.targetA + (Math.random() - 0.5) * jitter;
  const r = n.targetR * (0.9 + Math.random() * 0.2);
  return { x: Math.cos(a) * r, y: Math.sin(a) * r };
}

export type Halo = { sector: Sector; count: number; cx: number; cy: number; r: number };

// A halo appears when at least HALO_MIN investors whose dominant sector agrees sit
// inside HALO_RADIUS of the founder.
export function computeHalos(nodes: GraphNode[]): Halo[] {
  const groups = new Map<Sector, GraphNode[]>();
  for (const n of nodes) {
    if (n.kind !== "investor" || n.x === undefined || n.y === undefined) continue;
    if (Math.hypot(n.x, n.y) > HALO_RADIUS) continue;
    const list = groups.get(n.sector) ?? [];
    list.push(n);
    groups.set(n.sector, list);
  }
  const halos: Halo[] = [];
  for (const [sector, list] of groups) {
    if (list.length < HALO_MIN) continue;
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
    halos.push({ sector, count: list.length, cx, cy, r: r + 26 });
  }
  return halos;
}
