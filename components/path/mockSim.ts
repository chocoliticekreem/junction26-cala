// Contract-shaped stand-in for lib/sim + /api/simulate + /api/network. Deterministic (seeded) so
// screenshots and e2e runs are stable; built from data/investors.json so names and kinds are the
// real London network even while the engine is a mock.
import { loadInvestors } from "@/lib/data";
import { STAGES, type Sector, type Stage } from "@/lib/taxonomy";
import type { Investor } from "@/lib/types";
import {
  YOU_ID,
  type ActionCard,
  type CompanyCandidate,
  type CompanyState,
  type ContextBuildBody,
  type ContextDoc,
  type Decision,
  type DecisionNode,
  type Highway,
  type InvestorKind,
  type NetworkData,
  type NetworkNode,
  type Precedent,
  type Reality,
  type SimPath,
  type WatchEvent,
  type SimResult,
  type SimulateBody,
} from "./types";

const AS_OF = "2026-11-13";
const RUNS = 5000;

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

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function toKind(k: Investor["kind"]): InvestorKind {
  return k === "angel_network" ? "angel" : k;
}

function dominant(S: Partial<Record<Sector, number>>): Sector {
  let best: Sector = "other";
  let w = -1;
  for (const [s, v] of Object.entries(S) as [Sector, number][]) {
    if ((v ?? 0) > w) {
      w = v ?? 0;
      best = s;
    }
  }
  return best;
}

let cachedNetwork: NetworkData | undefined;

export function mockNetwork(): NetworkData {
  if (cachedNetwork) return cachedNetwork;
  const investors = loadInvestors();
  const nodes: NetworkNode[] = investors.map((inv) => ({
    id: inv.id,
    name: inv.name,
    kind: toKind(inv.kind),
    sector: dominant(inv.revealed.S),
    ledCount: Math.max(1, Math.round(inv.deals.length * (inv.revealed.leadShare ?? 0.35))),
  }));
  const byCompany = new Map<string, string[]>();
  for (const inv of investors) for (const d of inv.deals) byCompany.set(d.company, [...(byCompany.get(d.company) ?? []), inv.id]);
  const edgeW = new Map<string, number>();
  for (const ids of byCompany.values()) {
    const uniq = [...new Set(ids)];
    for (let i = 0; i < uniq.length; i++)
      for (let j = i + 1; j < uniq.length; j++) {
        const key = `${uniq[i]}|${uniq[j]}`;
        edgeW.set(key, (edgeW.get(key) ?? 0) + 1);
      }
  }
  const edges = [...edgeW].map(([key, weight]) => {
    const [from, to] = key.split("|");
    return { from, to, kind: "coinvest" as const, weight };
  });
  nodes.push({ id: "kfund", name: "Kfund", kind: "fund", sector: "B2B SaaS (other)", ledCount: 6 });
  cachedNetwork = { nodes, edges };
  return cachedNetwork;
}

type Pool = Record<InvestorKind, NetworkNode[]>;

function pools(net: NetworkData, sector: Sector | undefined): Pool {
  const out: Pool = { fund: [], angel: [], accelerator: [], cvc: [], unknown: [] };
  const ranked = [...net.nodes].sort((a, b) => {
    const sa = sector && a.sector === sector ? 1000 : 0;
    const sb = sector && b.sector === sector ? 1000 : 0;
    return sb + b.ledCount - (sa + a.ledCount);
  });
  for (const n of ranked) out[n.kind].push(n);
  return out;
}

const STAGE_ORDER: Stage[] = [...STAGES];

function nextStages(from: Stage, to: Stage): Stage[] {
  const i = STAGE_ORDER.indexOf(from);
  const j = STAGE_ORDER.indexOf(to);
  return STAGE_ORDER.slice(Math.max(i + 1, 1), j + 1);
}

