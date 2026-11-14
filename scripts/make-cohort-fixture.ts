// Generates data/cohort.fixture.json: a synthetic round graph (~150 companies, ~60 investors) that
// lets the Path engine and UI run before Track A's real data/cohort.json exists. Every company and
// investor name ends in "(fixture)". Deterministic (seeded RNG, fixed as-of date).
//
// Planted behaviours the tests rely on:
// - Forge Labs (accelerator): its companies' seed is led by Kestrel Ventures ~70% of the time.
// - Northgate Accelerator: seed led by Harbour Capital ~50% of the time.
// - Each seed fund has a preferred Series A fund it hands companies to ~40% of the time.
// - Super-angels re-invest in the next round most of the time; other angels rarely.
// - Two "stall" seed funds whose companies rarely raise again.
// Run: npx tsx scripts/make-cohort-fixture.ts
import { writeFileSync } from "node:fs";
import path from "node:path";
import type { Sector, Stage } from "../lib/taxonomy";
import type {
  Cohort,
  CohortCompany,
  CohortInvestor,
  CohortParticipant,
  CohortRound,
  InvestorKind,
} from "../lib/sim/types";

const AS_OF = "2026-11-14";
const AS_OF_MS = Date.parse(`${AS_OF}T00:00:00Z`);
const OUT = path.join(__dirname, "..", "data", "cohort.fixture.json");
const SOURCE = { name: "Synthetic fixture (not real data)" };

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261115);
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
function weightedPick<T>(xs: readonly T[], w: (x: T) => number): T {
  const ws = xs.map(w);
  const total = ws.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let i = 0; i < xs.length; i++) {
    r -= ws[i];
    if (r <= 0) return xs[i];
  }
  return xs[xs.length - 1];
}

const SECTORS: Sector[] = [
  "fintech",
  "healthtech",
  "climate/energy",
  "applied AI/vertical SaaS",
  "developer tools",
  "biotech/therapeutics",
];

type Spec = {
  name: string;
  kind: InvestorKind;
  stages: Stage[];
  sectors: Sector[] | "any";
  quality: number;
  reUp: number;
  prefers?: string;
};

const specs: Spec[] = [];
const add = (s: Spec) => specs.push(s);

// Accelerators
add({ name: "Forge Labs", kind: "accelerator", stages: ["pre-seed"], sectors: "any", quality: 1.15, reUp: 0.2, prefers: "Kestrel Ventures" });
add({ name: "Northgate Accelerator", kind: "accelerator", stages: ["pre-seed"], sectors: "any", quality: 1.05, reUp: 0.2, prefers: "Harbour Capital" });
for (const [n, sec] of [
  ["Lumen Founders Programme", ["applied AI/vertical SaaS", "developer tools"]],
  ["Thistle Health Studio", ["healthtech", "biotech/therapeutics"]],
  ["Ember Climate Lab", ["climate/energy"]],
  ["Quill Fintech Bootcamp", ["fintech"]],
  ["Saffron Launchpad", "any"],
  ["Copper Works", "any"],
] as const) {
  add({ name: n, kind: "accelerator", stages: ["pre-seed"], sectors: sec === "any" ? "any" : [...sec], quality: 0.85 + rand() * 0.25, reUp: 0.1 });
}

// Angels: four super-angels with high follow-on, the rest occasional.
const ANGEL_FIRST = ["Ada", "Ravi", "Maya", "Tomas", "Ines", "Kwame", "Sofia", "Liam", "Priya", "Jonas", "Amara", "Felix", "Nadia", "Oscar", "Hana", "Leo", "Zara", "Ivo", "Lena", "Omar", "Elif", "Rafa"];
const ANGEL_LAST = ["Marlow", "Heron", "Wren", "Ashby", "Fennick", "Larkin", "Okafor", "Brandt", "Castell", "Devlin", "Eastwood", "Ferro", "Galloway", "Hale", "Ibsen", "Juniper", "Kaur", "Lindqvist", "Moreau", "Novak", "Orsini", "Penhale"];
for (let i = 0; i < 22; i++) {
  const superAngel = i < 4;
  add({
    name: `${ANGEL_FIRST[i]} ${ANGEL_LAST[i]}`,
    kind: "angel",
    stages: superAngel ? ["pre-seed", "seed"] : ["pre-seed"],
    sectors: i % 3 === 0 ? "any" : [pick(SECTORS), pick(SECTORS)],
    quality: superAngel ? 1.1 : 0.9 + rand() * 0.2,
    reUp: superAngel ? 0.8 : 0.1,
  });
}

