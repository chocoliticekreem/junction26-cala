// Generates data/investors.fixture.json: 200 synthetic London investors, every record
// `fixture: true`, names clearly fictional. Deterministic (seeded RNG, fixed anchor date).
// Run: npx tsx scripts/make-fixtures.ts
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { Deal, Door, Investor, InvestorKind, Partner } from "../lib/types";
import { SECTORS, STAGES, type Sector, type Stage } from "../lib/taxonomy";
import { CONTRADICTION_THRESHOLD, finalizeInvestor } from "../lib/revealed";

const NOW = new Date("2026-11-14T00:00:00Z");
const OUT = path.join(__dirname, "..", "data", "investors.fixture.json");

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
const rand = mulberry32(20261114);
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
function weighted<K extends string>(w: Partial<Record<K, number>>): K {
  const entries = Object.entries(w) as [K, number][];
  const total = entries.reduce((a, [, v]) => a + v, 0);
  let r = rand() * total;
  for (const [k, v] of entries) {
    r -= v;
    if (r <= 0) return k;
  }
  return entries[entries.length - 1][0];
}
function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const ADJ = [
  "Lantern", "Copper", "Harbour", "Willow", "Granite", "Juniper", "Saffron", "Ember", "Northgate",
  "Meridian", "Thistle", "Kestrel", "Bramble", "Larkspur", "Quill", "Tidewater", "Foxglove",
  "Ashgrove", "Marlow", "Halcyon", "Indigo", "Fernhill", "Slate", "Cobalt", "Wren", "Orchard",
  "Beacon", "Lumen", "Driftwood", "Sable", "Heron", "Pewter", "Almond", "Cinder", "Marigold",
];
const NOUN = ["Peak", "Bridge", "Field", "Lane", "Yard", "Stone", "Hollow", "Ridge", "Gate", "Wharf", "Mill", "Crest"];
const SUFFIX: Record<InvestorKind, string[]> = {
  fund: ["Ventures", "Capital", "Partners"],
  angel_network: ["Angels", "Angel Network"],
  accelerator: ["Accelerator", "Launchpad", "Labs"],
  cvc: ["Corporate Ventures", "Ventures (CVC)"],
};
const FIRST = [
  "Imogen", "Rupert", "Anika", "Tobias", "Priya", "Hamish", "Saoirse", "Felix", "Odette", "Kwame",
  "Lavinia", "Ezra", "Marguerite", "Dev", "Clementine", "Idris", "Zoë", "Lorcan", "Yara", "Ottilie",
  "Caspian", "Niamh", "Rafe", "Juno", "Søren", "Amara", "Cosmo", "Inès", "Thaddeus", "Mireille",
];
const LAST = [
  "Thackeray", "Ashdown", "Pemberton", "Okonkwo", "Vance", "Fairweather", "Lindqvist", "Marchetti",
  "Holloway", "Quinlan", "Abernathy", "Strand", "Ravensworth", "Kaur", "Delacroix", "Whitlock",
  "Brennan", "Achterberg", "Moreau", "Castellane", "Featherstone", "Oyelaran",
];
const COMPANY_PREFIX: Partial<Record<Sector, string[]>> = {
  "biotech/therapeutics": ["Thera", "Geno", "Cyto", "Pepti", "Onco", "Myco", "Immu", "Neuro", "Vira", "Helix", "Antero", "Prota"],
  "medtech/devices": ["Ortho", "Cardio", "Sono", "Pulse", "Stent", "Derma", "Opti"],
  healthtech: ["Care", "Clinic", "Well", "Medi", "Triage", "Ward"],
  insurtech: ["Cover", "Shield", "Policy", "Claim"],
  fintech: ["Ledger", "Mint", "Vault", "Pay", "Fin", "Coin"],
  "crypto/web3": ["Chain", "Block", "Token", "Hash"],
  proptech: ["Lease", "Home", "Brick", "Tenancy"],
  marketplaces: ["Swap", "Trade", "Market", "Barter"],
  consumer: ["Bloom", "Pantry", "Glow", "Thread"],
  edtech: ["Learn", "Tutor", "Class", "Mentor"],
  mobility: ["Ride", "Fleet", "Volt", "Route"],
  "climate/energy": ["Carbon", "Solar", "Grid", "Terra", "Hydro"],
  "deep tech/hardware": ["Quantum", "Photon", "Robo", "Silicon"],
  "AI infrastructure": ["Tensor", "Vector", "Infer", "Kernel"],
  "developer tools": ["Stack", "Commit", "Deploy", "Patch"],
  cybersecurity: ["Cipher", "Sentinel", "Bastion", "Warden"],
  "applied AI/vertical SaaS": ["Copilot", "Agent", "Sage", "Insight"],
  "B2B SaaS (other)": ["Flow", "Desk", "Ops", "Suite"],
};
const COMPANY_SUFFIX = ["ly", "ix", "gen", "ia", "io", "ora", "nova", "wise", "base", "works", "labs", "loop"];

