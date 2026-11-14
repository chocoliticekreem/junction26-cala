import { afterEach, describe, expect, it } from "vitest";
import fixture from "@/tests/fixtures/spotter-cohort.json";
import { POST } from "@/app/api/spotter/route";
import { backtestSpotter, investorTaste, rankSpotter, runSpotter, simulateFutures, spotterCandidates, spotterIndex, unicornShape } from "@/lib/sim/spotter";
import { tasteFromIndex } from "@/lib/sim/spotter/taste";
import { mulberry32, toMs } from "@/lib/sim/spotter/base";
import type { Cohort, CohortCompany, CohortRound, InvestorKind } from "@/lib/sim/types";
import type { Revealed } from "@/lib/types";
import { SECTORS, type Stage } from "@/lib/taxonomy";

const cohort = fixture as unknown as Cohort;

describe("investorTaste", () => {
  it("reads sector, stage, entry stage, lead share and co-investors off the investor's own rounds", () => {
    const t = investorTaste("inv:index", cohort);
    expect(t.name).toBe("Index Ventures (fixture)");
    expect(t.entryStage).toBe("series-a");
    expect(Object.keys(t.sectorDist).sort()).toEqual(["applied AI/vertical SaaS", "fintech"]);
    expect(t.stageDist["series-a"]).toBeGreaterThan(0.2);
    expect(t.stageDist["pre-seed"]).toBeUndefined();
    expect(t.leadShare).toBeGreaterThan(0);
    expect(t.leadShare).toBeLessThan(1);
    expect(t.coInvestors.map((c) => c.id)).toContain("inv:seedcamp");
    expect(t.portfolio.has("c:idx_port")).toBe(true);
    expect(t.chequeBand![0]).toBeLessThanOrEqual(t.chequeBand![1]);
    expect(t.chips.length).toBeGreaterThan(3);
  });

  it("weights led rounds above participations", () => {
    const t = investorTaste("inv:seedcamp", cohort);
    expect(t.stageDist.seed!).toBeGreaterThan(t.stageDist["series-a"]!);
  });

  it("blends revealed vectors for thin histories, but never in a backtest (they are present-day)", () => {
    const revealed: Revealed = { S: { cybersecurity: 1 }, G: { seed: 1 }, chequeBand: [1e6, 3e6], activity: 1, dealCount24m: 3 };
    const now = tasteFromIndex(spotterIndex(cohort), "inv:thin", { revealed });
    expect(now.revealedBlended).toBe(true);
    expect(now.sectorDist.cybersecurity).toBeGreaterThan(0);
    const past = tasteFromIndex(spotterIndex(cohort, "2019-01-01"), "inv:thin", { revealed });
    expect(past.revealedBlended).toBe(false);
    expect(past.sectorDist.cybersecurity).toBeUndefined();
  });
});

describe("candidates", () => {
  it("never includes the investor's own portfolio and keeps first rounds inside the window", () => {
    const idx = spotterIndex(cohort);
    const t = tasteFromIndex(idx, "inv:index");
    const cands = spotterCandidates(idx, t);
    expect(cands.length).toBeGreaterThan(0);
    for (const c of cands) {
      expect(t.portfolio.has(c.row.co.id)).toBe(false);
      expect(c.row.firstMs).toBeGreaterThanOrEqual(idx.asOfMs - 36 * 30.44 * 86400000);
      expect(c.row.outcome).not.toBe("unicorn");
    }
    expect(cands.some((c) => c.row.co.id === "c:idx_port")).toBe(false);
    expect(runSpotter(cohort, { investorId: "inv:index" }).picks.some((p) => p.company.id === "c:idx_port")).toBe(false);
  });

  it("restricts to the given companies when `only` is set, never padding the list", () => {
    const idx = spotterIndex(cohort);
    const t = tasteFromIndex(idx, "inv:index");
    const all = spotterCandidates(idx, t);
    const keep = new Set(all.slice(0, 2).map((c) => c.row.co.id));
    const some = spotterCandidates(idx, t, (c) => keep.has(c.id));
    expect(some.map((c) => c.row.co.id).sort()).toEqual([...keep].sort());
    expect(runSpotter(cohort, { investorId: "inv:index", only: (c) => keep.has(c.id) }).picks).toHaveLength(2);
    expect(runSpotter(cohort, { investorId: "inv:index", only: () => false }).picks).toHaveLength(0);
  });

  it("does not leak anything dated after asOf into a backtest", () => {
    const asOf = "2017-01-01";
    const asOfMs = toMs(asOf)!;
    const res = runSpotter(cohort, { investorName: "Index Ventures", asOf });
    expect(res.picks.length).toBeGreaterThan(0);
    for (const p of res.picks) {
      expect(p.company.id).not.toBe("c:future");
      expect(toMs(p.company.latestRound.date)!).toBeLessThan(asOfMs);
    }
    const idx = spotterIndex(cohort, asOf);
    for (const row of idx.rows.values()) for (const e of row.eps) expect(e.lastDateMs).toBeLessThan(asOfMs);
    // Tractable (fixture) only reaches its $1.2B round in 2018: not a unicorn as of 2017.
    expect(idx.rows.get("c:u0")?.outcome).not.toBe("unicorn");
    expect(spotterIndex(cohort).rows.get("c:u0")?.outcome).toBe("unicorn");
  });
});