const CALA: CompanyState = {
  found: true,
  name: "Cala",
  founded: "2025",
  hq: "Barcelona",
  stage: "seed",
  backers: [
    { id: "kfund", name: "Kfund" },
    { id: "lightspeed-venture-partners", name: "Lightspeed" },
    { id: "creandum", name: "Creandum" },
  ],
  companyId: "cala-demo",
};

export function mockCompany(name: string): CompanyState {
  const q = name.trim().toLowerCase();
  if (q === "cala" || q === "cala.ai") return CALA;
  return { found: false, name: name.trim(), backers: [] };
}

export function visionBasis(text: string): string {
  const t = text.toLowerCase();
  if (/unicorn|billion|\$1b|£1b/.test(t)) return "Target: $1B+ valuation. Judged as a Series C+ round at a $1B+ post-money, or an exit above $1B, in Cala.";
  if (/ipo|public/.test(t)) return "Target: public listing. Judged as an IPO event in Cala within the horizon.";
  if (/series\s*b/.test(t)) return "Target: Series B. Judged as a Series B round in Cala within the horizon.";
  if (/series\s*a/.test(t)) return "Target: Series A. Judged as a Series A round in Cala within the horizon.";
  const people = t.match(/(\d{2,4})\s*(people|employees|staff)/);
  if (people) return `Target: ${people[1]} people. Judged from Cala headcount series within the horizon.`;
  const rev = t.match(/([£$€]\s?\d+\s?m)\b/);
  if (rev) return `Target: ${rev[1].replace(/\s/g, "")} revenue. Judged from the funding stage that revenue band usually implies in Cala.`;
  return "Target: Series B+ within 5 years. Judged as a Series B or later round in Cala.";
}

export function parseVisionTarget(text: string): Stage {
  const t = text.toLowerCase();
  if (/series\s*c|ipo|public|unicorn|\b[1-9]\d{2,}\s*(people|employees)|billion/.test(t)) return "series-b-plus";
  if (/series\s*b|\b[1-9]\d\s*(people|employees)|£?\$?\d+\s*m\b.*(arr|revenue)/.test(t)) return "series-b-plus";
  if (/series\s*a|profitable|\b\d+\s*(people|employees)/.test(t)) return "series-a";
  if (/seed/.test(t)) return "seed";
  return "series-b-plus";
}

function pathFor(rnd: () => number, pool: Pool, first: InvestorKind, start: Stage, target: Stage, speed: number): SimPath {
  const stages = nextStages(start, target);
  const steps: SimPath["steps"] = [];
  let month = 0;
  const firstPick = pool[first][Math.floor(rnd() * Math.min(4, pool[first].length))];
  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i];
    month += Math.round((i === 0 ? 4 : stage === "seed" ? 11 : stage === "series-a" ? 16 : 20) * speed * (0.75 + rnd() * 0.5));
    const kind: InvestorKind = i === 0 ? first : stage === "series-b-plus" ? (rnd() < 0.3 ? "cvc" : "fund") : "fund";
    const lead = i === 0 ? firstPick : pool[kind][Math.floor(rnd() * Math.min(8, pool[kind].length))];
    const co = pool.fund.filter((n) => n.id !== lead?.id).slice(0, 12);
    steps.push({
      stage,
      leadId: lead?.id,
      leadName: lead?.name,
      coInvestorIds: [co[Math.floor(rnd() * co.length)]?.id].filter(Boolean) as string[],
      monthFromStart: month,
      amountUsd: stage === "pre-seed" ? 1_500_000 : stage === "seed" ? 4_000_000 : stage === "series-a" ? 15_000_000 : 45_000_000,
    });
  }
  return { steps, reachedVision: true, count: 0, share: 0 };
}

