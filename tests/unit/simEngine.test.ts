import { describe, expect, it } from "vitest";
import { backtest } from "@/lib/sim/backtest";
import { buildEpisodes, fitModel } from "@/lib/sim/fit";
import { buildNetwork } from "@/lib/sim/network";
import { simulate } from "@/lib/sim/simulate";
import type { StartState, Vision } from "@/lib/sim/types";
import { LOW_CONFIDENCE_N } from "@/lib/sim/util";
import { parseVision, visionBasis } from "@/lib/sim/vision";
import { findCompanyByName } from "@/lib/cohort";
import { fixture, makeCohort, scaledFixture } from "./simHelpers";

const model = fitModel(fixture);
const founder: StartState = { sectors: { fintech: 0.6, "applied AI/vertical SaaS": 0.4 }, stage: "pre-seed", raiseUsd: 800_000 };
const visionB: Vision = { text: "Series B in 5 years", targetStage: "series-b-plus", horizonYears: 5 };

describe("simulate", () => {
  it("is deterministic for a seed and varies across seeds", () => {
    const a = simulate(founder, visionB, model, { runs: 1500, seed: 42 });
    const b = simulate(founder, visionB, model, { runs: 1500, seed: 42 });
    const c = simulate(founder, visionB, model, { runs: 1500, seed: 43 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a.tree)).not.toBe(JSON.stringify(c.tree));
  });

  it("builds root -> first cheque -> timing for a founder, with consistent counts", () => {
    const r = simulate(founder, visionB, model, { runs: 3000 });
    expect(r.tree.decision).toBeNull();
    expect(r.tree.runs).toBe(3000);
    const opts = r.tree.children.map((c) => c.decision);
    expect(opts).toHaveLength(3);
    expect(opts.every((d) => d?.kind === "first_cheque")).toBe(true);
    expect(r.tree.children.reduce((s, c) => s + c.runs, 0)).toBe(3000);
    for (const c of r.tree.children) {
      expect(c.children.map((g) => g.decision)).toEqual([{ kind: "timing", option: "now" }, { kind: "timing", option: "later_6m" }]);
      expect(c.children.reduce((s, g) => s + g.runs, 0)).toBe(c.runs);
      expect(c.reachVisionShare).toBeGreaterThanOrEqual(0);
      expect(c.reachVisionShare).toBeLessThanOrEqual(1);
      expect(c.lowConfidence).toBe(c.sampleSize < LOW_CONFIDENCE_N);
      expect(c.topPaths.length).toBeGreaterThan(0);
      expect(c.outcomeBands.best).toMatch(/\w/);
    }
    // Best branch first.
    const shares = r.tree.children.map((c) => c.reachVisionShare);
    expect([...shares].sort((x, y) => y - x)).toEqual(shares);
    // Angel-first runs start with an angel lead.
    const angel = r.tree.children.find((c) => c.decision?.kind === "first_cheque" && c.decision.option === "angel")!;
    for (const p of angel.topPaths) expect(model.cohort.investors[p.steps[0].leadId!].kind).toBe("angel");
    expect(r.highways.some((h) => h.from === "you")).toBe(true);
  });

  it("starts a cohort company from its real state and branches on its next lead", () => {
    const cala = findCompanyByName(fixture, "Cala")!;
    expect(cala.id).toBe("fx-co-cala");
    const r = simulate({ sectors: {}, stage: "pre-seed", companyId: cala.id }, parseVision("Cala becomes a unicorn"), model, { runs: 2000 });
    expect(r.start).toMatchObject({ stage: "seed", companyId: cala.id });
    expect(r.start.existingInvestors.map((i) => i.id)).toEqual(expect.arrayContaining(["fx-inv-031", "fx-inv-042"]));
    expect(r.tree.label).toContain("Cala");
    expect(r.tree.children.length).toBeGreaterThan(1);
    for (const c of r.tree.children) {
      expect(c.decision?.kind).toBe("lead");
      expect(c.label).toMatch(/^Next lead: /);
      for (const p of c.topPaths) if (p.steps[0]) expect(p.steps[0].stage).toBe("series-a");
    }
    expect(r.visionBasis.kind).toBe("proxy");
  });

  it("returns 1-5 realities ordered best to worst with real precedents", () => {
    const r = simulate(founder, visionB, model, { runs: 3000 });
    expect(r.realities.length).toBeGreaterThanOrEqual(1);
    expect(r.realities.length).toBeLessThanOrEqual(5);
    const order = { reached_vision: 2, horizon: 1, stalled: 0 };
    const ranks = r.realities.map((x) => order[x.outcome]);
    expect([...ranks].sort((a, b) => b - a)).toEqual(ranks);
    const total = r.realities.reduce((s, x) => s + x.probability, 0);
    expect(total).toBeLessThanOrEqual(1.0001);
    for (const x of r.realities) {
      expect(x.lowConfidence).toBe(x.sampleSize < LOW_CONFIDENCE_N);
      for (const p of x.precedents) expect(fixture.companies[p.companyId]).toBeDefined();
      for (const s of x.steps) expect(s.year).toBeGreaterThanOrEqual(1);
    }
  });

  it("precedents are real cohort companies with real round ids, stalled ones included", () => {
    const r = simulate(founder, visionB, model, { runs: 1000 });
    expect(r.precedents.length).toBeGreaterThan(3);
    for (const p of r.precedents) for (const s of p.path) expect(fixture.rounds[s.roundId].companyId).toBe(p.companyId);
    const stalledIds = new Set(model.transitions.filter((t) => t.outcome === "stalled").map((t) => t.companyId));
    expect(r.precedents.some((p) => stalledIds.has(p.companyId))).toBe(true);
    expect(r.precedents.some((p) => p.reachedVision)).toBe(true);
  });

  it("judges a unicorn vision on sourced valuations when the cohort has them", () => {
    const c = makeCohort("2024-06-01", [
      { id: "u", maxValuationUsd: 2e9, rounds: [{ stage: "series-a", date: "2019-01-01", lead: "x", amount: 2e7 }, { stage: "series-b-plus", date: "2020-06-01", lead: "y", amount: 8e7 }] },
      { id: "n", rounds: [{ stage: "series-a", date: "2019-01-01", lead: "x", amount: 2e7 }, { stage: "series-b-plus", date: "2020-06-01", lead: "y", amount: 3e8 }] },
    ]);
    const m = fitModel(c);
    const b = visionBasis(parseVision("we become a unicorn"), m);
    expect(b).toMatchObject({ kind: "valuation", targetValuationUsd: 1e9, fundingThresholdUsd: 1e8 });
    const r = simulate({ sectors: { fintech: 1 }, stage: "series-a" }, parseVision("we become a unicorn"), m, { runs: 200 });
    const byId = Object.fromEntries(r.precedents.map((p) => [p.companyId, p.reachedVision]));
    expect(byId).toEqual({ u: true, n: false });
  });
});

