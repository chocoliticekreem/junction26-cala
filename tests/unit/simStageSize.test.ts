import { describe, expect, it } from "vitest";
import { SIZE_SHRINK_K, fitModel } from "@/lib/sim/fit";
import { Engine, prepare, simulate } from "@/lib/sim/simulate";
import { MIN_BAND_ROUNDS, effectiveStage, sizeBands, sizeTercile, stageNote, type SizeBands } from "@/lib/sim/stageSize";
import type { Cohort, Vision } from "@/lib/sim/types";
import { makeCohort } from "./simHelpers";

const band = (p25: number, p50: number, p75: number) => ({ n: 100, p25, p33: (p25 + p50) / 2, p50, p67: (p50 + p75) / 2, p75 });
const bands: SizeBands = {
  "pre-seed": band(0.3e6, 0.9e6, 2e6),
  seed: band(1.6e6, 3.2e6, 6.9e6),
  "series-a": band(7.5e6, 15e6, 25e6),
  "series-b-plus": band(26e6, 75e6, 175e6),
};

describe("effective stage from round size", () => {
  it("moves a seed-sized 'pre-seed' to seed (Cala: $7.6M, Lightspeed)", () => {
    expect(effectiveStage("pre-seed", 7.56e6, bands)).toBe("seed");
  });

  it("keeps the label when the amount is within the label's range", () => {
    expect(effectiveStage("pre-seed", 1.5e6, bands)).toBe("pre-seed");
    expect(effectiveStage("seed", 5e6, bands)).toBe("seed");
  });

  it("needs both: above the label's p75 and at least the next stage's p25", () => {
    const tight: SizeBands = { ...bands, seed: band(3e6, 4e6, 6e6) };
    expect(effectiveStage("pre-seed", 2.5e6, tight)).toBe("pre-seed");
    expect(effectiveStage("pre-seed", 3e6, tight)).toBe("seed");
  });

  it("never moves more than one stage and never down", () => {
    expect(effectiveStage("pre-seed", 50e6, bands)).toBe("seed");
    expect(effectiveStage("series-a", 0.2e6, bands)).toBe("series-a");
    expect(effectiveStage("series-b-plus", 2e9, bands)).toBe("series-b-plus");
  });

  it("keeps the label without an amount or a band", () => {
    expect(effectiveStage("pre-seed", undefined, bands)).toBe("pre-seed");
    expect(effectiveStage("pre-seed", 7.56e6, undefined)).toBe("pre-seed");
    expect(effectiveStage("pre-seed", 7.56e6, { "pre-seed": bands["pre-seed"] })).toBe("pre-seed");
  });

  it("explains the move with the next stage's interquartile range", () => {
    expect(stageNote("pre-seed", "seed", 7.56e6, bands)).toBe("Labelled Pre-seed; $7.6M is seed-sized in the cohort (seed p25-p75: $1.6M-$6.9M).");
    expect(stageNote("seed", "seed", 7.56e6, bands)).toBeUndefined();
  });

  it("builds bands only from stages with enough sized rounds", () => {
    const rounds = Array.from({ length: MIN_BAND_ROUNDS }, (_, i) => ({ stage: "seed" as const, amountUsd: (i + 1) * 1e5 }));
    const b = sizeBands([...rounds, { stage: "pre-seed", amountUsd: 1e5 }, { stage: "seed", amountUsd: undefined }]);
    expect(b.seed?.n).toBe(MIN_BAND_ROUNDS);
    expect(b["pre-seed"]).toBeUndefined();
    expect(sizeTercile("seed", 1e5, b)).toBe(0);
    expect(sizeTercile("seed", 2e6, b)).toBe(2);
    expect(sizeTercile("series-a", 2e6, b)).toBeUndefined();
  });
});

// Seed-sample cohort, asOf 2024-06-01, every round old enough to be knowable:
//   30 pre-seed rounds ($0.2M-$1.05M), 30 seed rounds ($1.5M-$6M) that raise Series A ($10M-$24.5M);
//   seed raise outcome by size: `raiseBySize(i)` decides whether seed company i raised a Series A.
function sizedCohort(raiseBySize: (i: number) => boolean, extra: Parameters<typeof makeCohort>[1] = []): Cohort {
  const cos: Parameters<typeof makeCohort>[1] = [];
  for (let i = 0; i < 30; i++) {
    cos.push({ id: `p${i}`, rounds: [{ stage: "pre-seed", date: "2017-03-01", lead: "pa", amount: 0.2e6 + i * 0.03e6 }] });
    const seed = { stage: "seed" as const, date: "2018-01-01", lead: i % 2 ? "sa" : "sb", amount: 1.5e6 + i * 0.15e6 };
    cos.push({ id: `s${i}`, rounds: raiseBySize(i) ? [seed, { stage: "series-a", date: "2019-06-01", lead: "aa", amount: 10e6 + i * 0.5e6 }] : [seed] });
  }
  const c = makeCohort("2024-06-01", [...cos, ...extra]);
  for (const co of Object.values(c.companies)) co.sampledBy = "seed-sample";
  return c;
}

