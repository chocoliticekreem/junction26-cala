import type { Door, DoorKind, FounderProfile, Investor, Programme } from "@/lib/types";
import { stageIndex, type Sector } from "@/lib/taxonomy";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const ORDER: DoorKind[] = ["programme", "office_hours", "scout"];
const MAX_PROGRAMMES = 2;

const doorKind = (p: Programme): DoorKind =>
  p.kind === "office_hours" ? "office_hours" : p.kind === "scout" ? "scout" : "programme";

// The investor's own programme: explicit link, or the investor's name contains the programme
// name (e.g. Seedcamp).
function isOwn(p: Programme, inv: Investor): boolean {
  const name = norm(inv.name);
  return !!p.investorIds?.includes(inv.id) || (norm(p.name).length > 3 && name.includes(norm(p.name)));
}

function topSector(f: FounderProfile): Sector | undefined {
  let best: Sector | undefined;
  let bv = 0;
  for (const [s, v] of Object.entries(f.sectors ?? {}) as [Sector, number | undefined][]) {
    if ((v ?? 0) > bv) {
      bv = v ?? 0;
      best = s;
    }
  }
  return best;
}

function fitsFounder(p: Programme, f: FounderProfile): boolean {
  const sector = topSector(f);
  if (!f.stage && !sector) return false;
  if (f.stage && !p.stages.includes(f.stage)) return false;
  if (p.sectors !== "any" && !(sector && p.sectors.includes(sector))) return false;
  return true;
}

// Sector-specific programmes beat generalist ones; a founder with revenue is pointed at
// programmes that also take seed or later companies.
function preference(p: Programme, f: FounderProfile): number {
  let v = p.sectors === "any" ? 0 : 2;
  const latest = Math.max(...p.stages.map(stageIndex));
  const revenue = f.traction?.revenue;
  if (revenue && !/pre-?revenue/i.test(revenue) && latest >= stageIndex("seed")) v += 1;
  return v;
}

export function programmesFor(
  inv: Investor,
  programmes: Programme[],
  founder?: FounderProfile,
): { programme: Programme; own: boolean }[] {
  const own = programmes.filter((p) => isOwn(p, inv)).map((programme) => ({ programme, own: true }));
  if (!founder) return own.slice(0, MAX_PROGRAMMES);
  const open = programmes
    .filter((p) => !isOwn(p, inv) && fitsFounder(p, founder))
    .map((p, i) => ({ p, i, v: preference(p, founder) }))
    .sort((a, b) => b.v - a.v || a.i - b.i)
    .map(({ p }) => ({ programme: p, own: false }));
  return [...own, ...open].slice(0, MAX_PROGRAMMES);
}

// A door is only worth showing when a founder can actually walk through it: the fund's own
// programme, an open application, office hours or a scout network, each with a URL. Rooms are
// cut from the product; partner-to-partner "warm intros" inside the same fund mean nothing.
export function publicDoors(doors: Door[]): Door[] {
  return doors.filter((d) => ORDER.includes(d.kind) && !!d.url);
}

// Cheapest real route in: programme or open application, office hours, then scout. The
// investor's own doors come before general open applications of the same kind. There is
// deliberately no cold-email door.
export function doorsFor(inv: Investor, programmes: Programme[], founder?: FounderProfile): Door[] {
  const picked = programmesFor(inv, programmes, founder).map(({ programme: p, own }) => ({
    own,
    door: {
      kind: doorKind(p),
      label: own ? `${p.name} (their own programme): ${p.description}` : `Open application: ${p.name}`,
      url: p.url,
    } as Door,
  }));
  const existing = publicDoors(inv.doors)
    .filter((d) => !picked.some((p) => p.door.url === d.url))
    .map((door) => ({ own: true, door }));
  return [...picked, ...existing]
    .filter((x) => !!x.door.url)
    .map((x, i) => ({ ...x, i }))
    .sort(
      (a, b) =>
        ORDER.indexOf(a.door.kind) - ORDER.indexOf(b.door.kind) ||
        Number(b.own) - Number(a.own) ||
        a.i - b.i,
    )
    .map((x) => x.door);
}
