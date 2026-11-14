import type { Debrief, Deal, FounderProfile, Investor, Room } from "@/lib/types";
import type { Sector, Stage } from "@/lib/taxonomy";

// Temporary stand-in for lib/data.ts (Track B). Deterministic, small, labelled fixture/seeded.

type InvSpec = {
  id: string;
  name: string;
  kind: Investor["kind"];
  domain: string;
  sectors: Partial<Record<Sector, number>>;
  stages: Partial<Record<Stage, number>>;
  statedSectors?: Partial<Record<Sector, number>>;
  partners: string[];
  thesis: string;
};

const INVESTOR_SPECS: InvSpec[] = [
  {
    id: "inv-helix",
    name: "Helix Ventures",
    kind: "fund",
    domain: "helix.vc",
    sectors: { "biotech/therapeutics": 0.6, "medtech/devices": 0.25, healthtech: 0.15 },
    stages: { "pre-seed": 0.55, seed: 0.4, "series-a": 0.05 },
    partners: ["Mara Lindqvist", "Tomasz Adeyemi"],
    thesis: "Pre-seed and seed therapeutics and devices out of UK academic labs.",
  },
  {
    id: "inv-northlight",
    name: "Northlight Capital",
    kind: "fund",
    domain: "northlight.capital",
    sectors: { fintech: 0.5, insurtech: 0.2, "B2B SaaS (other)": 0.3 },
    stages: { seed: 0.5, "series-a": 0.5 },
    statedSectors: { fintech: 0.3, "AI infrastructure": 0.4, "developer tools": 0.3 },
    partners: ["Priya Raman"],
    thesis: "AI-native infrastructure for financial services.",
  },
  {
    id: "inv-ember",
    name: "Ember Collective",
    kind: "angel_network",
    domain: "ember.network",
    sectors: { "climate/energy": 0.55, mobility: 0.25, "deep tech/hardware": 0.2 },
    stages: { "pre-seed": 0.7, seed: 0.3 },
    partners: ["Jonas Weber", "Aisha Okafor"],
    thesis: "Angel syndicate for climate hardware at pre-seed.",
  },
  {
    id: "inv-forge",
    name: "Forge Labs",
    kind: "accelerator",
    domain: "forgelabs.io",
    sectors: { "biotech/therapeutics": 0.4, healthtech: 0.3, "deep tech/hardware": 0.3 },
    stages: { "pre-idea": 0.4, "pre-seed": 0.6 },
    partners: ["Elena Vasquez"],
    thesis: "Deep science founders before the company exists.",
  },
  {
    id: "inv-quill",
    name: "Quill Partners",
    kind: "fund",
    domain: "quill.partners",
    sectors: { "developer tools": 0.45, "AI infrastructure": 0.35, cybersecurity: 0.2 },
    stages: { seed: 0.6, "series-a": 0.4 },
    partners: ["Daniel Osei", "Hanna Berg"],
    thesis: "Seed-stage developer infrastructure.",
  },
  {
    id: "inv-meridian",
    name: "Meridian Health Fund",
    kind: "cvc",
    domain: "meridianhealth.com",
    sectors: { healthtech: 0.5, "medtech/devices": 0.3, "biotech/therapeutics": 0.2 },
    stages: { seed: 0.3, "series-a": 0.5, "series-b-plus": 0.2 },
    statedSectors: { healthtech: 0.3, "biotech/therapeutics": 0.7 },
    partners: ["Samuel Ng"],
    thesis: "Corporate venture arm investing in therapeutics.",
  },
  {
    id: "inv-lumen",
    name: "Lumen Seed",
    kind: "fund",
    domain: "lumenseed.com",
    sectors: { consumer: 0.4, marketplaces: 0.4, edtech: 0.2 },
    stages: { "pre-seed": 0.5, seed: 0.5 },
    partners: ["Chloe Martin", "Ravi Patel"],
    thesis: "Consumer and marketplace founders at first cheque.",
  },
  {
    id: "inv-sable",
    name: "Sable Ventures",
    kind: "fund",
    domain: "sable.vc",
    sectors: { "applied AI/vertical SaaS": 0.5, "B2B SaaS (other)": 0.3, proptech: 0.2 },
    stages: { seed: 0.7, "series-a": 0.3 },
    partners: ["Ingrid Solberg"],
    thesis: "Vertical AI for unglamorous industries.",
  },
];

