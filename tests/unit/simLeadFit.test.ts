import { describe, expect, it } from "vitest";
import { leadGeoShares } from "@/lib/sim/fit";
import { GEO_FLOOR, emptyGeoCounts, addGeo, parseGeo, stageGeoWeight } from "@/lib/sim/geo";
import { SIZE_FLOOR, logSizeFit } from "@/lib/sim/simulate";
import type { LeadGeoShares } from "@/lib/sim/types";
import { findCompanyByName, loadCohort, loadCohortModel } from "@/lib/cohort";
import { parseVision } from "@/lib/sim/vision";
import { Engine, prepare } from "@/lib/sim/simulate";

describe("lead size fit", () => {
  it("scores a 3x miss low and a 5x miss near zero", () => {
    expect(logSizeFit(10e6, [10e6])).toBeCloseTo(1, 6);
    expect(logSizeFit(30e6, [10e6])).toBeLessThan(0.1);
    expect(logSizeFit(50e6, [10e6])).toBeLessThan(0.01);
    expect(logSizeFit(10e6, [])).toBe(0);
  });

  it("averages over the investor's led sizes", () => {
    expect(logSizeFit(20e6, [20e6, 2e6])).toBeCloseTo((1 + logSizeFit(20e6, [2e6])) / 2, 6);
  });
});

describe("stage geography", () => {
  const es = parseGeo("Barcelona, Spain");
  const gb = parseGeo("London");
  const us = parseGeo("San Francisco");

  it("measures same country / region / elsewhere by stage, leaving the measured round out", () => {
    const geoAcc = { local: emptyGeoCounts(), uk: emptyGeoCounts() };
    for (let i = 0; i < 4; i++) addGeo(geoAcc.local, es);
    for (let i = 0; i < 4; i++) addGeo(geoAcc.uk, gb);
    const out = leadGeoShares(
      [
        { stage: "seed", leadId: "local", geo: es },
        { stage: "series-a", leadId: "uk", geo: es },
        { stage: "series-a", leadId: "uk", geo: us },
        { stage: "seed", leadId: "nobody", geo: es },
      ],
      geoAcc,
      1,
    );
    expect(out.byStage.seed).toEqual({ n: 1, country: 1, region: 0, elsewhere: 0 });
    expect(out.byStage["series-a"]).toEqual({ n: 2, country: 0, region: 0.5, elsewhere: 0.5 });
    expect(out.overall.n).toBe(3);
  });

  it("gives an investor that mirrors the cohort the same weight at every stage, and favours local funds more where leads are local", () => {
    const base = emptyGeoCounts();
    for (let i = 0; i < 20; i++) addGeo(base, es);
    for (let i = 0; i < 40; i++) addGeo(base, gb);
    for (let i = 0; i < 40; i++) addGeo(base, us);
    const local: LeadGeoShares = { n: 100, country: 0.8, region: 0.1, elsewhere: 0.1 };
    const global: LeadGeoShares = { n: 100, country: 0.2, region: 0.3, elsewhere: 0.5 };
    const mirror = base;
    expect(stageGeoWeight(mirror, base, es, { stage: local, overall: local })).toBeCloseTo(1 + GEO_FLOOR, 1);
    expect(stageGeoWeight(mirror, base, es, { stage: global, overall: global })).toBeCloseTo(1 + GEO_FLOOR, 1);
    const spanish = emptyGeoCounts();
    for (let i = 0; i < 20; i++) addGeo(spanish, es);
    const atSeed = stageGeoWeight(spanish, base, es, { stage: local, overall: local });
    const atB = stageGeoWeight(spanish, base, es, { stage: global, overall: global });
    expect(atSeed).toBeGreaterThan(atB);
    expect(stageGeoWeight(spanish, base, {}, { stage: local, overall: local })).toBe(1);
  });

  it("backs off to the pooled shares when a stage is thin", () => {
    const base = emptyGeoCounts();
    for (let i = 0; i < 10; i++) addGeo(base, gb);
    for (let i = 0; i < 10; i++) addGeo(base, us);
    const thin: LeadGeoShares = { n: 3, country: 1, region: 0, elsewhere: 0 };
    const pooled: LeadGeoShares = { n: 300, country: 0.5, region: 0.2, elsewhere: 0.3 };
    expect(stageGeoWeight(base, base, gb, { stage: thin, overall: pooled })).toBe(stageGeoWeight(base, base, gb, { stage: pooled, overall: pooled }));
  });
});

describe("Cala next lead (real cohort)", () => {
  const cohort = loadCohort();
  const model = loadCohortModel();
  const co = findCompanyByName(cohort, "Cala");

  it.skipIf(!co)("draws a Series A sized off the seed and drops leads that never led a round near it", () => {
    const prep = prepare({ companyId: co!.id, sectors: { "AI infrastructure": 0.6, "developer tools": 0.4 }, stage: "pre-seed" }, parseVision("Cala becomes a unicorn"), model);
    const e = new Engine(model, prep);
    const typical = e.typicalAmount("series-a", prep.lastAmountUsd, "seed")!;
    expect(typical).toBeGreaterThan(2 * prep.lastAmountUsd!);
    const c = e.leadWeights("series-a", "AI infrastructure", prep.members, prep.lastLead, undefined, "seed", typical);
    const top = Array.from(c.idx)
      .map((j, i) => ({ a: model.agents[j], p: c.cdf[i] - (i ? c.cdf[i - 1] : 0) }))
      .sort((x, y) => y.p - x.p)
      .slice(0, 4);
    for (const { a } of top) {
      const led = a.ledAmounts["series-a"] ?? [];
      expect(led.some((x) => x >= typical / 3 && x <= typical * 3)).toBe(true);
      expect(e.sizeFit(a, "series-a", typical)).toBeGreaterThan(SIZE_FLOOR);
    }
    expect(top.map(({ a }) => a.name)).not.toContain("Samaipata VC");
  });
});