describe("parseVision", () => {
  it("maps unicorn language to a $1B valuation target", () => {
    for (const t of ["Cala becomes a unicorn", "a billion-dollar company", "a $1B valuation"]) {
      expect(parseVision(t)).toMatchObject({ targetValuationUsd: 1e9, targetStage: "series-b-plus" });
    }
  });
  it("reads stages, headcount, funding and horizon", () => {
    expect(parseVision("Series A in 3 years with 50 employees")).toMatchObject({ targetStage: "series-a", horizonYears: 3, targetHeadcount: 50 });
    expect(parseVision("We IPO having raised $200m")).toMatchObject({ targetStage: "series-b-plus", targetFundingUsd: 2e8 });
    expect(parseVision("leading fintech for SMEs").sector).toBe("fintech");
    expect(parseVision("")).toMatchObject({ targetStage: "series-b-plus", horizonYears: 5 });
  });
});

describe("backtest", () => {
  it("recovers the planted accelerator -> fund pattern (Forge Labs -> Kestrel) in the top 3", () => {
    const forge = Object.values(fixture.investors).find((i) => i.name.startsWith("Forge Labs"))!.id;
    const kestrel = Object.values(fixture.investors).find((i) => i.name.startsWith("Kestrel Ventures"))!.name;
    const eps = buildEpisodes(fixture, Infinity);
    const cases = Object.entries(eps).filter(([, e]) => e[0].stage === "pre-seed" && e[0].leadId === forge && e[1]);
    expect(cases.length).toBeGreaterThanOrEqual(5);
    let hits = 0;
    for (const [id, e] of cases) {
      const asOf = new Date((e[0].dateMs + e[1].dateMs) / 2).toISOString().slice(0, 10);
      const r = backtest(id, asOf, fixture, { runs: 1000 });
      if (r.topLeads.slice(0, 3).includes(kestrel)) hits++;
    }
    expect(hits / cases.length).toBeGreaterThanOrEqual(0.8);
  });

  it("reports the real path and the rank of the real first lead", () => {
    const r = backtest("fx-co-009", "2024-01-15", fixture, { runs: 1000 });
    expect(r.realPath.path.length).toBeGreaterThan(1);
    expect(r.rankOfRealFirstLead).not.toBeNull();
    expect(r.topLeads.length).toBeGreaterThan(0);
  });
});

describe("network", () => {
  it("returns top investors and edges between them", () => {
    const n = buildNetwork(model);
    expect(n.nodes.length).toBe(model.agents.length);
    const ids = new Set(n.nodes.map((x) => x.id));
    expect(n.edges.length).toBeGreaterThan(0);
    for (const e of n.edges) expect(ids.has(e.from) && ids.has(e.to)).toBe(true);
    expect(n.edges.some((e) => e.kind === "follow_on")).toBe(true);
    expect(buildNetwork(model, 10).nodes).toHaveLength(10);
  });
});

describe("performance", () => {
  const time = (fn: () => void) => {
    const t = performance.now();
    fn();
    return performance.now() - t;
  };
  it("5,000 runs in under 1.5 s on the fixture", () => {
    simulate(founder, visionB, model, { runs: 500 });
    const ms = time(() => simulate(founder, parseVision("unicorn"), model, { runs: 5000 }));
    console.log(`perf: fixture 5000 runs ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(1500);
  });
  it("5,000 runs in under 1.5 s on a ~900-company cohort", () => {
    const big = scaledFixture(6);
    let m = model;
    const fitMs = time(() => {
      m = fitModel(big);
    });
    const ms = time(() => simulate(founder, parseVision("unicorn"), m, { runs: 5000 }));
    const msCo = time(() => simulate({ sectors: {}, stage: "seed", companyId: "fx-co-cala-x1" }, parseVision("unicorn"), m, { runs: 5000 }));
    console.log(`perf: ${Object.keys(big.companies).length} companies, ${m.agents.length} agents; fit ${fitMs.toFixed(0)} ms, founder ${ms.toFixed(0)} ms, company ${msCo.toFixed(0)} ms`);
    expect(ms).toBeLessThan(1500);
    expect(msCo).toBeLessThan(1500);
  });
});