const COMPANY_WORDS = ["Nova", "Aster", "Kite", "Orbit", "Lark", "Fjord", "Pico", "Vela", "Rune", "Mosaic"];

function pseudoRandom(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function pickWeighted<T extends string>(w: Partial<Record<T, number>>, r: number): T {
  const entries = Object.entries(w) as [T, number][];
  let acc = 0;
  for (const [k, v] of entries) {
    acc += v;
    if (r <= acc) return k;
  }
  return entries[entries.length - 1][0];
}

function makeDeals(spec: InvSpec, idx: number): Deal[] {
  const rnd = pseudoRandom(100 + idx * 7);
  const n = 6 + Math.floor(rnd() * 6);
  const deals: Deal[] = [];
  for (let i = 0; i < n; i++) {
    const sector = pickWeighted(spec.sectors, rnd());
    const round = pickWeighted(spec.stages, rnd());
    const month = 1 + Math.floor(rnd() * 12);
    const year = 2024 + Math.floor(rnd() * 3);
    const amountM = (0.4 + rnd() * 4).toFixed(1);
    deals.push({
      company: `${COMPANY_WORDS[(idx * 3 + i) % COMPANY_WORDS.length]} ${["Bio", "Labs", "Systems", "Health", "AI"][i % 5]}`,
      round,
      date: `${year}-${String(month).padStart(2, "0")}-15`,
      amount: `$${amountM}M`,
      amountUsd: Number(amountM) * 1e6,
      sector,
      sources: [{ name: "Cala (fixture)", date: `${year}-${String(month).padStart(2, "0")}-20` }],
    });
  }
  return deals.sort((a, b) => (a.date! < b.date! ? 1 : -1));
}

const INVESTORS: Investor[] = INVESTOR_SPECS.map((spec, idx) => {
  const deals = makeDeals(spec, idx);
  const stated = spec.statedSectors ?? spec.sectors;
  const contradiction = spec.statedSectors ? 0.55 : 0.1;
  return {
    id: spec.id,
    calaId: `cala-fixture-${spec.id}`,
    name: spec.name,
    kind: spec.kind,
    description: spec.thesis,
    website: `https://${spec.domain}`,
    statedThesis: { text: spec.thesis, sectors: stated, stages: spec.stages, sources: [{ name: "Fund website (fixture)" }] },
    deals,
    revealed: {
      S: spec.sectors,
      G: spec.stages,
      chequeBand: [500_000, 3_000_000],
      chequeMedian: 1_200_000,
      activity: 0.4 + (idx % 4) * 0.15,
      dealCount24m: deals.length,
    },
    contradiction,
    contradictionLine: spec.statedSectors ? "Says AI infrastructure; 7 of last 9 deals were fintech" : undefined,
    thinHistory: false,
    partners: spec.partners.map((name, i) => ({ calaId: `cala-person-${spec.id}-${i}`, name, role: i === 0 ? "General Partner" : "Partner" })),
    doors: [{ kind: "room", label: "Ask to be considered for a room" }],
    fixture: true,
  };
});

type FounderSpec = { sector: Sector; secondary?: Sector; stage: Stage; name: string; company: string; oneLiner: string; revenue?: string; users?: string };

const FOUNDER_SPECS: FounderSpec[] = [
  { sector: "biotech/therapeutics", stage: "pre-seed", name: "Ada Okonkwo", company: "Cellwright", oneLiner: "Engineered T-cells for solid tumours", users: "2 pilot labs" },
  { sector: "biotech/therapeutics", stage: "pre-seed", name: "Ben Halloran", company: "Peptara", oneLiner: "AI-designed peptides for fibrosis" },
  { sector: "biotech/therapeutics", stage: "seed", name: "Chiara Rossi", company: "Mycelia Bio", oneLiner: "Fungal platform for antibiotic discovery", revenue: "£120k grants" },
  { sector: "biotech/therapeutics", stage: "pre-seed", name: "Dev Anand", company: "Helixar", oneLiner: "CRISPR delivery via lipid nanoparticles" },
  { sector: "biotech/therapeutics", stage: "seed", name: "Esme Walker", company: "Neurova", oneLiner: "Small molecules for Parkinson's", revenue: "£0, pre-revenue" },
  { sector: "biotech/therapeutics", stage: "pre-idea", name: "Farid Nasser", company: "Protomer", oneLiner: "Protein folding sims for rare disease" },
  { sector: "biotech/therapeutics", secondary: "healthtech", stage: "pre-seed", name: "Grace Lim", company: "Oncoscan", oneLiner: "Liquid biopsy for early ovarian cancer", users: "1 NHS trust pilot" },
  { sector: "biotech/therapeutics", stage: "seed", name: "Hugo Brandt", company: "Vaxlane", oneLiner: "Thermostable mRNA vaccines", revenue: "£300k partnership" },
  { sector: "biotech/therapeutics", stage: "pre-seed", name: "Iris Chen", company: "Glycora", oneLiner: "Glycan-targeting antibodies" },
  { sector: "biotech/therapeutics", secondary: "deep tech/hardware", stage: "pre-seed", name: "Jamal Reid", company: "Microflux", oneLiner: "Organ-on-chip for tox screening", users: "3 pharma pilots" },
  { sector: "biotech/therapeutics", stage: "seed", name: "Katya Ivanova", company: "Senolyx", oneLiner: "Senolytics for age-related disease" },
  { sector: "biotech/therapeutics", stage: "pre-seed", name: "Liam Doyle", company: "Phagebright", oneLiner: "Phage therapy for resistant infections", users: "Compassionate-use cases: 4" },
  { sector: "biotech/therapeutics", stage: "pre-seed", name: "Maya Suresh", company: "Epigenix", oneLiner: "Epigenetic editing for sickle cell" },
  { sector: "medtech/devices", stage: "pre-seed", name: "Noah Fischer", company: "Pulsewear", oneLiner: "Wearable for arrhythmia detection", users: "400 beta users" },
  { sector: "medtech/devices", stage: "seed", name: "Olivia Grant", company: "Sutura", oneLiner: "Robotic suturing assistant", revenue: "£80k" },
  { sector: "healthtech", stage: "seed", name: "Pablo Serrano", company: "Clinicly", oneLiner: "Scheduling layer for GP surgeries", revenue: "£25k MRR", users: "60 clinics" },
  { sector: "healthtech", stage: "pre-seed", name: "Quinn Adebayo", company: "Carepath", oneLiner: "Discharge coordination for hospitals" },
  { sector: "fintech", stage: "seed", name: "Rosa Delgado", company: "Ledgerline", oneLiner: "Treasury automation for SMEs", revenue: "£40k MRR" },
  { sector: "fintech", stage: "pre-seed", name: "Sam Whitfield", company: "Payward", oneLiner: "Payroll for gig platforms", users: "1,200 workers" },
  { sector: "climate/energy", stage: "pre-seed", name: "Tara Nilsen", company: "Gridfold", oneLiner: "Battery storage orchestration", users: "2 pilot sites" },
  { sector: "climate/energy", stage: "seed", name: "Umar Khan", company: "Carbonloom", oneLiner: "Textile recycling via enzymes", revenue: "£150k" },
  { sector: "developer tools", stage: "seed", name: "Vera Novak", company: "Stackpilot", oneLiner: "Preview environments for monorepos", revenue: "£12k MRR", users: "300 teams" },
  { sector: "AI infrastructure", stage: "pre-seed", name: "Will Tanaka", company: "Tensorgate", oneLiner: "Inference routing across clouds" },
  { sector: "consumer", stage: "pre-seed", name: "Xenia Petrova", company: "Plotline", oneLiner: "Collaborative fiction app", users: "15k MAU" },
  { sector: "marketplaces", stage: "seed", name: "Yusuf Demir", company: "Toolshare", oneLiner: "Marketplace for construction equipment", revenue: "£60k GMV/mo" },
  { sector: "applied AI/vertical SaaS", stage: "seed", name: "Zoe Hartley", company: "Permitly", oneLiner: "AI for planning permission applications", revenue: "£18k MRR", users: "40 councils" },
  { sector: "edtech", stage: "pre-seed", name: "Arjun Mehta", company: "Tutorloop", oneLiner: "Peer tutoring with AI feedback", users: "2,000 students" },
  { sector: "cybersecurity", stage: "seed", name: "Beatrix Olsen", company: "Keyfence", oneLiner: "Secrets detection for CI pipelines", users: "90 teams" },
];

const FOUNDERS: FounderProfile[] = FOUNDER_SPECS.map((f, i) => {
  const sectors: Partial<Record<Sector, number>> = f.secondary ? { [f.sector]: 0.7, [f.secondary]: 0.3 } : { [f.sector]: 1 };
  const slug = f.company.toLowerCase().replace(/\s+/g, "");
  return {
    id: `seed-${String(i + 1).padStart(2, "0")}`,
    name: f.name,
    company: f.company,
    oneLiner: f.oneLiner,
    sectors,
    stage: f.stage,
    raise: f.stage === "pre-idea" ? 250_000 : f.stage === "pre-seed" ? 800_000 : 2_000_000,
    traction: f.revenue || f.users ? { revenue: f.revenue, users: f.users } : undefined,
    teamSignals: i % 3 === 0 ? ["PhD founder"] : i % 3 === 1 ? ["Second-time founder"] : [],
    confidence: { sectors: 1, stage: 1, raise: 0.8, traction: f.revenue || f.users ? 0.9 : 0 },
    website: `https://${slug}.example`,
    seeded: true,
  };
});

const DEBRIEFS: Debrief[] = [
  { roomId: "room-seed-1", founderId: "seed-01", investorId: "inv-helix", fit: "yes", again: true, tag: "sector", seeded: true },
  { roomId: "room-seed-1", founderId: "seed-02", investorId: "inv-helix", fit: "maybe", again: true, tag: "stage", seeded: true },
  { roomId: "room-seed-1", founderId: "seed-03", investorId: "inv-forge", fit: "yes", again: true, tag: "team", seeded: true },
  { roomId: "room-seed-1", founderId: "seed-04", investorId: "inv-forge", fit: "no", again: false, tag: "timing", seeded: true },
  { roomId: "room-seed-1", founderId: "seed-07", investorId: "inv-meridian", fit: "yes", again: true, tag: "traction", seeded: true },
  { roomId: "room-seed-1", founderId: "seed-08", investorId: "inv-meridian", fit: "maybe", again: false, tag: "stage", seeded: true },
];

export const SEED_ROOM: Room = {
  id: "room-seed-1",
  title: "Biotech pre-seed room",
  sector: "biotech/therapeutics",
  date: "2026-12-03",
  venue: "Venue TBC, London",
  founderIds: ["seed-01", "seed-02", "seed-03", "seed-04", "seed-07", "seed-08"],
  investorIds: ["inv-helix", "inv-forge", "inv-meridian"],
  hostInvestorId: "inv-helix",
  seeded: true,
};

export function loadInvestors(): Investor[] {
  return INVESTORS;
}
export function usingFixtures(): boolean {
  return INVESTORS.some((i) => i.fixture);
}
export function loadFounders(): FounderProfile[] {
  return FOUNDERS;
}
export function loadDebriefs(): Debrief[] {
  return DEBRIEFS;
}