describe("unicorn shape", () => {
  it("ranks a planted unicorn-like path above a stalled-like one, with precedents", () => {
    const idx = spotterIndex(cohort);
    const good = unicornShape(idx, idx.rows.get("c:good")!);
    const bad = unicornShape(idx, idx.rows.get("c:bad")!);
    expect(good.shape).toBeGreaterThan(bad.shape * 3);
    expect(good.lift).toBeGreaterThan(1);
    expect(bad.lift).toBeLessThan(1);
    const unicorns = good.neighbours.filter((n) => n.outcome === "unicorn");
    const stalled = good.neighbours.filter((n) => n.outcome === "stalled");
    expect(unicorns.length).toBeGreaterThanOrEqual(2);
    expect(stalled.length).toBe(1);
    expect(unicorns[0].sharedLeads).toEqual(expect.arrayContaining(["Entrepreneur First (fixture)", "Seedcamp (fixture)"]));
    expect(good.depth).toBe(2);
  });
});

describe("simulated futures", () => {
  it("puts a likely next lead on the path far more often than an unrelated angel", () => {
    const idx = spotterIndex(cohort);
    const row = idx.rows.get("c:good")!;
    const index = simulateFutures(idx, row, "inv:index");
    const angel = simulateFutures(idx, row, "inv:angel3");
    expect(index.pOnPath).toBeGreaterThan(angel.pOnPath + 0.2);
    expect(index.pLeadNext).toBeGreaterThan(0);
    expect(index.pLeadNext).toBeLessThanOrEqual(index.pOnPath);
    expect(index.pRaiseNext).toBeGreaterThan(0);
    expect(index.pUnicorn).toBeGreaterThan(0);
    expect(index.runs).toBe(500);
  });

  it("is deterministic", () => {
    const a = runSpotter(cohort, { investorId: "inv:index" });
    const b = runSpotter(cohort, { investorId: "inv:index" });
    expect(a).toEqual(b);
  });
});

describe("runSpotter", () => {
  it("ranks the planted company first for Index and exposes every component", () => {
    const res = runSpotter(cohort, { investorName: "index ventures" });
    expect(res.investor.id).toBe("inv:index");
    expect(res.picks[0].company.id).toBe("c:good");
    const p = res.picks[0];
    expect(p.line).toMatch(/^Same first two steps as /);
    expect(p.scores.pOnPath).toBeGreaterThan(0);
    expect(p.company.latestRound.leadName).toBe("Seedcamp (fixture)");
    expect(p.actions.sharedCoInvestors.map((c) => c.id)).toContain("inv:seedcamp");
    expect(res.basis).toMatch(/^Evidence from \d+ real rounds in Cala, not a forecast$/);
    expect(res.picks.map((x) => x.rank)).toEqual(res.picks.map((_, i) => i + 1));
  });

  it("gives different investors different lists", () => {
    const a = runSpotter(cohort, { investorId: "inv:index" }).picks.map((p) => p.company.id);
    const b = runSpotter(cohort, { investorId: "inv:healthfund" }).picks.map((p) => p.company.id);
    expect(a).not.toEqual(b);
  });

  it("throws a typed error for an unknown investor", () => {
    expect(() => runSpotter(cohort, { investorName: "Nobody Capital" })).toThrow(/No investor/);
  });

  it("reports why a backtest target is missing", () => {
    const row = backtestSpotter(cohort, "Index Ventures", "2026-06-01", ["Planted Rocket (fixture)", "Index Portfolio (fixture)", "Nope"]);
    expect(row.targets[0]).toMatchObject({ rank: 1, inTop20: true });
    expect(row.targets[1]).toMatchObject({ rank: null, reason: "already in this investor's portfolio by asOf" });
    expect(row.targets[2]).toMatchObject({ rank: null, reason: "not in cohort" });
  });
});