describe("fit on effective stages", () => {
  it("places a large 'pre-seed' round at seed in episodes and transitions", () => {
    const c = sizedCohort(() => true, [{ id: "big", rounds: [{ stage: "pre-seed", date: "2018-02-01", lead: "sa", amount: 7.5e6 }] }]);
    const m = fitModel(c);
    expect(m.labelBands["pre-seed"]?.p75).toBeLessThan(7.5e6);
    expect(m.episodes.big[0].stage).toBe("seed");
    expect(m.transitions.find((t) => t.companyId === "big")?.stage).toBe("seed");
    expect(m.episodes.p0[0].stage).toBe("pre-seed");
  });

  it("starts the simulation from the effective stage and says why", () => {
    const c = sizedCohort(() => true, [{ id: "big", rounds: [{ stage: "pre-seed", date: "2024-01-01", lead: "sa", amount: 7.5e6 }] }]);
    const m = fitModel(c);
    const vision: Vision = { text: "Series B", targetStage: "series-b-plus", horizonYears: 5 };
    const prep = prepare({ sectors: {}, stage: "pre-seed", companyId: "big" }, vision, m);
    expect(prep.effectiveStage).toBe("seed");
    expect(prep.firstStage).toBe("series-a");
    expect(prep.stageNote).toMatch(/^Labelled Pre-seed; \$7\.5M is seed-sized/);
    const r = simulate({ sectors: {}, stage: "pre-seed", companyId: "big" }, vision, m, { runs: 200, seed: 3 });
    expect(r.start.effectiveStage).toBe("seed");
    expect(r.start.stageNote).toBe(prep.stageNote);
    expect(r.calibration.notes.some((n) => n.startsWith("Labelled Pre-seed"))).toBe(true);
  });

  it("moves a founder's raise up a stage when its size says so", () => {
    const m = fitModel(sizedCohort(() => true));
    const vision: Vision = { text: "Series B", targetStage: "series-b-plus", horizonYears: 5 };
    expect(prepare({ sectors: {}, stage: "pre-seed", raiseUsd: 7e6 }, vision, m).firstStage).toBe("seed");
    expect(prepare({ sectors: {}, stage: "pre-seed", raiseUsd: 0.5e6 }, vision, m).firstStage).toBe("pre-seed");
  });
});

describe("raise rate conditioned on round size", () => {
  it("estimates per-tercile rates from knowable seed-sample transitions, shrunk toward the stage", () => {
    // Bottom third never raised, top third always did.
    const m = fitModel(sizedCohort((i) => i >= 15));
    const s = m.sizeRates.seed!;
    expect(s.n).toBe(30);
    expect(s.raised).toBe(15);
    const [lo, mid, hi] = s.tiers;
    expect(lo.raised).toBe(0);
    expect(hi.raised).toBe(hi.n);
    expect(lo.factor).toBeLessThan(mid.factor);
    expect(mid.factor).toBeLessThan(hi.factor);
    const rs = (s.raised + 1) / (s.n + 2);
    expect(hi.factor).toBeCloseTo((hi.raised + SIZE_SHRINK_K * rs) / (hi.n + SIZE_SHRINK_K) / rs, 10);
    expect(hi.factor).toBeLessThan(1 / rs);
    expect(hi.p).toBeCloseTo(Math.min(0.97, m.baseRates.seed!.p * hi.factor), 10);
  });

  it("applies the factor in the engine and is neutral when size carries no signal", () => {
    const m = fitModel(sizedCohort((i) => i >= 15));
    const prep = prepare({ sectors: {}, stage: "seed" }, { text: "Series B", targetStage: "series-b-plus", horizonYears: 5 }, m);
    const e = new Engine(m, prep);
    expect(e.pRaise(null, "seed", undefined, 0, 5.8e6)).toBeGreaterThan(e.pRaise(null, "seed", undefined, 0, 1.6e6));
    expect(e.sizeFactor("seed", undefined)).toBe(1);
    const flat = fitModel(sizedCohort((i) => i % 2 === 0));
    for (const t of flat.sizeRates.seed!.tiers) expect(Math.abs(t.factor - 1)).toBeLessThan(0.1);
  });

  it("measures lead quality against the same population, so an average lead has lift ~1", () => {
    // sa leads odd i, sb even i; raising is independent of the lead.
    const m = fitModel(sizedCohort((i) => i % 4 < 2));
    for (const id of ["sa", "sb"]) expect(Math.abs(m.agents[m.agentIndex[id]].raiseLift - 1)).toBeLessThan(0.1);
  });
});