const STAGE_AMOUNT: Record<Stage, [number, number]> = {
  "pre-idea": [50_000, 250_000],
  "pre-seed": [250_000, 1_500_000],
  seed: [1_000_000, 5_000_000],
  "series-a": [6_000_000, 20_000_000],
  "series-b-plus": [25_000_000, 80_000_000],
};

const usedNames = new Set<string>();
function fundName(kind: InvestorKind, flavour?: string): string {
  for (;;) {
    const base = `${pick(ADJ)} ${pick(NOUN)}`;
    const name = `${base} ${flavour ? `${flavour} ` : ""}${pick(SUFFIX[kind])} (fixture)`;
    if (!usedNames.has(base)) {
      usedNames.add(base);
      return name;
    }
  }
}

function companyName(sector: Sector): string {
  const prefixes = COMPANY_PREFIX[sector] ?? ["Nova", "Arc", "Kite"];
  return `${pick(prefixes)}${pick(COMPANY_SUFFIX)}`;
}

function isoDaysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

function formatAmount(usd: number): string {
  const s = usd >= 1e6 ? `$${(usd / 1e6).toFixed(1)}M` : `$${Math.round(usd / 1e3)}k`;
  return rand() < 0.15 ? `~${s}` : s;
}

function makeDeal(sector: Sector, round: Stage | "unknown", maxDaysAgo: number, minDaysAgo = 0): Deal {
  const deal: Deal = {
    company: companyName(sector),
    round,
    date: isoDaysAgo(int(minDaysAgo, maxDaysAgo)),
    sector,
    sources: [{ name: "FIXTURE" }],
  };
  if (round !== "unknown" && rand() > 0.1) {
    const [lo, hi] = STAGE_AMOUNT[round];
    const usd = Math.round((lo + rand() * (hi - lo)) / 10_000) * 10_000;
    deal.amountUsd = usd;
    deal.amount = formatAmount(usd);
  }
  return deal;
}

let personSeq = 0;
function makePartners(): Partner[] {
  const roles = ["Partner", "Principal", "Venture Partner", "Investment Manager"];
  return Array.from({ length: int(2, 3) }, (_, i) => ({
    calaId: `fixture-person-${String(++personSeq).padStart(3, "0")}`,
    name: `${pick(FIRST)} ${pick(LAST)}`,
    role: i === 0 ? "Partner" : pick(roles),
  }));
}

function makeDoors(kind: InvestorKind, name: string, partners: Partner[]): Door[] {
  const doors: Door[] = [];
  const short = name.replace(" (fixture)", "");
  if (kind === "accelerator") doors.push({ kind: "programme", label: `Apply to the ${short} programme` });
  if (kind === "fund" && rand() < 0.2)
    doors.push({ kind: "office_hours", label: `Monthly office hours with ${partners[0].name}` });
  if (kind !== "accelerator" && rand() < 0.15) doors.push({ kind: "scout", label: `${short} scout network` });
  if (rand() < 0.4) {
    const p = pick(partners);
    doors.push({ kind: "warm_intro", label: `Warm intro to ${p.name} via a portfolio founder`, via: [p.name] });
  }
  doors.push({ kind: "room", label: "Ask to be considered for a room" });
  return doors;
}