function branch(
  rnd: () => number,
  pool: Pool,
  first: InvestorKind & ("angel" | "accelerator" | "fund"),
  start: Stage,
  target: Stage,
  reach: number,
  sampleSize: number,
): DecisionNode {
  const label = first === "fund" ? "Fund-led first cheque" : first === "angel" ? "Angels first" : "Accelerator first";
  const paths: SimPath[] = [];
  const shares = [0.34, 0.22, 0.13, 0.08];
  for (let i = 0; i < 4; i++) {
    const p = pathFor(rnd, pool, first, start, target, first === "accelerator" ? 0.9 : first === "angel" ? 1.1 : 1);
    const reached = i < 3 ? true : false;
    p.reachedVision = reached;
    if (!reached) {
      p.steps = p.steps.slice(0, Math.max(1, p.steps.length - 2));
      p.stalledAtStage = p.steps[p.steps.length - 1]?.stage;
    }
    p.share = shares[i] * (reached ? reach * 2 : 1 - reach);
    p.count = Math.round(p.share * RUNS);
    paths.push(p);
  }
  const months = paths[0].steps[0]?.monthFromStart ?? 6;
  const stalled = (s: Stage) => (s === "pre-seed" ? "Seed" : s === "seed" ? "Series A" : "Series B");
  const timing = (option: "now" | "later_6m", delta: number): DecisionNode => ({
    decision: { kind: "timing", option },
    label: option === "now" ? "Raise now" : "Raise in 6 months",
    runs: Math.round(RUNS / 2),
    reachVisionShare: Math.min(0.95, Math.max(0.02, reach + delta)),
    medianMonthsToNextRound: months + (option === "now" ? 0 : 6),
    outcomeBands: {
      best: `Series A inside ${Math.round(months + 14 + (option === "now" ? 0 : 6))} months`,
      median: `Seed led by a ${first === "fund" ? "fund" : "follow-on fund"} at month ${months + 9}`,
      worst: `Stalled before ${stalled(start)}`,
    },
    sampleSize: Math.round(sampleSize * 0.5),
    lowConfidence: sampleSize * 0.5 < 25,
    children: [],
    topPaths: paths.slice(0, 3),
  });
  return {
    decision: { kind: "first_cheque", option: first },
    label,
    runs: Math.round(RUNS / 3),
    reachVisionShare: reach,
    medianMonthsToNextRound: months,
    outcomeBands: {
      best: `${target === "series-b-plus" ? "Series B" : "Series A"} by month ${paths[0].steps[paths[0].steps.length - 1]?.monthFromStart ?? 40}`,
      median: `${stalled(start)} at month ${months + 9}, led by ${paths[0].steps[1]?.leadName ?? "a fund"}`,
      worst: `Stalled at ${stalled(start)} after ${months + 18} months`,
    },
    sampleSize,
    lowConfidence: sampleSize < 25,
    children: [timing("now", 0.03), timing("later_6m", -0.05)],
    topPaths: paths,
  };
}

function highwaysFor(tree: DecisionNode, decision: Decision | undefined): Highway[] {
  const w = new Map<string, number>();
  const add = (from: string, to: string, weight: number) => {
    const k = `${from}|${to}`;
    w.set(k, (w.get(k) ?? 0) + weight);
  };
  const branches = tree.children;
  for (const b of branches) {
    const d = b.decision;
    const boost = decision && d && decision.kind === "first_cheque" && d.kind === "first_cheque" ? (decision.option === d.option ? 2.2 : 0.35) : 1;
    for (const p of b.topPaths) {
      let prev = YOU_ID;
      for (const s of p.steps) {
        if (!s.leadId) continue;
        add(prev, s.leadId, p.share * boost);
        prev = s.leadId;
      }
    }
  }
  const out: Highway[] = [];
  for (const [k, weight] of w) {
    const [from, to] = k.split("|");
    out.push({ from, to, weight: Math.round(weight * 1000) / 1000 });
  }
  return out.sort((a, b) => b.weight - a.weight);
}

