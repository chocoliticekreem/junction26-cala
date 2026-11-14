import { ALL_SECTORS, SECTORS, type Sector } from "./taxonomy";

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

// Founder-view layout. Real scores sit in a narrow band (top ~62, most 40-55), so the
// absolute curve above puts everyone on one ring. Here the radius comes from where a score
// sits in the current set, blended with rank so the top 10 always pull in, and each sector
// owns an arc sized by how many investors it has, with a gap between arcs.
export const R_MIN = 84;
export const IDLE_BAND = 0.86;
export const SECTOR_GAP = 0.05;
export const RANKED_HALO_MIN = 3;
export const RANKED_HALO_RANK = 12;
export const RANKED_HALO_R = R_MIN + 0.4 * (R_MAX - R_MIN);

export type SectorSlot = { angle: number; half: number; count: number };
export type SectorLayout = Map<Sector, SectorSlot>;

export function buildSectorLayout(counts: Map<Sector, number>): SectorLayout {
  const present = ALL_SECTORS.filter((s) => (counts.get(s) ?? 0) > 0);
  const weight = (s: Sector) => Math.sqrt(counts.get(s) ?? 0);
  const total = present.reduce((acc, s) => acc + weight(s), 0) || 1;
  const layout: SectorLayout = new Map();
  let a = -Math.PI / 2;
  for (const s of present) {
    const span = (weight(s) / total) * Math.PI * 2;
    layout.set(s, { angle: a + span / 2, half: span / 2, count: counts.get(s) ?? 0 });
    a += span;
  }
  return layout;
}

// Angles for every investor in one sector: spread evenly across the arc (minus the gap),
// ordered by which neighbouring sector their other deals lean towards.
export function sectorSpread(layout: SectorLayout, sector: Sector, members: { id: string; S: Partial<Record<Sector, number>> }[]): Map<string, number> {
  const slot = layout.get(sector) ?? layout.get("other") ?? { angle: 0, half: Math.PI, count: 0 };
  const lean = (S: Partial<Record<Sector, number>>) => {
    let x = 0;
    let y = 0;
    for (const [s, w] of Object.entries(S) as [Sector, number][]) {
      const o = layout.get(s);
      if (!o || !w) continue;
      x += Math.cos(o.angle) * w;
      y += Math.sin(o.angle) * w;
    }
    return x === 0 && y === 0 ? 0 : wrapAngle(Math.atan2(y, x) - slot.angle);
  };
  const sorted = members.map((m) => ({ id: m.id, lean: lean(m.S) })).sort((a, b) => a.lean - b.lean || a.id.localeCompare(b.id));
  const usable = Math.max(0, slot.half - SECTOR_GAP);
  const out = new Map<string, number>();
  sorted.forEach((m, i) => {
    const t = sorted.length === 1 ? 0.5 : (i + 0.5) / sorted.length;
    out.set(m.id, slot.angle + (t * 2 - 1) * usable);
  });
  return out;
}

export function rankedRadius(score: number, rank: number, n: number, lo: number, hi: number, idle: boolean): number {
  const span = Math.max(hi - lo, 20);
  const byScore = Math.min(1, Math.max(0, (score - lo) / span));
  if (idle) return R_MAX * (IDLE_BAND + (1 - IDLE_BAND) * (1 - byScore));
  const byRank = n > 1 ? 1 - rank / (n - 1) : 1;
  const t = 0.6 * byScore + 0.4 * byRank;
  return R_MIN + (R_MAX - R_MIN) * Math.pow(1 - t, 0.8);
}

export type Halo = { sector: Sector; count: number; cx: number; cy: number; r: number };

// Same shape as computeHalos, but membership is "ranked near the top and inside the inner
// band of the current layout", which forms on real score distributions without lighting
// up every sector that happens to have a few mid-ranked investors.
export function computeRankedHalos(nodes: GraphNode[]): Halo[] {
  const groups = new Map<Sector, GraphNode[]>();
  for (const n of nodes) {
    if (n.kind !== "investor" || n.x === undefined || n.y === undefined) continue;
    if (n.rank >= RANKED_HALO_RANK || Math.hypot(n.x, n.y) > RANKED_HALO_R) continue;
    const list = groups.get(n.sector) ?? [];
    list.push(n);
    groups.set(n.sector, list);
  }
  const halos: Halo[] = [];
  for (const [sector, list] of groups) {
    if (list.length < RANKED_HALO_MIN) continue;
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
    halos.push({ sector, count: list.length, cx, cy, r: r + 24 });
  }
  return halos;
}

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
