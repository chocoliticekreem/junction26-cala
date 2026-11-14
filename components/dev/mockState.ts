// Temporary harness so the founder view can be built before the engine, data loaders and
// API routes land. Everything here is synthetic. Delete once page.tsx is wired to the
// real scorer and replay.
import { SECTORS, STAGES, type Sector, type Stage } from "@/lib/taxonomy";
import type { Deal, Door, FounderProfile, Investor, Match, ScoreBreakdown } from "@/lib/types";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const FUND_A = ["Hollow", "Ninefold", "Quiet", "Larch", "Meridian", "Tidewater", "Harrow", "Fenwick", "Blackbird", "Ashgrove", "Northlight", "Kestrel", "Oriel", "Saltmarsh", "Brightwater", "Pembury", "Granite", "Wren", "Moorland", "Ironside"];
const FUND_B = ["Capital", "Ventures", "Partners", "Fund", "Collective", "Labs", "Angels", "Growth", "Seed", "Studio"];
const COMPANIES = ["Helixa", "Cureon", "Oxbridge Bio", "Nanoform", "Lattice Health", "Pulsar Dx", "Veritas Pay", "Ledgerly", "Kite Insure", "Rentable", "Mapfolk", "Coursive", "Voltway", "Greenline", "Fusionworks", "Tensorlane", "Devbench", "Shieldcast", "Orbital AI", "Stacktide", "Mindrow", "Aurelia Tx", "Synthra", "Biofold", "Carepath", "Nimbus Mobility", "Lumen Energy", "Procure.ly", "Flowstate", "Datakin"];
const PARTNER_FIRST = ["Ada", "Tomás", "Priya", "Jonah", "Mei", "Olu", "Sofia", "Ravi", "Hanna", "Felix", "Noor", "Iker"];
const PARTNER_LAST = ["Okafor", "Lindqvist", "Marchetti", "Chen", "Haddad", "Novak", "Abara", "Sørensen", "Patel", "Whitlock"];

const KINDS: Investor["kind"][] = ["fund", "fund", "fund", "fund", "angel_network", "accelerator", "cvc"];

function normalise<T extends string>(m: Partial<Record<T, number>>): Partial<Record<T, number>> {
  const total = (Object.values(m) as number[]).reduce((a, b) => a + b, 0) || 1;
  const out: Partial<Record<T, number>> = {};
  for (const [k, v] of Object.entries(m) as [T, number][]) out[k] = v / total;
  return out;
}