const STAGE_WORDS: Record<Stage, string> = {
  "pre-idea": "pre-idea",
  "pre-seed": "pre-seed",
  seed: "seed",
  "series-a": "Series A",
  "series-b-plus": "growth-stage",
};

function thesisText(sectors: Partial<Record<Sector, number>>, stages: Partial<Record<Stage, number>>): string {
  const sec = (Object.entries(sectors) as [Sector, number][]).sort((a, b) => b[1] - a[1]).map(([s]) => s);
  const stg = (Object.entries(stages) as [Stage, number][]).sort((a, b) => b[1] - a[1]).map(([s]) => STAGE_WORDS[s]);
  return `We back ${stg.join(" and ")} founders building in ${sec.join(", ")} across the UK and Europe.`;
}

type Spec = {
  kind: InvestorKind;
  flavour?: string;
  statedSectors: Partial<Record<Sector, number>>;
  statedStages: Partial<Record<Stage, number>>;
  deals: Deal[];
};

const KIND_STAGE_CENTER: Record<InvestorKind, Stage[]> = {
  fund: ["pre-seed", "seed", "seed", "series-a", "series-a", "series-b-plus"],
  angel_network: ["pre-seed", "seed"],
  accelerator: ["pre-idea", "pre-seed"],
  cvc: ["seed", "series-a", "series-b-plus"],
};

function biotechCore(i: number): Spec {
  const kind: InvestorKind = i === 3 ? "angel_network" : i === 7 ? "accelerator" : "fund";
  const bio = 0.75 + rand() * 0.15;
  const neighbour: Sector = rand() < 0.5 ? "medtech/devices" : "healthtech";
  const sectorMix: Partial<Record<Sector, number>> = {
    "biotech/therapeutics": bio,
    [neighbour]: 1 - bio,
  };
  const stageMix: Partial<Record<Stage, number>> =
    kind === "accelerator"
      ? { "pre-idea": 0.3, "pre-seed": 0.6, seed: 0.1 }
      : { "pre-seed": 0.45, seed: 0.45, "series-a": 0.1 };
  const deals = Array.from({ length: int(8, 16) }, () =>
    makeDeal(weighted(sectorMix), rand() < 0.05 ? "unknown" : weighted(stageMix), 600),
  );
  return {
    kind,
    flavour: "Bio",
    statedSectors: { "biotech/therapeutics": 0.8, [neighbour]: 0.2 },
    statedStages: kind === "accelerator" ? { "pre-idea": 0.4, "pre-seed": 0.6 } : { "pre-seed": 0.5, seed: 0.5 },
    deals,
  };
}

function healthNeighbour(i: number): Spec {
  const main: Sector = i % 2 === 0 ? "medtech/devices" : "healthtech";
  const other: Sector = main === "healthtech" ? "medtech/devices" : "healthtech";
  const sectorMix: Partial<Record<Sector, number>> = { [main]: 0.65, [other]: 0.2, "biotech/therapeutics": 0.15 };
  const stageMix: Partial<Record<Stage, number>> = { "pre-seed": 0.25, seed: 0.55, "series-a": 0.2 };
  return {
    kind: "fund",
    flavour: "Health",
    statedSectors: { [main]: 0.7, [other]: 0.3 },
    statedStages: { seed: 0.7, "pre-seed": 0.3 },
    deals: Array.from({ length: int(7, 14) }, () => makeDeal(weighted(sectorMix), weighted(stageMix), 700)),
  };
}

type ContradictionDef = {
  kind: InvestorKind;
  statedSectors: Partial<Record<Sector, number>>;
  statedStages: Partial<Record<Stage, number>>;
  rounds: [Stage, number][];
  sectors: Partial<Record<Sector, number>>;
};