function precedentsFor(sector: Sector | undefined, rnd: () => number): Precedent[] {
  const investors = loadInvestors();
  type Row = { company: string; companyId: string; sector: Sector; steps: Precedent["path"] };
  const byCompany = new Map<string, Row>();
  for (const inv of investors)
    for (const d of inv.deals) {
      if (!d.date || d.round === "unknown") continue;
      const row = byCompany.get(d.company) ?? { company: d.company, companyId: d.companyCalaId ?? d.company.toLowerCase().replace(/\W+/g, "-"), sector: d.sector, steps: [] };
      row.steps.push({ stage: d.round, leadName: inv.name, date: d.date, roundId: `${row.companyId}:${d.round}:${d.date}` });
      byCompany.set(d.company, row);
    }
  const rows = [...byCompany.values()]
    .map((r) => {
      const seen = new Set<string>();
      r.steps = r.steps
        .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))
        .filter((s) => (seen.has(s.stage) ? false : (seen.add(s.stage), true)));
      return r;
    })
    .filter((r) => r.steps.length >= 2)
    .sort((a, b) => (sector && b.sector === sector ? 1 : 0) - (sector && a.sector === sector ? 1 : 0) || b.steps.length - a.steps.length);
  const picked = rows.slice(0, 6);
  return picked.map((r, i) => ({
    companyId: r.companyId,
    name: r.company,
    sector: r.sector,
    reachedVision: i < 4 ? true : rnd() < 0.5 ? false : false,
    path: i < 4 ? r.steps : r.steps.slice(0, 1),
  }));
}

const BAND = { seed: "$3–6m", "series-a": "$12–25m", "series-b-plus": "$40–120m", "pre-seed": "$1–2m", "pre-idea": "—" } as const;
const HEADS = { seed: "8–15", "series-a": "25–45", "series-b-plus": "80–180", "pre-seed": "3–6", "pre-idea": "1–2" } as const;

function realitiesFor(start: Stage, target: Stage, pool: Pool, company: CompanyState | undefined, rnd: () => number): Reality[] {
  const lead = (kind: InvestorKind, i: number) => pool[kind][i % Math.max(1, pool[kind].length)]?.name ?? "a fund";
  const stages = nextStages(start, target);
  const unicorn = target === "series-b-plus";
  const base = company?.found ? company.backers.map((b) => b.name) : [];
  const nextLeads = [base[2] ?? lead("fund", 0), base[1] ?? lead("fund", 1), lead("fund", 2), lead("cvc", 0)];
  const stepsFrom = (years: number[], leads: string[], stop: number) =>
    stages.slice(0, stop).map((stage, i) => ({ year: years[i], stage, leadName: leads[i], amountBand: BAND[stage], headcountBand: HEADS[stage] }));
  const demo = (names: string[]) => names.map((n) => ({ name: `${n} (demo)`, companyId: `${n.toLowerCase().replace(/\W+/g, "-")}-demo` }));
  const all: Reality[] = [
    {
      id: "breakout",
      label: "Breakout",
      probability: 0.14,
      outcome: unicorn ? "Unicorn · 4y" : "Vision · 3y",
      steps: stepsFrom([1, 2, 3], [nextLeads[0], nextLeads[1], nextLeads[2]], 3),
      precedents: demo(["Lovable", "ElevenLabs"]),
    },
    {
      id: "steady",
      label: "Steady climb",
      probability: 0.27,
      outcome: unicorn ? "Series B · $400–700m" : "Vision · 5y",
      steps: stepsFrom([1, 3, 5], [nextLeads[1], nextLeads[2], nextLeads[3]], 3),
      precedents: demo(["Granola", "Deblock"]),
    },
    {
      id: "late",
      label: "Slow burn",
      probability: 0.22,
      outcome: "Series A · no B",
      steps: stepsFrom([2, 4], [nextLeads[1], nextLeads[3]], 2),
      precedents: demo(["Semble", "Conduct"]),
    },
    {
      id: "stall",
      label: "Stalls at Seed",
      probability: 0.29,
      outcome: "Seed · stalls",
      steps: stepsFrom([1], [nextLeads[0]], 1),
      precedents: demo(["Fifth Dimension AI", "Mozart AI"]),
    },
    {
      id: "exit",
      label: "Early exit",
      probability: 0.08,
      outcome: "Acquired · y2–3",
      steps: stepsFrom([1], [nextLeads[2]], 1),
      precedents: demo(["Tilt"]),
    },
  ];
  const total = all.reduce((a, r) => a + r.probability, 0);
  const jitter = 0.98 + rnd() * 0.04;
  return all.map((r) => ({ ...r, probability: Math.round((r.probability / total) * jitter * 1000) / 1000 }));
}