function makeInvestor(i: number, rand: () => number): Investor {
  // Bias the universe so biotech / health / fintech / AI have real clusters.
  const anchorPool: Sector[] = [
    "biotech/therapeutics", "biotech/therapeutics", "biotech/therapeutics", "biotech/therapeutics", "medtech/devices", "healthtech",
    "fintech", "fintech", "insurtech", "AI infrastructure", "applied AI/vertical SaaS", "developer tools",
    "climate/energy", "consumer", "marketplaces", "B2B SaaS (other)", "cybersecurity", "deep tech/hardware", "proptech", "edtech", "mobility", "crypto/web3",
  ];
  const anchor = anchorPool[Math.floor(rand() * anchorPool.length)];
  const anchorIdx = SECTORS.indexOf(anchor as (typeof SECTORS)[number]);
  const neighbour = SECTORS[(anchorIdx + (rand() < 0.5 ? 1 : SECTORS.length - 1)) % SECTORS.length];
  const stray = SECTORS[Math.floor(rand() * SECTORS.length)];

  const stageBias = rand();
  const stageWeights: Partial<Record<Stage, number>> =
    stageBias < 0.45
      ? { "pre-seed": 0.55, seed: 0.35, "series-a": 0.1 }
      : stageBias < 0.8
        ? { seed: 0.5, "series-a": 0.4, "pre-seed": 0.1 }
        : { "series-a": 0.55, "series-b-plus": 0.4, seed: 0.05 };

  const dealCount = rand() < 0.15 ? 2 : 4 + Math.floor(rand() * 9);
  const deals: Deal[] = [];
  for (let d = 0; d < dealCount; d++) {
    const roll = rand();
    const sector: Sector = roll < 0.72 ? anchor : roll < 0.9 ? neighbour : stray;
    const stageRoll = rand();
    let acc = 0;
    let round: Stage = "seed";
    for (const [st, w] of Object.entries(stageWeights) as [Stage, number][]) {
      acc += w;
      if (stageRoll <= acc) {
        round = st;
        break;
      }
    }
    const year = 2024 + Math.floor(rand() * 2.6);
    const month = 1 + Math.floor(rand() * 12);
    deals.push({
      company: COMPANIES[Math.floor(rand() * COMPANIES.length)],
      round,
      date: `${year}-${String(month).padStart(2, "0")}-15`,
      amount: `£${(0.5 + Math.floor(rand() * 60) / 4).toFixed(1)}m`,
      sector,
      sources: [{ name: "Cala (fixture)", url: rand() < 0.7 ? "https://cala.ai" : undefined, date: `${year}-${String(month).padStart(2, "0")}-16` }],
    });
  }

  const S: Partial<Record<Sector, number>> = {};
  const G: Partial<Record<Stage, number>> = {};
  for (const d of deals) {
    S[d.sector] = (S[d.sector] ?? 0) + 1;
    G[d.round as Stage] = (G[d.round as Stage] ?? 0) + 1;
  }

  // One in six funds says one thing and does another.
  const contradicts = rand() < 0.17;
  const statedStages: Partial<Record<Stage, number>> = contradicts
    ? { "pre-seed": 0.8, seed: 0.2 }
    : { ...stageWeights };
  const statedSectors: Partial<Record<Sector, number>> = contradicts
    ? { [stray]: 0.6, [anchor]: 0.4 }
    : { [anchor]: 0.7, [neighbour]: 0.3 };

  const kind = KINDS[Math.floor(rand() * KINDS.length)];
  const name = `${FUND_A[i % FUND_A.length]} ${FUND_B[Math.floor(i / FUND_A.length) % FUND_B.length]}`;
  const laterDeals = deals.filter((d) => d.round === "series-a" || d.round === "series-b-plus").length;

  const doors: Door[] = [];
  if (kind === "accelerator") doors.push({ kind: "programme", label: `${name} cohort application`, url: "https://example.org/apply" });
  if (rand() < 0.35) doors.push({ kind: "office_hours", label: "Monthly open office hours", url: "https://example.org/oh" });
  if (rand() < 0.3) doors.push({ kind: "scout", label: "Scout programme (3 active scouts)" });
  doors.push({ kind: "warm_intro", label: "Warm intro via portfolio founder", via: [COMPANIES[(i * 7) % COMPANIES.length], PARTNER_FIRST[(i * 3) % PARTNER_FIRST.length] + " " + PARTNER_LAST[(i * 5) % PARTNER_LAST.length]] });
  doors.push({ kind: "room", label: "Ask to be considered for a room" });

  const partnerCount = 1 + Math.floor(rand() * 3);
  const partners = Array.from({ length: partnerCount }, (_, p) => ({
    calaId: `person-${i}-${p}`,
    name: `${PARTNER_FIRST[(i + p * 5) % PARTNER_FIRST.length]} ${PARTNER_LAST[(i * 3 + p) % PARTNER_LAST.length]}`,
    role: p === 0 ? "General Partner" : rand() < 0.5 ? "Partner" : "Principal",
    linkedinUrl: rand() < 0.6 ? "https://www.linkedin.com/" : undefined,
  }));

  const cheque: [number, number] = stageBias < 0.45 ? [300_000, 1_500_000] : stageBias < 0.8 ? [1_000_000, 6_000_000] : [5_000_000, 30_000_000];

  return {
    id: `inv-${i}`,
    calaId: `cala-fixture-${i}`,
    name,
    kind,
    description: `${name} backs ${anchor.split("/")[0]} founders across London and the UK.`,
    website: "https://example.org",
    statedThesis: {
      text: contradicts
        ? `We invest at pre-seed in ${stray} and ${anchor} founders with technical depth.`
        : `We back ${anchor} and ${neighbour} companies from ${Object.keys(stageWeights)[0]} onwards.`,
      sectors: normalise(statedSectors),
      stages: normalise(statedStages),
      sources: [{ name: "Fund website (fixture)", url: "https://example.org" }],
    },
    deals,
    revealed: {
      S: normalise(S),
      G: normalise(G),
      chequeBand: cheque,
      chequeMedian: (cheque[0] + cheque[1]) / 2,
      activity: Math.min(1, Math.log1p(dealCount) / Math.log1p(12)),
      dealCount24m: dealCount,
    },
    contradiction: contradicts ? 0.55 + rand() * 0.3 : rand() * 0.3,
    contradictionLine: contradicts ? `Says pre-seed; ${laterDeals} of last ${dealCount} deals were Series A or later` : undefined,
    thinHistory: dealCount < 3,
    partners,
    doors,
    fixture: true,
  };
}

export const MOCK_INVESTORS: Investor[] = (() => {
  const rand = rng(20261114);
  return Array.from({ length: 64 }, (_, i) => makeInvestor(i, rand));
})();

export function emptyMockProfile(): FounderProfile {
  return { id: "live", sectors: {}, teamSignals: [], confidence: {} };
}