const CONTRADICTIONS: ContradictionDef[] = [
  {
    kind: "fund",
    statedSectors: { "biotech/therapeutics": 0.6, healthtech: 0.4 },
    statedStages: { "pre-seed": 1 },
    rounds: [["series-a", 9], ["seed", 3], ["pre-seed", 2]],
    sectors: { "biotech/therapeutics": 0.45, healthtech: 0.3, "medtech/devices": 0.25 },
  },
  {
    kind: "fund",
    statedSectors: { fintech: 1 },
    statedStages: { seed: 1 },
    rounds: [["seed", 7], ["series-a", 3]],
    sectors: { "climate/energy": 0.6, fintech: 0.2, mobility: 0.2 },
  },
  {
    kind: "angel_network",
    statedSectors: { consumer: 0.7, marketplaces: 0.3 },
    statedStages: { "pre-seed": 0.7, seed: 0.3 },
    rounds: [["seed", 6], ["series-a", 5]],
    sectors: { fintech: 0.6, insurtech: 0.25, consumer: 0.15 },
  },
  {
    kind: "fund",
    statedSectors: { "B2B SaaS (other)": 1 },
    statedStages: { seed: 1 },
    rounds: [["series-b-plus", 8], ["series-a", 4]],
    sectors: { "AI infrastructure": 0.7, "B2B SaaS (other)": 0.3 },
  },
  {
    kind: "fund",
    statedSectors: { "climate/energy": 1 },
    statedStages: { seed: 0.6, "pre-seed": 0.4 },
    rounds: [["series-a", 7], ["seed", 3]],
    sectors: { mobility: 0.5, "deep tech/hardware": 0.3, "climate/energy": 0.2 },
  },
  {
    kind: "accelerator",
    statedSectors: { edtech: 1 },
    statedStages: { "pre-seed": 1 },
    rounds: [["seed", 6], ["pre-seed", 3]],
    sectors: { consumer: 0.6, edtech: 0.25, marketplaces: 0.15 },
  },
  {
    kind: "cvc",
    statedSectors: { cybersecurity: 1 },
    statedStages: { "series-a": 1 },
    rounds: [["seed", 7], ["series-a", 3]],
    sectors: { "developer tools": 0.65, cybersecurity: 0.35 },
  },
  {
    kind: "fund",
    statedSectors: { healthtech: 1 },
    statedStages: { seed: 1 },
    rounds: [["series-a", 8], ["seed", 4]],
    sectors: { insurtech: 0.65, healthtech: 0.35 },
  },
];

function contradictor(def: ContradictionDef): Spec {
  const rounds = shuffle(def.rounds.flatMap(([stage, n]) => Array<Stage>(n).fill(stage)));
  // Deterministic sector split so the counted line is stable: largest remainder over the mix.
  const n = rounds.length;
  const entries = Object.entries(def.sectors) as [Sector, number][];
  const counts = entries.map(([s, w]) => ({ s, c: Math.floor(w * n), r: w * n - Math.floor(w * n) }));
  let left = n - counts.reduce((a, x) => a + x.c, 0);
  for (const x of [...counts].sort((a, b) => b.r - a.r)) if (left-- > 0) x.c++;
  const sectors = shuffle(counts.flatMap((x) => Array<Sector>(x.c).fill(x.s)));
  return {
    kind: def.kind,
    statedSectors: def.statedSectors,
    statedStages: def.statedStages,
    deals: rounds.map((r, i) => makeDeal(sectors[i], r, 650)),
  };
}