describe("POST /api/spotter", () => {
  const prev = process.env.E2E_MOCK;
  afterEach(() => {
    if (prev === undefined) delete process.env.E2E_MOCK;
    else process.env.E2E_MOCK = prev;
  });
  const call = (body: unknown) => POST(new Request("http://x/api/spotter", { method: "POST", body: JSON.stringify(body) }));

  it("validates input", async () => {
    expect((await call({})).status).toBe(400);
    expect((await call({ investorName: "Index", asOf: "2016" })).status).toBe(400);
    expect((await call({ investorName: "Index", at: "Slush 2026!" })).status).toBe(400);
  });

  it("with at=slush-2026 the mock returns only attendees, each tagged with the event", async () => {
    process.env.E2E_MOCK = "1";
    const a = await (await call({ investorName: "Seedcamp", at: "slush-2026" })).json();
    expect(a.picks.length).toBeLessThan(5);
    expect(a.picks.every((p: { event?: { name: string } }) => p.event?.name === "Slush 2026")).toBe(true);
  });

  it("returns a deterministic mock under E2E_MOCK=1", async () => {
    process.env.E2E_MOCK = "1";
    const a = await (await call({ investorName: "Seedcamp" })).json();
    const b = await (await call({ investorName: "Seedcamp" })).json();
    expect(a).toEqual(b);
    expect(a.mock).toBe(true);
    expect(a.picks).toHaveLength(5);
  });
});

// A ~900-company synthetic cohort shaped like the real one, for the < 2 s budget.
function synthetic(n: number): Cohort {
  const rnd = mulberry32(42);
  const kinds: InvestorKind[] = ["fund", "fund", "fund", "angel", "accelerator", "cvc"];
  const investors: Cohort["investors"] = {};
  for (let i = 0; i < 160; i++) investors[`i${i}`] = { id: `i${i}`, name: `Investor ${i}`, kind: kinds[i % kinds.length] };
  const companies: Record<string, CohortCompany> = {};
  const rounds: Record<string, CohortRound> = {};
  const stages: Stage[] = ["pre-seed", "seed", "series-a", "series-b-plus", "series-b-plus"];
  for (let c = 0; c < n; c++) {
    const id = `c${c}`;
    let ms = Date.UTC(2010, 0, 1) + rnd() * 16 * 365 * 86400000;
    const depth = 1 + Math.floor(rnd() * rnd() * 5);
    const roundIds: string[] = [];
    let amount = 2e5 + rnd() * 1e6;
    let maxVal = 0;
    for (let k = 0; k < depth && ms < Date.UTC(2026, 10, 1); k++) {
      const rid = `${id}r${k}`;
      const lead = `i${Math.floor(rnd() * 160)}`;
      const parts = [{ investorId: lead, name: investors[lead].name, kind: investors[lead].kind, isLead: true }];
      for (let j = 0; j < Math.floor(rnd() * 4); j++) {
        const o = `i${Math.floor(rnd() * 160)}`;
        if (o !== lead) parts.push({ investorId: o, name: investors[o].name, kind: investors[o].kind, isLead: false });
      }
      const val = amount * (5 + rnd() * 10);
      maxVal = Math.max(maxVal, val);
      rounds[rid] = { id: rid, companyId: id, stage: stages[k], label: stages[k], date: new Date(ms).toISOString().slice(0, 10), amountUsd: Math.round(amount), valuationUsd: k >= 3 ? Math.round(val) : undefined, participants: parts, sources: [] };
      roundIds.push(rid);
      ms += (8 + rnd() * 30) * 30.44 * 86400000;
      amount *= 2 + rnd() * 5;
    }
    companies[id] = { id, name: `Company ${c}`, sector: SECTORS[c % SECTORS.length], status: "active", roundIds, sources: [], maxValuationUsd: maxVal };
  }
  return { version: 1, asOf: "2026-11-01", companies, rounds, investors };
}

describe("performance", () => {
  it("answers for one investor on a 900-company cohort in under 2 s (cold index)", () => {
    const big = synthetic(900);
    const t0 = performance.now();
    const res = runSpotter(big, { investorId: "i0" });
    const cold = performance.now() - t0;
    const t1 = performance.now();
    runSpotter(big, { investorId: "i1" });
    const warm = performance.now() - t1;
    console.log(`spotter perf: cold ${Math.round(cold)} ms, warm ${Math.round(warm)} ms, ${res.considered.candidates} candidates, ${res.considered.simulated} simulated`);
    expect(res.picks.length).toBe(20);
    expect(cold).toBeLessThan(2000);
    expect(rankSpotter(big, { investorId: "i0" }).ranked.length).toBe(res.considered.candidates);
  });
});
