import { afterEach, describe, expect, it } from "vitest";
import fixture from "@/tests/fixtures/spotter-cohort.json";
import { POST } from "@/app/api/spotter/route";
import { backtestSpotter, inLane, investorLane, investorTaste, LANE_MIN_STAGE_SHARE, rankSpotter, runSpotter, simulateFutures, spotterCandidates, spotterIndex, unicornShape, type InvestorTaste } from "@/lib/sim/spotter";
import { tasteFromIndex } from "@/lib/sim/spotter/taste";
import { FUTURE_RUNS, PARTICIPATION_SCALE, pInRound, simModel, stageParticipation, UNICORN_VISION } from "@/lib/sim/spotter/futures";
import { calibratedLift, MIN_STAGE_UNICORNS, seedSampleBase, stageBaseRates } from "@/lib/sim/spotter/shape";
import { simulate, simulateRuns } from "@/lib/sim/simulate";
import { mulberry32, ROUND_STAGES, toMs, type CompanyRow } from "@/lib/sim/spotter/base";
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

describe("calibrated lift", () => {
  it("is 1 at the reference base, grows with the neighbours' share, and falls back without a seed sample", () => {
    expect(calibratedLift(0.5, 0.5, 0.05)).toBeCloseTo(1, 6);
    expect(calibratedLift(0.7, 0.5, 0.05)).toBeGreaterThan(calibratedLift(0.6, 0.5, 0.05));
    expect(calibratedLift(0.3, 0.5, 0.05)).toBeLessThan(1);
    expect(calibratedLift(0.6, 0.3, undefined)).toBeCloseTo(2, 6);
    // A neighbour share twice an enriched base is far less than twice the outcome-blind base rate.
    expect(calibratedLift(0.8, 0.4, 0.05)).toBeLessThan(calibratedLift(0.8, 0.4, undefined) * 3);
    expect(calibratedLift(0.8, 0.4, 0.05) * 0.05).toBeLessThan(0.5);
  });

  it("keeps candidates in the investor's stage lane", () => {
    const taste = (entryDist: InvestorTaste["entryDist"], entryStage: Stage, stageDist: InvestorTaste["stageDist"] = {}) => ({ entryDist, stageDist, entryStage }) as InvestorTaste;
    // Entries, not all rounds: a seed fund's Series B+ follow-ons do not open a Series B+ lane.
    const seedFund = investorLane(taste({ "pre-seed": 0.35, seed: 0.45, "series-a": 0.2 }, "seed", { seed: 0.4, "series-a": 0.25, "series-b-plus": 0.2 }))!;
    expect(seedFund).toEqual({ maxStage: "series-a", nextStages: ["pre-seed", "seed", "series-a"], minShare: LANE_MIN_STAGE_SHARE });
    const growth = investorLane(taste({ "pre-seed": 0.03, seed: 0.13, "series-a": 0.28, "series-b-plus": 0.56 }, "series-b-plus"))!;
    expect(growth.nextStages).toEqual(["series-a", "series-b-plus"]);
    expect(investorLane(taste({}, "seed", { seed: 1 }))!.nextStages).toEqual(["seed"]);
    const row = (stages: Stage[]) => ({ eps: stages.map((stage) => ({ stage })) }) as unknown as CompanyRow;
    expect(inLane(seedFund, row(["pre-seed"]))).toBe(true);
    expect(inLane(seedFund, row(["pre-seed", "seed"]))).toBe(true);
    // A Series A company's next round is Series B+: a 10% follow-on tail, not the seed fund's lane.
    expect(inLane(seedFund, row(["seed", "series-a"]))).toBe(false);
    expect(inLane(growth, row(["pre-seed"]))).toBe(false);
    expect(inLane(growth, row(["seed", "series-a"]))).toBe(true);
    expect(investorLane(taste({}, "seed"))).toBeUndefined();
    expect(inLane(undefined, row(["series-b-plus"]))).toBe(true);
    const idx = spotterIndex(cohort);
    const t = tasteFromIndex(idx, "inv:seedcamp");
    for (const c of spotterCandidates(idx, t)) expect(inLane(investorLane(t), c.row)).toBe(true);
  });

  it("computes stage-matched base rates from seed-sample companies, backing off sparse stages", () => {
    const tagged = structuredClone(cohort);
    for (const c of Object.values(tagged.companies)) c.sampledBy = "seed-sample";
    const idx = spotterIndex(tagged);
    const { byStage, basis } = stageBaseRates(idx);
    expect(basis).toBe("seed-sample");
    const raise = simModel(tagged, idx.asOf).baseRates;
    for (let i = ROUND_STAGES.length - 1; i >= 0; i--) {
      const s = ROUND_STAGES[i];
      let reached = 0;
      let unicorns = 0;
      for (const r of idx.rows.values()) {
        if (r.outcome === "open" || !r.eps.some((e) => e.stage === s)) continue;
        reached++;
        if (r.outcome === "unicorn") unicorns++;
      }
      if (!reached) continue;
      const b = byStage[s]!;
      expect(b).toMatchObject({ reached, unicorns });
      const next = byStage[ROUND_STAGES[i + 1]];
      if (unicorns < MIN_STAGE_UNICORNS && next) expect(b.rate).toBeCloseTo(raise[s]!.p * next.rate, 9);
      else expect(b.rate).toBeCloseTo((unicorns + 0.5) / (reached + 1), 9);
    }
    expect(stageBaseRates(spotterIndex(cohort)).basis).toBe("cohort");
  });

  it("reads the base rate from seed-sample companies only", () => {
    expect(seedSampleBase(spotterIndex(cohort))).toBeUndefined();
    const tagged = structuredClone(cohort);
    for (const c of Object.values(tagged.companies)) c.sampledBy = "seed-sample";
    const idx = spotterIndex(tagged);
    let known = 0;
    let unicorns = 0;
    for (const r of idx.rows.values()) {
      if (r.outcome === "open") continue;
      known++;
      if (r.outcome === "unicorn") unicorns++;
    }
    expect(seedSampleBase(idx)).toBeCloseTo((unicorns + 0.5) / (known + 1), 6);
    const shape = unicornShape(idx, idx.rows.get("c:good")!);
    expect(shape.liftBasis).toBe("seed-sample");
    expect(shape.lift).toBeCloseTo(calibratedLift(shape.shape, shape.base, shape.popBase), 6);
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
    expect(index.runs).toBe(FUTURE_RUNS);
  });

  it("counts the investor's own new-money participation rate toward pOnPath", () => {
    const idx = spotterIndex(cohort);
    const part = stageParticipation(idx, "inv:seedcamp");
    let episodes = 0;
    let joined = 0;
    for (const r of idx.rows.values()) {
      r.eps.forEach((e, k) => {
        if (k === 0 || e.stage !== "seed") return;
        episodes++;
        const earlier = r.eps.slice(0, k).some((x) => x.memberIds.includes("inv:seedcamp"));
        if (!earlier && e.leadId !== "inv:seedcamp" && e.memberIds.includes("inv:seedcamp")) joined++;
      });
    }
    expect(part.seed ?? 0).toBeCloseTo(joined / episodes, 9);
    const step = { stage: "seed" as Stage, leadId: "inv:x", coInvestorIds: ["inv:y"] };
    expect(pInRound({ ...step, leadId: "inv:seedcamp" }, "inv:seedcamp", part)).toBe(1);
    expect(pInRound({ ...step, coInvestorIds: ["inv:seedcamp"] }, "inv:seedcamp", part)).toBe(1);
    expect(pInRound(step, "inv:seedcamp", { seed: 0.1 })).toBeCloseTo(PARTICIPATION_SCALE * 0.1, 9);
    expect(pInRound(step, "inv:seedcamp", {})).toBe(0);
    // pOnPath = mean over runs of 1 - prod(1 - P(in round)) over the next two rounds, which sits
    // above the engine-only share (lead or drawn co-investor) whenever the rate is positive.
    const row = idx.rows.get("c:good")!;
    const fut = simulateFutures(idx, row, "inv:seedcamp");
    const { outs } = simulateRuns({ sectors: {}, stage: row.eps[row.eps.length - 1].stage, companyId: row.co.id }, UNICORN_VISION, simModel(cohort, idx.asOf), { runs: FUTURE_RUNS, naturalLead: true });
    const two = (o: (typeof outs)[number]) => o.steps.slice(0, 2);
    const expected = outs.reduce((a, o) => a + 1 - two(o).reduce((m, s) => m * (1 - pInRound(s, "inv:seedcamp", part)), 1), 0) / outs.length;
    const engineOnly = outs.filter((o) => two(o).some((s) => s.leadId === "inv:seedcamp" || s.coInvestorIds.includes("inv:seedcamp"))).length / outs.length;
    expect(fut.pOnPath).toBeCloseTo(expected, 9);
    expect(fut.pOnPath).toBeGreaterThanOrEqual(engineOnly);
  });

  it("reads pUnicorn off the founder simulator's engine for the same company", () => {
    const idx = spotterIndex(cohort);
    const row = idx.rows.get("c:good")!;
    const fut = simulateFutures(idx, row, "inv:index");
    const start = { sectors: {}, stage: row.eps[row.eps.length - 1].stage, companyId: row.co.id };
    const model = simModel(cohort, idx.asOf);
    const natural = simulate(start, UNICORN_VISION, model, { runs: FUTURE_RUNS, naturalLead: true });
    expect(fut.pUnicorn).toBeCloseTo(natural.tree.reachVisionShare, 3);
    const founder = simulate(start, UNICORN_VISION, model, { runs: 4000 });
    expect(Math.abs(fut.pUnicorn - founder.tree.reachVisionShare)).toBeLessThan(0.08);
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
    const base = stageBaseRates(spotterIndex(cohort)).byStage[p.company.latestRound.stage]!.rate;
    expect(p.scores.unicornBaseRate).toBeCloseTo(base, 3);
    expect(p.scores.unicornLift).toBeCloseTo(p.scores.pUnicorn! / base, 1);
    expect(p.scores.pUnicorn).toBeCloseTo(simulateFutures(spotterIndex(cohort), spotterIndex(cohort).rows.get("c:good")!, "inv:index").pUnicorn, 3);
    for (const x of res.picks) expect(x.scores.combined).toBeLessThanOrEqual(1);
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