export function mockSimulate(body: SimulateBody): SimResult {
  const seed = hash(`${body.visionText}|${body.companyName ?? ""}|${JSON.stringify(body.decision ?? null)}`);
  const rnd = mulberry32(seed);
  const net = mockNetwork();
  const sectors = Object.entries(body.profile.sectors) as [Sector, number][];
  const sector = sectors.sort((a, b) => b[1] - a[1])[0]?.[0];
  const pool = pools(net, sector);
  const company = body.companyName ? mockCompany(body.companyName) : undefined;
  const start: Stage = company?.found ? (company.stage ?? "seed") : body.profile.stage ?? "pre-seed";
  const target = parseVisionTarget(body.visionText);
  const accel = branch(rnd, pool, "accelerator", start, target, 0.31, 64);
  const angel = branch(rnd, pool, "angel", start, target, 0.24, 38);
  const fund = branch(rnd, pool, "fund", start, target, 0.19, 17);
  const children = start === "seed" ? [fund, angel, accel] : [accel, angel, fund];
  const tree: DecisionNode = {
    decision: null,
    label: "First cheque",
    runs: RUNS,
    reachVisionShare: children.reduce((a, c) => a + c.reachVisionShare, 0) / children.length,
    medianMonthsToNextRound: 7,
    outcomeBands: { best: accel.outcomeBands.best, median: angel.outcomeBands.median, worst: fund.outcomeBands.worst },
    sampleSize: children.reduce((a, c) => a + c.sampleSize, 0),
    lowConfidence: false,
    children,
    topPaths: children.flatMap((c) => c.topPaths.slice(0, 1)),
  };
  const explanation = [
    company?.found
      ? `Starting from ${company.name}'s current round state in Cala: ${company.stage} stage, backed by ${company.backers.map((b) => b.name).join(", ")}.`
      : `Starting at ${start} with no cap table.`,
    `Vision read as reaching ${target} within 5 years.`,
  ];
  return {
    asOf: AS_OF,
    runs: RUNS,
    tree,
    highways: highwaysFor(tree, body.decision),
    precedents: precedentsFor(sector, rnd),
    explanation,
    realities: realitiesFor(start, target, pool, company, rnd),
    visionBasis: visionBasis(body.visionText),
    fixture: true,
  };
}

export function mockResolve(name: string): CompanyCandidate[] {
  const q = name.trim().toLowerCase();
  if (!q) return [];
  if (q.startsWith("cala"))
    return [
      { calaId: "cala-demo", name: "Cala", website: "https://cala.ai", hq: "Barcelona", foundingDate: "2025", description: "Knowledge graph of companies, people and rounds with cited sources.", confidence: 0.96 },
      { calaId: "cala-health-demo", name: "Cala Health (demo)", website: "https://calahealth.com", hq: "San Mateo", foundingDate: "2014", description: "Wearable neuromodulation for essential tremor.", confidence: 0.41 },
    ];
  const cap = name.trim().replace(/\b\w/g, (c) => c.toUpperCase());
  return [{ calaId: `${q.replace(/\W+/g, "-")}-demo`, name: `${cap} (demo)`, hq: "London", foundingDate: "2024", description: "Closest match in the demo graph.", confidence: 0.38 }];
}