// Funds
const preSeedFunds = ["Bramble Capital", "Wildcard Fund", "Firstlight Ventures", "Pebble VC", "Tidewater Pre-Seed", "Sable Seed Partners"];
for (const n of preSeedFunds) {
  add({ name: n, kind: "fund", stages: ["pre-seed", "seed"], sectors: rand() < 0.4 ? "any" : [pick(SECTORS), pick(SECTORS)], quality: 0.9 + rand() * 0.25, reUp: 0.5 });
}
const seriesAFunds = ["Granite Partners", "Meridian Growth", "Halcyon Capital", "Cobalt Ventures", "Orchard Street Capital", "Beacon Hill Partners", "Indigo Ventures"];
const seedFunds: [string, Sector[] | "any", number][] = [
  ["Kestrel Ventures", "any", 1.2],
  ["Harbour Capital", "any", 1.1],
  ["Juniper Seed", ["fintech", "applied AI/vertical SaaS"], 1.0],
  ["Larkspur Ventures", ["healthtech", "biotech/therapeutics"], 1.0],
  ["Fernhill Capital", ["climate/energy"], 1.0],
  ["Slate Ventures", ["developer tools", "applied AI/vertical SaaS"], 1.05],
  ["Marigold Partners", "any", 0.95],
  ["Driftwood Seed", "any", 0.35],
  ["Cinder Capital", ["fintech", "climate/energy"], 0.35],
  ["Almond Ventures", "any", 1.0],
];
seedFunds.forEach(([n, sec, q], i) => {
  add({ name: n, kind: "fund", stages: ["seed"], sectors: sec, quality: q, reUp: 0.6, prefers: seriesAFunds[i % seriesAFunds.length] });
});
seriesAFunds.forEach((n, i) => {
  add({ name: n, kind: "fund", stages: ["series-a"], sectors: i < 2 ? "any" : [SECTORS[i % 6], SECTORS[(i + 2) % 6]], quality: 0.95 + rand() * 0.2, reUp: 0.6 });
});
for (const n of ["Atlas Growth", "Summit Crossover", "Pinnacle Capital", "Northstar Equity", "Vanguard Row"]) {
  add({ name: n, kind: "fund", stages: ["series-a", "series-b-plus"], sectors: "any", quality: 1, reUp: 0.5 });
}
add({ name: "Voltline Corporate Ventures", kind: "cvc", stages: ["series-a", "series-b-plus"], sectors: ["climate/energy", "fintech"], quality: 1, reUp: 0.5 });
add({ name: "Medisphere Ventures", kind: "cvc", stages: ["series-a", "series-b-plus"], sectors: ["healthtech", "biotech/therapeutics"], quality: 1, reUp: 0.5 });

const investors: Record<string, CohortInvestor> = {};
const byName = new Map<string, { id: string; spec: Spec }>();
specs.forEach((s, i) => {
  const id = `fx-inv-${String(i + 1).padStart(3, "0")}`;
  investors[id] = { id, name: `${s.name} (fixture)`, kind: s.kind };
  byName.set(s.name, { id, spec: s });
});
const all = [...byName.values()];
const sectorFit = (s: Spec, sec: Sector) => (s.sectors === "any" ? 1 : s.sectors.includes(sec) ? 3 : 0.15);
const pool = (kind: InvestorKind | "fund+cvc", stage: Stage) =>
  all.filter((x) => (kind === "fund+cvc" ? x.spec.kind === "fund" || x.spec.kind === "cvc" : x.spec.kind === kind) && x.spec.stages.includes(stage));

const ORDER: Stage[] = ["pre-seed", "seed", "series-a", "series-b-plus"];
const BASE_RAISE: Partial<Record<Stage, number>> = { "pre-seed": 0.9, seed: 0.84, "series-a": 0.8 };
const GAP: Partial<Record<Stage, [number, number]>> = { "pre-seed": [9, 22], seed: [13, 27], "series-a": [17, 32] };
const AMOUNT: Record<Stage, [number, number]> = {
  "pre-idea": [0, 0],
  "pre-seed": [0.3e6, 1.2e6],
  seed: [1.5e6, 4.5e6],
  "series-a": [6e6, 16e6],
  "series-b-plus": [20e6, 70e6],
};
const LABEL: Record<Stage, string> = { "pre-idea": "Pre-idea", "pre-seed": "Pre-Seed", seed: "Seed", "series-a": "Series A", "series-b-plus": "Series B" };
const HEADCOUNT: Record<Stage, [number, number]> = { "pre-idea": [1, 2], "pre-seed": [2, 6], seed: [7, 20], "series-a": [22, 60], "series-b-plus": [70, 260] };