// Stand-in for lib/scoring.ts, same weights as spec 5.3, no debrief term.
export function mockRank(f: FounderProfile, investors: Investor[]): Match[] {
  const sectorConf = f.confidence.sectors ?? 0;
  const stageConf = f.confidence.stage ?? 0;
  const raiseConf = f.confidence.raise ?? 0;
  const hasSectors = Object.keys(f.sectors).length > 0;

  return investors
    .map((inv) => {
      let sectorFit = 0.5;
      if (hasSectors) {
        let fit = 0;
        for (const [s, w] of Object.entries(f.sectors) as [Sector, number][]) fit += w * (inv.revealed.S[s] ?? 0);
        sectorFit = 0.5 + (fit - 0.5) * sectorConf;
      }
      let stageFit = 0.5;
      if (f.stage) {
        const idx = STAGES.indexOf(f.stage);
        const exact = inv.revealed.G[f.stage] ?? 0;
        const adj = (inv.revealed.G[STAGES[idx - 1]] ?? 0) + (inv.revealed.G[STAGES[idx + 1]] ?? 0);
        stageFit = 0.5 + (exact + 0.5 * adj - 0.5) * stageConf;
      }
      let chequeFit = 0.5;
      if (f.raise) {
        const [lo, hi] = inv.revealed.chequeBand;
        const inside = f.raise >= lo && f.raise <= hi;
        const dist = inside ? 0 : f.raise < lo ? lo / f.raise : f.raise / hi;
        const raw = inside ? 1 : Math.max(0, 1 - (dist - 1) / 2);
        chequeFit = 0.5 + (raw - 0.5) * raiseConf;
      }
      const activity = inv.revealed.activity;
      const breakdown: ScoreBreakdown = { sectorFit, stageFit, chequeFit, activity, debriefAdj: 0.5 };
      const score = Math.round(100 * (0.4 * sectorFit + 0.3 * stageFit + 0.15 * chequeFit + 0.1 * activity + 0.05 * 0.5));

      const terms: [string, number][] = [
        [`${Math.round(sectorFit * 100)}% of recent deals in your sector`, 0.4 * sectorFit],
        [`${Math.round((inv.revealed.G[f.stage ?? "seed"] ?? 0) * 100)}% at ${f.stage ?? "your stage"}`, 0.3 * stageFit],
        [`cheque band fits a £${((f.raise ?? 0) / 1e6).toFixed(1)}m raise`, 0.15 * chequeFit],
        [`${inv.revealed.dealCount24m} deals in 24 months`, 0.1 * activity],
      ];
      terms.sort((a, b) => b[1] - a[1]);
      const reason = hasSectors ? `${terms[0][0]}; ${terms[1][0]}` : `${inv.revealed.dealCount24m} deals in 24 months; waiting for your sector`;

      const evidence = [...inv.deals]
        .sort((a, b) => (f.sectors[b.sector] ?? 0) + (b.round === f.stage ? 0.5 : 0) - ((f.sectors[a.sector] ?? 0) + (a.round === f.stage ? 0.5 : 0)))
        .slice(0, 3);

      return { investorId: inv.id, score, breakdown, reason, evidence };
    })
    .sort((a, b) => b.score - a.score);
}

export type MockStep = { t: number; words: string; profile?: Partial<FounderProfile>; trigger?: string };

// A rehearsed biotech pitch: words arrive, and on certain words the profile jumps.
export const MOCK_TIMELINE: MockStep[] = [
  { t: 0, words: "Hi, I'm Maya." },
  { t: 1400, words: "We're building Helixa, a platform for" },
  {
    t: 3200,
    words: "antibody therapeutics against rare autoimmune disease.",
    trigger: "therapeutics",
    profile: { sectors: { "biotech/therapeutics": 1 }, confidence: { sectors: 0.75 } },
  },
  { t: 5600, words: "Our first candidate hits a target nobody has drugged." },
  {
    t: 7800,
    words: "We've got preclinical data in two models and a medtech delivery partner.",
    trigger: "medtech",
    profile: { sectors: { "biotech/therapeutics": 0.8, "medtech/devices": 0.2 }, confidence: { sectors: 0.9 } },
  },
  {
    t: 10400,
    words: "We're raising a pre-seed round,",
    trigger: "pre-seed",
    profile: { stage: "pre-seed", confidence: { sectors: 0.9, stage: 0.85 } },
  },
  {
    t: 12200,
    words: "one point five million pounds,",
    trigger: "one point five million",
    profile: { raise: 1_500_000, confidence: { sectors: 0.9, stage: 0.85, raise: 0.8 } },
  },
  {
    t: 14000,
    words: "to get to our first in-human study. The team spun out of Imperial,",
    trigger: "Imperial",
    profile: { teamSignals: ["Imperial spin-out"], geography: "London", confidence: { sectors: 0.9, stage: 0.85, raise: 0.8, team: 0.7 } },
  },
  {
    t: 16400,
    words: "two PhDs and a former Head of Discovery at a top-ten pharma.",
    trigger: "pharma",
    profile: { teamSignals: ["Imperial spin-out", "2 PhDs", "ex-pharma Head of Discovery"], confidence: { sectors: 0.95, stage: 0.85, raise: 0.8, team: 0.9 } },
  },
  {
    t: 18800,
    words: "We already have a paid pilot with one hospital trust.",
    trigger: "paid pilot",
    profile: { traction: { revenue: "1 paid pilot" }, confidence: { sectors: 0.95, stage: 0.85, raise: 0.8, team: 0.9, traction: 0.7 } },
  },
];

export const MOCK_TIMELINE_END = 21_000;