export function mockContext(body: ContextBuildBody): ContextDoc {
  const cala = body.calaId === "cala-demo";
  const sectors = Object.keys(body.pitchProfile?.sectors ?? {});
  const uploads = body.uploads ?? [];
  return {
    id: body.calaId ?? "ctx-demo",
    company: cala ? { text: "Cala · Barcelona · 2025", basis: "Cala" } : { text: body.pitchProfile?.company ?? "Your company", basis: "You" },
    founders: cala ? [{ text: "2 co-founders, ex-ML research (demo)", basis: "Website" }] : body.pitchProfile?.name ? [{ text: body.pitchProfile.name, basis: "You" }] : [],
    investors: cala ? [{ text: "Kfund", basis: "Cala" }, { text: "Lightspeed", basis: "Cala" }, { text: "Creandum", basis: "Cala" }] : [],
    rounds: cala ? [{ text: "Seed · 2025 · $3–6m", basis: "Cala" }] : body.pitchProfile?.stage ? [{ text: `${body.pitchProfile.stage} · raising`, basis: "You" }] : [],
    product: [
      ...(body.pitchProfile?.oneLiner ? [{ text: body.pitchProfile.oneLiner, basis: "You" as const }] : []),
      ...(sectors.length ? [{ text: sectors.join(", "), basis: "You" as const }] : []),
      ...(cala ? [{ text: "Sourced knowledge graph API", basis: "Website" as const }] : []),
      ...uploads.map((u) => ({ text: `${u.name}: ${u.text.slice(0, 60)}${u.text.length > 60 ? "…" : ""}`, basis: "You" as const })),
    ],
    vision: body.visionText ? { text: body.visionText, basis: "You" } : undefined,
  };
}

export function contextMarkdown(doc: ContextDoc): string {
  const line = (c: { text: string; basis: string }) => `- ${c.text} _(${c.basis})_`;
  return [
    `# ${doc.company.text}`,
    "",
    "## Founders",
    ...doc.founders.map(line),
    "",
    "## Investors",
    ...doc.investors.map(line),
    "",
    "## Rounds",
    ...doc.rounds.map(line),
    "",
    "## Product",
    ...doc.product.map(line),
    "",
    "## Vision",
    doc.vision ? line(doc.vision) : "-",
    "",
  ].join("\n");
}

export function mockActions(company: string, investorIds: string[]): ActionCard[] {
  const net = mockNetwork();
  const events: Record<string, { id: string; name: string; date?: string }[]> = {
    "lightspeed-venture-partners": [{ id: "ev-slush-2026", name: "Slush 2026", date: "2026-11-19" }],
    creandum: [{ id: "ev-slush-2026", name: "Slush 2026", date: "2026-11-19" }],
    kfund: [{ id: "ev-south-summit-2027", name: "South Summit 2027", date: "2027-06-02" }],
    seedcamp: [{ id: "ev-web-summit-2026", name: "Web Summit 2026", date: "2026-11-10" }],
    "index-ventures": [{ id: "ev-slush-2026", name: "Slush 2026", date: "2026-11-19" }],
  };
  return investorIds
    .map((id) => net.nodes.find((n) => n.id === id))
    .filter((n): n is NonNullable<typeof n> => Boolean(n))
    .map((n) => {
      const subject = `${company} × ${n.name}: a path your portfolio has taken`;
      const body = `Hi,\n\nWe are ${company}. Companies you led at seed went on to the round we are planning next; Room's simulation puts ${n.name} on our most likely path.\n\nCould we take 20 minutes, in person or on a call?\n\n— Founder, ${company}`;
      return {
        investorId: n.id,
        name: n.name,
        calaSources: [{ name: `${n.name} in Cala`, url: `/api/cala/entity/${encodeURIComponent(n.id)}` }],
        events: events[n.id] ?? [],
        precedent: { name: "Lovable (demo)", companyId: "lovable-demo" },
        emailDraft: { subject, body },
        mailto: `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
      };
    });
}

export function mockFeed(investorNames: string[]): WatchEvent[] {
  return investorNames.slice(0, 2).map((n, i) => ({ at: i === 0 ? "2h ago" : "yesterday", text: `${n} led a new seed round in your sector` }));
}