function thin(i: number): Spec {
  const kind: InvestorKind = pick(["fund", "fund", "angel_network", "accelerator", "cvc"]);
  const main: Sector = i < 2 ? "biotech/therapeutics" : pick(SECTORS);
  const second: Sector = i < 2 ? "medtech/devices" : pick(SECTORS);
  const statedSectors: Partial<Record<Sector, number>> =
    main === second ? { [main]: 1 } : { [main]: 0.7, [second]: 0.3 };
  const center = i < 2 ? "pre-seed" : pick(KIND_STAGE_CENTER[kind]);
  const statedStages: Partial<Record<Stage, number>> = { [center]: 1 };
  const recent = Array.from({ length: int(0, 2) }, () => makeDeal(main, center, 700));
  const old = Array.from({ length: int(0, 3) }, () => makeDeal(weighted(statedSectors), center, 912, 760));
  return { kind, flavour: i < 2 ? "Bio" : undefined, statedSectors, statedStages, deals: [...recent, ...old] };
}

function general(): Spec {
  const kind: InvestorKind = weighted({ fund: 0.6, angel_network: 0.15, accelerator: 0.1, cvc: 0.15 });
  const nFocus = int(1, 3);
  const focusPool = SECTORS.filter((s) => s !== "biotech/therapeutics" || rand() < 0.3);
  const focus = shuffle([...focusPool]).slice(0, nFocus);
  const sectorMix: Partial<Record<Sector, number>> = {};
  focus.forEach((s, i) => (sectorMix[s] = [0.6, 0.25, 0.15][i]));
  const center = pick(KIND_STAGE_CENTER[kind]);
  const ci = STAGES.indexOf(center);
  const stageMix: Partial<Record<Stage, number>> = { [center]: 0.7 };
  if (STAGES[ci - 1]) stageMix[STAGES[ci - 1]] = 0.15;
  if (STAGES[ci + 1]) stageMix[STAGES[ci + 1]] = 0.15;
  const deals = Array.from({ length: int(5, 25) }, () =>
    makeDeal(rand() < 0.9 ? weighted(sectorMix) : pick(SECTORS), rand() < 0.05 ? "unknown" : weighted(stageMix), 800),
  );
  return { kind, statedSectors: sectorMix, statedStages: stageMix, deals };
}

function build(): Investor[] {
  const specs: Spec[] = [
    ...Array.from({ length: 10 }, (_, i) => biotechCore(i)),
    ...Array.from({ length: 5 }, (_, i) => healthNeighbour(i)),
    ...CONTRADICTIONS.map(contradictor),
    ...Array.from({ length: 15 }, (_, i) => thin(i)),
  ];
  while (specs.length < 200) specs.push(general());

  return specs.map((spec, idx) => {
    const id = `fx-${String(idx + 1).padStart(3, "0")}`;
    const name = fundName(spec.kind, spec.flavour);
    const slug = name.replace(" (fixture)", "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const partners = makePartners();
    const deals = [...spec.deals].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
    return finalizeInvestor(
      {
        id,
        calaId: `fixture-${id}`,
        name,
        kind: spec.kind,
        description: `Synthetic ${spec.kind.replace("_", " ")} for local development. Not a real investor.`,
        website: `https://${slug}.example`,
        statedThesis: {
          text: thesisText(spec.statedSectors, spec.statedStages),
          sectors: spec.statedSectors,
          stages: spec.statedStages,
          sources: [{ name: "FIXTURE" }],
        },
        deals,
        partners,
        doors: makeDoors(spec.kind, name, partners),
        fixture: true,
      },
      NOW,
    );
  });
}

const investors = build();
mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(investors, null, 1) + "\n");

const flagged = investors.filter((i) => i.contradiction > CONTRADICTION_THRESHOLD);
console.log(`wrote ${investors.length} investors to ${path.relative(process.cwd(), OUT)}`);
console.log(`deals: ${investors.reduce((a, i) => a + i.deals.length, 0)}`);
console.log(`thin history: ${investors.filter((i) => i.thinHistory).length}`);
console.log(`contradictions > ${CONTRADICTION_THRESHOLD}: ${flagged.length}`);
for (const i of flagged) console.log(`  ${i.id} ${i.contradiction.toFixed(2)} ${i.contradictionLine ?? ""}`);
