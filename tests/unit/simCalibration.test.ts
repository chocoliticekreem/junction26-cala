import { describe, expect, it } from "vitest";
import { backtest, batchBacktest, calibrationStats } from "@/lib/sim/backtest";
import { PRIOR_STRENGTH_K, STAGE_PRIORS, calibrateStage, reLeadRates, wilson } from "@/lib/sim/calibration";
import { fitModel } from "@/lib/sim/fit";
import { countryOf, investorGeoWeight, parseGeo, precedentGeoWeight } from "@/lib/sim/geo";
import { investorDropReason, isLeadEligible } from "@/lib/sim/quality";
import { Engine, prepare, simulate } from "@/lib/sim/simulate";
import type { Cohort, StartState, Vision } from "@/lib/sim/types";
import { mulberry32 } from "@/lib/sim/util";
import { fixture, makeCohort } from "./simHelpers";

const visionB: Vision = { text: "Series B", targetStage: "series-b-plus", horizonYears: 8 };

// n companies that each raised seed (lead `lead`) and then series A (lead `nextLead`), all old
// enough to be knowable at 2024-06-01.
function raisers(prefix: string, n: number, lead: string, nextLead: string, extra: Partial<{ sector: "fintech" | "healthtech" }> = {}) {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}${i}`,
    ...extra,
    rounds: [
      { stage: "seed" as const, date: "2018-01-01", lead, amount: 3e6 },
      { stage: "series-a" as const, date: "2019-06-01", lead: nextLead, amount: 12e6 },
    ],
  }));
}

describe("investor quality filter", () => {
  it("drops generic placeholders, lists and non-venture foundations", () => {
    for (const n of ["Founders", "Early strategic investors", "Early backers", "+4 others", "General Catalyst and 8 others", "angels from Stripe", "Angels: Mike Krieger", "Previous seed investors", "angels and family offices", "SumUp co-founders", "ComplyAdvantage founder", "investors included D1 Capital Partners", "Additional undisclosed participants", "75+ angel investors", ""]) {
      expect(investorDropReason(n), n).toBe("generic");
    }
    expect(investorDropReason("Schmidt Family Foundation")).toBe("non_investor");
    expect(investorDropReason("Jose Manuel Entrecanales Foundation")).toBe("non_investor");
  });

  it("keeps real investors whose names contain generic words", () => {
    for (const n of ["Foundation Capital", "Founders Fund", "2100 Ventures", "10x Founders", "byFounders", "Global Founders Capital", "Busy Angels", "Sand Hill Angels", "Lightspeed Venture Partners", "Y Combinator"]) {
      expect(investorDropReason(n), n).toBeUndefined();
    }
  });

  it("needs a resolved Cala id or >= 2 rounds to lead", () => {
    expect(isLeadEligible("02f2ee-uuid", 1)).toBe(true);
    expect(isLeadEligible("name:someone", 1)).toBe(false);
    expect(isLeadEligible("name:someone", 2)).toBe(true);
  });

  it("removes dropped investors from the round graph at fit time and re-infers the lead", () => {
    const c = makeCohort("2024-06-01", [
      { id: "a", rounds: [{ stage: "seed", date: "2020-01-01", lead: "junk", others: ["f"] }, { stage: "series-a", date: "2021-01-01", lead: "g" }] },
    ]);
    c.investors.junk.name = "Founders";
    c.rounds["a-r0"].participants[0].name = "Founders";
    const m = fitModel(c);
    expect(m.agentIndex.junk).toBeUndefined();
    expect(m.transitions[0].leadId).toBe("f");
    expect(m.dropped.generic).toBe(1);
  });

  it("never offers a thin unresolved investor as a simulated lead", () => {
    const c = makeCohort("2024-06-01", [
      { id: "a", rounds: [{ stage: "pre-seed", date: "2020-01-01", lead: "name:once" }] },
      { id: "b", rounds: [{ stage: "pre-seed", date: "2020-01-01", lead: "real" }] },
    ]);
    const m = fitModel(c);
    expect(m.agents[m.agentIndex["name:once"]].leadEligible).toBe(false);
    const r = simulate({ sectors: { fintech: 1 }, stage: "pre-seed" }, visionB, m, { runs: 300 });
    const leads = new Set(r.tree.children.flatMap((ch) => ch.topPaths.flatMap((p) => p.steps.map((s) => s.leadId))));
    expect(leads.has("name:once")).toBe(false);
  });
});

describe("calibrated base rates", () => {
  it("replaces a survivorship-biased cohort rate with the prior and says so", () => {
    const b = calibrateStage("seed", 103, 107, STAGE_PRIORS, "full-cohort");
    expect(b).toMatchObject({ source: "prior", biased: true, p: STAGE_PRIORS.seed, population: "full-cohort" });
    expect(b.priorSource).toMatch(/CB Insights/);
  });

  it("blends a plausible cohort rate with the prior; an outcome-blind sample is never capped", () => {
    const plausible = calibrateStage("seed", 20, 50, STAGE_PRIORS, "full-cohort");
    expect(plausible.source).toBe("blend");
    expect(plausible.p).toBeCloseTo((20 + PRIOR_STRENGTH_K * 0.4) / (50 + PRIOR_STRENGTH_K));
    const sample = calibrateStage("seed", 45, 50, STAGE_PRIORS, "seed-sample");
    expect(sample).toMatchObject({ source: "blend", biased: false, population: "seed-sample" });
    expect(sample.p).toBeCloseTo((45 + PRIOR_STRENGTH_K * 0.4) / (50 + PRIOR_STRENGTH_K));
    expect(calibrateStage("seed", 0, 0, STAGE_PRIORS)).toMatchObject({ source: "prior", p: 0.4 });
    expect(calibrateStage("seed", 3, 4, null)).toMatchObject({ source: "cohort", p: 4 / 6 });
  });

  it("counts only knowable transitions: a recent round that already raised again is excluded", () => {
    const c = makeCohort("2024-06-01", [
      { id: "old", rounds: [{ stage: "seed", date: "2019-01-01", lead: "x" }, { stage: "series-a", date: "2020-01-01", lead: "y" }] },
      { id: "recent", rounds: [{ stage: "seed", date: "2023-06-01", lead: "x" }, { stage: "series-a", date: "2024-01-01", lead: "y" }] },
      { id: "stalled", rounds: [{ stage: "seed", date: "2019-01-01", lead: "x" }] },
    ]);
    const m = fitModel(c);
    expect(m.knowableByStage.seed).toEqual({ n: 2, raised: 1 });
    expect(m.byStage.seed).toMatchObject({ n: 3, raised: 2 });
    expect(m.transitions.find((t) => t.companyId === "recent" && t.stage === "seed")?.knowable).toBe(false);
  });

  it("uses only seed-sample companies for outcome rates when the cohort has a seed sample", () => {
    const c = makeCohort("2024-06-01", [
      ...raisers("star", 30, "x", "y"),
      ...Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, rounds: [{ stage: "seed" as const, date: "2018-01-01", lead: "x" }] })),
      ...raisers("sr", 10, "x", "y"),
    ]);
    for (let i = 0; i < 10; i++) {
      c.companies[`s${i}`].sampledBy = "seed-sample";
      c.companies[`sr${i}`].sampledBy = "seed-sample";
    }
    for (let i = 0; i < 30; i++) c.companies[`star${i}`].sampledBy = "cala-network";
    const m = fitModel(c);
    expect(m.outcomePopulation).toEqual({ kind: "seed-sample", companies: 20 });
    expect(m.knowableByStage.seed).toEqual({ n: 20, raised: 10 });
    expect(m.baseRates.seed).toMatchObject({ source: "blend", population: "seed-sample" });
    expect(m.baseRates.seed!.p).toBeCloseTo((10 + PRIOR_STRENGTH_K * 0.4) / (20 + PRIOR_STRENGTH_K));
    // Investor behaviour still comes from everyone: x led 50 seed rounds.
    expect(m.agents[m.agentIndex.x].leadStageCounts.seed).toBe(50);
  });

  it("brings a pre-seed founder's odds of Series B down to low single digits on a biased cohort", () => {
    const c = makeCohort("2024-06-01", Array.from({ length: 40 }, (_, i) => ({
      id: `c${i}`,
      rounds: [
        { stage: "pre-seed" as const, date: "2015-01-01", lead: "p", amount: 1e6 },
        { stage: "seed" as const, date: "2016-01-01", lead: "s", amount: 4e6 },
        { stage: "series-a" as const, date: "2017-01-01", lead: "a", amount: 15e6 },
        { stage: "series-b-plus" as const, date: "2018-01-01", lead: "b", amount: 50e6 },
      ],
    })));
    const raw = simulate({ sectors: { fintech: 1 }, stage: "pre-seed" }, visionB, fitModel(c, undefined, { priors: null }), { runs: 3000 });
    const cal = simulate({ sectors: { fintech: 1 }, stage: "pre-seed" }, visionB, fitModel(c), { runs: 3000 });
    expect(raw.tree.reachVisionShare).toBeGreaterThan(0.6);
    expect(cal.tree.reachVisionShare).toBeLessThan(0.1);
    expect(cal.calibration.baseRates.filter((b) => b.biased).map((b) => b.stage)).toEqual(["pre-seed", "seed", "series-a"]);
    // Every company stalled after its B+ round, so that cohort rate is below the prior and is blended in.
    expect(cal.calibration.baseRates.find((b) => b.stage === "series-b-plus")?.source).toBe("blend");
    expect(cal.calibration.conditionalOnFirstRound).toBe(true);
    expect(cal.calibration.notes.join(" ")).toMatch(/survivorship/);
  });
});

describe("re-lead stickiness", () => {
  it("measures the re-lead rate per stage with smoothing", () => {
    const r = reLeadRates([...Array(9).fill({ from: "seed", same: false }), { from: "seed", same: true }]);
    expect(r.overall).toMatchObject({ n: 10, same: 1 });
    expect(r.byStage.seed!.rate).toBeCloseTo((1 + 5 * (2 / 12)) / (10 + 5));
  });

  it("caps the simulated re-lead share at the measured rate even when ties favour the incumbent", () => {
    // x led seed for 20 companies and also led 10 of their Series As; others led the rest.
    const cos = [...raisers("r", 10, "x", "x"), ...raisers("o", 10, "x", "y"), ...raisers("q", 10, "z", "y")];
    const m = fitModel(makeCohort("2024-06-01", cos));
    const rate = m.reLead.byStage.seed!.rate;
    expect(rate).toBeCloseTo((10 + 5 * (11 / 32)) / (30 + 5));
    const c = makeCohort("2024-06-01", [...cos, { id: "me", rounds: [{ stage: "seed", date: "2024-01-01", lead: "x" }] }]);
    const m2 = fitModel(c);
    const prep = prepare({ sectors: { fintech: 1 }, stage: "seed", companyId: "me" }, visionB, m2);
    const e = new Engine(m2, prep);
    const cdf = e.leadWeights("series-a", "fintech", ["x"], "x", undefined, "seed");
    const share = (j: number) => cdf.cdf[cdf.idx.indexOf(j)] - (cdf.idx.indexOf(j) > 0 ? cdf.cdf[cdf.idx.indexOf(j) - 1] : 0);
    expect(share(m2.agentIndex.x)).toBeCloseTo(m2.reLead.byStage.seed!.rate, 5);
    // Without the from-stage (no constraint) x would dominate.
    const free = e.leadWeights("series-a", "fintech", ["x"], "x");
    const freeShare = free.cdf[free.idx.indexOf(m2.agentIndex.x)] - (free.idx.indexOf(m2.agentIndex.x) > 0 ? free.cdf[free.idx.indexOf(m2.agentIndex.x) - 1] : 0);
    expect(freeShare).toBeGreaterThan(share(m2.agentIndex.x));
  });
});

describe("geography", () => {
  it("reads the country that appears first in free-text locations", () => {
    expect(countryOf("London, United Kingdom")).toBe("GB");
    expect(countryOf("Barcelona, ES")).toBe("ES");
    expect(countryOf("Austin, Texas, USA (also offices in Budapest, London, and Singapore)")).toBe("US");
    expect(countryOf("Karlsruhe, Germany (US address: 541 Jefferson Ave., Redwood City, CA)")).toBe("DE");
    expect(countryOf("Prague, Czech Republic (incorporated in Dover, Delaware, USA)")).toBe("CZ");
    expect(countryOf("Rothschild Boulevard 45, Tel Aviv-Yafo, Israel")).toBe("IL");
    expect(countryOf("help us grow")).toBeUndefined();
    expect(parseGeo("somewhere in Europe")).toMatchObject({ region: "europe" });
  });

  it("weights lead candidates by their real deal geography, with backoff", () => {
    const cos = [
      ...Array.from({ length: 6 }, (_, i) => ({ id: `uk${i}`, rounds: [{ stage: "seed" as const, date: "2019-01-01", lead: "ukfund" }] })),
      ...Array.from({ length: 6 }, (_, i) => ({ id: `us${i}`, rounds: [{ stage: "seed" as const, date: "2019-01-01", lead: "usfund" }] })),
    ];
    const c: Cohort = makeCohort("2024-06-01", cos);
    for (let i = 0; i < 6; i++) {
      c.companies[`uk${i}`].hq = "London, United Kingdom";
      c.companies[`us${i}`].country = "United States";
    }
    const m = fitModel(c);
    const london = parseGeo("London");
    const uk = m.agents[m.agentIndex.ukfund];
    const us = m.agents[m.agentIndex.usfund];
    expect(investorGeoWeight(uk.geo, m.geoBase, london)).toBeGreaterThan(5 * investorGeoWeight(us.geo, m.geoBase, london));
    expect(investorGeoWeight(us.geo, m.geoBase, {})).toBe(1);
    const run = (geography?: string) => {
      const start: StartState = { sectors: { fintech: 1 }, stage: "seed", geography };
      const prep = prepare(start, visionB, m);
      const e = new Engine(m, prep);
      const cdf = e.leadWeights("seed", "fintech", [], undefined);
      const k = cdf.idx.indexOf(m.agentIndex.ukfund);
      return cdf.cdf[k] - (k > 0 ? cdf.cdf[k - 1] : 0);
    };
    expect(run()).toBeCloseTo(0.5, 5);
    expect(run("London")).toBeGreaterThan(0.85);
    expect(precedentGeoWeight(c, "uk0", london)).toBe(1);
    expect(precedentGeoWeight(c, "us0", london)).toBe(0.25);
    expect(precedentGeoWeight(c, "us0", {})).toBe(1);
  });
});

describe("amounts, sample sizes and bands", () => {
  it("draws later Series B+ rounds from the larger later-round distribution", () => {
    const c = makeCohort("2024-06-01", Array.from({ length: 8 }, (_, i) => ({
      id: `c${i}`,
      rounds: [
        { stage: "series-b-plus" as const, date: "2018-01-01", lead: "x", amount: 40e6 + i * 1e6 },
        { stage: "series-b-plus" as const, date: "2019-06-01", lead: "y", amount: 150e6 + i * 1e6 },
      ],
    })));
    const m = fitModel(c);
    expect(m.bPlusAmounts[0]).toHaveLength(8);
    expect(m.bPlusAmounts[1][0]).toBeGreaterThanOrEqual(150e6);
    const e = new Engine(m, prepare({ sectors: { fintech: 1 }, stage: "series-b-plus" }, visionB, m));
    const rnd = mulberry32(3);
    expect(e.amount("series-b-plus", rnd, 0)!).toBeLessThan(50e6);
    expect(e.amount("series-b-plus", rnd, 1)!).toBeGreaterThanOrEqual(150e6);
  });

  it("reports sampleSize as distinct real companies with a Wilson band around the share", () => {
    const m = fitModel(fixture);
    const r = simulate({ sectors: { fintech: 1 }, stage: "pre-seed" }, visionB, m, { runs: 2000 });
    const knowable = new Set(m.transitions.filter((t) => t.knowable && t.stage === "pre-seed" && t.sector === "fintech").map((t) => t.companyId));
    expect(r.tree.sampleSize).toBe(knowable.size);
    for (const n of [r.tree, ...r.tree.children]) {
      expect(n.confidenceBand.lo).toBeLessThanOrEqual(n.reachVisionShare + 1e-9);
      expect(n.confidenceBand.hi).toBeGreaterThanOrEqual(n.reachVisionShare - 1e-9);
    }
    expect(r.calibration.sampleSizeMeaning).toMatch(/distinct real cohort companies/);
    expect(r.calibration.baseRates.map((b) => b.stage)).toEqual(["pre-seed", "seed", "series-a", "series-b-plus"]);
    expect(wilson(0, 0)).toEqual({ lo: 0, hi: 1 });
  });
});

describe("backtests", () => {
  it("starts after an accelerator-led first round (programme entry)", () => {
    const c = makeCohort(
      "2024-06-01",
      [
        { id: "t", rounds: [{ stage: "seed", date: "2015-06-29", lead: "ef" }, { stage: "series-a", date: "2017-02-13", lead: "zetta" }] },
        { id: "o", rounds: [{ stage: "seed", date: "2014-01-01", lead: "ef" }, { stage: "series-a", date: "2015-01-01", lead: "zetta" }] },
      ],
      { ef: "accelerator" },
    );
    const r = backtest("t", "2015-06-01", c, { runs: 300 });
    expect(r.programmeStep).toEqual({ leadName: "EF", date: "2015-06-29" });
    expect(r.asOf).toBe("2015-06-30");
    expect(r.realFirstLead).toBe("ZETTA");
    expect(r.rankOfRealFirstLead).toBe(1);
  });

  it("scores Brier and reliability bins", () => {
    const s = calibrationStats([{ p: 0.9, y: true }, { p: 0.1, y: false }, { p: 0.5, y: true }, { p: 0.5, y: false }]);
    expect(s.brier).toBeCloseTo((0.01 + 0.01 + 0.25 + 0.25) / 4);
    expect(s.baseRateBrier).toBeCloseTo(0.25);
    expect(s.bins.find((b) => b.lo === 0.4)!.n).toBe(2);
  });

  it("batch backtest reports top-k lead hits and calibration for both models", () => {
    const r = batchBacktest(fixture, { runs: 200, fromYear: 2018, toYear: 2024 });
    expect(r.models.map((m) => m.label)).toEqual(["calibrated", "cohort-only (no priors)"]);
    for (const m of r.models) {
      expect(m.cases.length).toBeGreaterThan(0);
      expect(m.leadHits.top10).toBeGreaterThanOrEqual(m.leadHits.top1);
      expect(m.calibration.brier).toBeGreaterThanOrEqual(0);
      for (const c of m.cases) if (c.predictedNext !== undefined) expect(c.predictedNext).toBeLessThanOrEqual(1);
    }
  });
});