const PREFIX = ["Nimbus", "Tessel", "Argo", "Pylon", "Corvid", "Lattice", "Fathom", "Quanta", "Verdant", "Helio", "Strata", "Morrow", "Kinetic", "Parallax", "Cairn", "Vela", "Osprey", "Bastion", "Lumio", "Tandem", "Alder", "Brisk", "Cleft", "Dune", "Eddy"];
const SUFFIX = ["Pay", "Health", "Grid", "AI", "Stack", "Bio", "Labs", "Works", "Ledger", "Care"];
const SECTOR_WORD: Record<string, string> = {
  fintech: "payments and lending software",
  healthtech: "digital health tools for clinics",
  "climate/energy": "grid and carbon software",
  "applied AI/vertical SaaS": "AI agents for a vertical industry",
  "developer tools": "developer tooling and observability",
  "biotech/therapeutics": "drug discovery platform",
};

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const addMonths = (ms: number, m: number) => ms + m * 30.44 * 86400000;

const companies: Record<string, CohortCompany> = {};
const rounds: Record<string, CohortRound> = {};
let roundSeq = 0;
const usedNames = new Set<string>();

function participant(x: { id: string; spec: Spec }, isLead: boolean): CohortParticipant {
  return { investorId: x.id, name: investors[x.id].name, kind: x.spec.kind, isLead };
}

function chooseLead(stage: Stage, sector: Sector, prev: { id: string; spec: Spec } | undefined, firstKind?: string) {
  if (prev?.spec.prefers) {
    const p = byName.get(prev.spec.prefers)!;
    const odds = prev.spec.name === "Forge Labs" ? 0.7 : prev.spec.name === "Northgate Accelerator" ? 0.5 : 0.4;
    if (p.spec.stages.includes(stage) && rand() < odds) return p;
  }
  const kind = firstKind === "angel" ? "angel" : firstKind === "accelerator" ? "accelerator" : "fund+cvc";
  const candidates = pool(kind as InvestorKind | "fund+cvc", stage);
  // Forge Labs is the largest programme, so the planted pattern has enough companies behind it.
  const size = (c: { spec: Spec }) => (c.spec.name === "Forge Labs" ? 4 : 1);
  return weightedPick(candidates, (c) => size(c) * sectorFit(c.spec, sector) * (c.spec.stages[0] === stage ? 2 : 1));
}

for (let c = 0; c < 150; c++) {
  let name = "";
  do name = `${pick(PREFIX)}${pick(SUFFIX)}`;
  while (usedNames.has(name));
  usedNames.add(name);
  const sector = SECTORS[c % SECTORS.length];
  const id = `fx-co-${String(c + 1).padStart(3, "0")}`;
  const founded = Date.parse(`${int(2016, 2024)}-${String(int(1, 12)).padStart(2, "0")}-01T00:00:00Z`);
  let date = addMonths(founded, int(2, 10));
  if (date > AS_OF_MS) date = addMonths(AS_OF_MS, -int(1, 6));
  const r = rand();
  const firstKind = r < 0.3 ? "accelerator" : r < 0.62 ? "angel" : "fund";
  let stageIdx = rand() < 0.15 && firstKind === "fund" ? 1 : 0;
  let prevLead: { id: string; spec: Spec } | undefined;
  let prevMembers: { id: string; spec: Spec }[] = [];
  const roundIds: string[] = [];
  let total = 0;
  let status: CohortCompany["status"] = "active";
  const headcount: { date: string; value: number }[] = [];

  for (;;) {
    const stage = ORDER[stageIdx];
    const lead = chooseLead(stage, sector, prevLead, roundIds.length === 0 ? firstKind : undefined);
    const members = new Map<string, { id: string; spec: Spec }>([[lead.id, lead]]);
    for (const m of prevMembers) if (m.id !== lead.id && rand() < m.spec.reUp) members.set(m.id, m);
    const extra = stage === "pre-seed" ? int(0, 3) : int(0, 2);
    for (let k = 0; k < extra; k++) {
      const kind = stage === "pre-seed" || (stage === "seed" && rand() < 0.4) ? "angel" : "fund+cvc";
      const cand = pool(kind as InvestorKind | "fund+cvc", stage);
      if (cand.length) {
        const x = weightedPick(cand, (q) => sectorFit(q.spec, sector));
        members.set(x.id, x);
      }
    }
    const [lo, hi] = AMOUNT[stage];
    const amountUsd = Math.round((lo + rand() * (hi - lo)) / 1e4) * 1e4;
    total += amountUsd;
    const rid = `fx-r-${String(++roundSeq).padStart(4, "0")}`;
    rounds[rid] = {
      id: rid,
      companyId: id,
      stage,
      label: LABEL[stage],
      date: iso(date),
      datePrecision: "day",
      amountUsd,
      participants: [...members.values()].map((m) => participant(m, m.id === lead.id)),
      sources: [{ ...SOURCE, rank: "AGGREGATOR" }],
    };
    roundIds.push(rid);
    if (rand() < 0.6) {
      const [hlo, hhi] = HEADCOUNT[stage];
      headcount.push({ date: iso(date), value: int(hlo, hhi) });
    }

    if (stage === "series-b-plus") {
      const cDate = addMonths(date, int(16, 30));
      if (!roundIds.some((x) => rounds[x].label === "Series C") && cDate < AS_OF_MS && rand() < 0.45 * lead.spec.quality) {
        const cLead = chooseLead("series-b-plus", sector, undefined);
        const cAmount = Math.round((40e6 + rand() * 80e6) / 1e4) * 1e4;
        total += cAmount;
        const cid = `fx-r-${String(++roundSeq).padStart(4, "0")}`;
        const cMembers = new Map([[cLead.id, cLead], ...[...members.values()].filter(() => rand() < 0.5).map((m) => [m.id, m] as const)]);
        rounds[cid] = {
          id: cid,
          companyId: id,
          stage,
          label: "Series C",
          date: iso(cDate),
          datePrecision: "day",
          amountUsd: cAmount,
          participants: [...cMembers.values()].map((m) => participant(m, m.id === cLead.id)),
          sources: [{ ...SOURCE, rank: "AGGREGATOR" }],
        };
        roundIds.push(cid);
      }
      if (rand() < 0.1) status = "acquired";
      break;
    }
    const baseP = BASE_RAISE[stage] ?? 0.5;
    const reUpBoost = [...members.values()].some((m) => m.spec.reUp >= 0.8) ? 1.08 : 1;
    const p = Math.min(0.95, baseP * lead.spec.quality * reUpBoost);
    const [glo, ghi] = GAP[stage]!;
    const gap = int(glo, ghi) + (sector === "biotech/therapeutics" ? 4 : 0);
    const next = addMonths(date, gap);
    if (next > AS_OF_MS) break;
    if (rand() >= p) {
      if (rand() < 0.4) status = "closed";
      break;
    }
    if (stageIdx === 2 && rand() < 0.08) status = "acquired";
    prevLead = lead;
    prevMembers = [...members.values()];
    date = next;
    stageIdx++;
  }

  companies[id] = {
    id,
    name: `${name} (fixture)`,
    sector,
    description: `${name} builds ${SECTOR_WORD[sector]}. Synthetic company for development.`,
    hq: "London",
    foundingDate: iso(founded),
    totalFundingUsd: total,
    fundingStage: rounds[roundIds[roundIds.length - 1]].label,
    headcount: headcount.length ? headcount : undefined,
    status,
    roundIds,
    sources: [SOURCE],
  };
}

// Demo stand-in for the headline "Cala" company so the companyName path works on the fixture.
// Investors are fixture funds, not Cala's real cap table.
{
  const id = "fx-co-cala";
  const mk = (rid: string, stage: Stage, date: string, amountUsd: number, lead: string, others: string[]) => {
    const l = byName.get(lead)!;
    rounds[rid] = {
      id: rid,
      companyId: id,
      stage,
      label: LABEL[stage],
      date,
      datePrecision: "month",
      amountUsd,
      participants: [participant(l, true), ...others.map((o) => participant(byName.get(o)!, false))],
      sources: [{ ...SOURCE, rank: "AGGREGATOR" }],
    };
  };
  mk("fx-r-cala-1", "pre-seed", "2025-04-01", 1.2e6, "Bramble Capital", ["Ada Marlow", "Ravi Heron"]);
  mk("fx-r-cala-2", "seed", "2025-11-01", 8e6, "Slate Ventures", ["Bramble Capital", "Ada Marlow"]);
  companies[id] = {
    id,
    name: "Cala (fixture)",
    sector: "AI infrastructure",
    description: "Knowledge API for AI agents. Fixture stand-in; real data comes from data/cohort.json.",
    hq: "Barcelona",
    foundingDate: "2025-01-01",
    totalFundingUsd: 9.2e6,
    fundingStage: "Seed",
    headcount: [{ date: "2025-11-01", value: 18 }],
    status: "active",
    roundIds: ["fx-r-cala-1", "fx-r-cala-2"],
    sources: [SOURCE],
  };
}

const cohort: Cohort = { version: 1, asOf: AS_OF, companies, rounds, investors };
writeFileSync(OUT, JSON.stringify(cohort, null, 1) + "\n");

const cos = Object.values(companies);
const stalled = cos.filter((co) => {
  const last = rounds[co.roundIds[co.roundIds.length - 1]];
  if (last.stage === "series-b-plus" || co.status === "acquired") return false;
  return co.status === "closed" || AS_OF_MS - Date.parse(last.date!) > 24 * 30.44 * 86400000;
});
const reachedB = cos.filter((co) => co.roundIds.some((r) => rounds[r].stage === "series-b-plus"));
console.log(
  `wrote ${OUT}: ${cos.length} companies, ${Object.keys(rounds).length} rounds, ${Object.keys(investors).length} investors; ` +
    `${stalled.length} stalled (${Math.round((100 * stalled.length) / cos.length)}%), ${reachedB.length} reached Series B+`,
);
