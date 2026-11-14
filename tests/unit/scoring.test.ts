import { describe, expect, it } from "vitest";
import type { Debrief } from "@/lib/types";
import {
  BASE_WEIGHTS,
  chequeFitRaw,
  debriefStats,
  rankFounders,
  rankInvestors,
  scoreInvestor,
  stageFitRaw,
} from "@/lib/scoring";
import { NOW, deal, founder, investor, repeat } from "./helpers";

const bioPreSeed = investor(
  "bio",
  [
    ...repeat(3, (i) => deal("biotech/therapeutics", "pre-seed", 30 + i * 60, 1e6)),
    deal("biotech/therapeutics", "seed", 100, 2e6),
    deal("medtech/devices", "pre-seed", 200, 1.5e6),
  ],
  { sectors: { "biotech/therapeutics": 1 }, stages: { "pre-seed": 1 } },
);
const fintechA = investor(
  "fin",
  repeat(5, (i) => deal("fintech", "series-a", 20 + i * 50, 10e6)),
  { sectors: { fintech: 1 }, stages: { "series-a": 1 } },
);
const bioFounder = founder({
  sectors: { "biotech/therapeutics": 1 },
  stage: "pre-seed",
  raise: 1.2e6,
  confidence: { sectors: 0.9, stage: 0.9, raise: 0.9 },
});

describe("scoreInvestor", () => {
  it("ranks a biotech pre-seed investor above a fintech Series A one", () => {
    const ranked = rankInvestors(bioFounder, [fintechA, bioPreSeed]);
    expect(ranked.map((m) => m.investorId)).toEqual(["bio", "fin"]);
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score + 30);
  });

  it("uses spec weights and stays within 0..100", () => {
    const m = scoreInvestor(bioFounder, bioPreSeed, undefined, NOW);
    const b = m.breakdown;
    const expected =
      100 *
      (BASE_WEIGHTS.sector * b.sectorFit +
        BASE_WEIGHTS.stage * b.stageFit +
        BASE_WEIGHTS.cheque * b.chequeFit +
        BASE_WEIGHTS.activity * b.activity +
        BASE_WEIGHTS.debrief * b.debriefAdj);
    expect(m.score).toBeCloseTo(expected, 0);
    expect(m.score).toBeGreaterThan(0);
    expect(m.score).toBeLessThanOrEqual(100);
  });

  it("gives unknown founder fields a neutral 0.5", () => {
    const m = scoreInvestor(founder(), fintechA, undefined, NOW);
    expect(m.breakdown.sectorFit).toBe(0.5);
    expect(m.breakdown.stageFit).toBe(0.5);
    expect(m.breakdown.chequeFit).toBe(0.5);
    expect(m.breakdown.debriefAdj).toBe(0.5);
  });

  it("weights each field by its confidence: a half-heard stage moves the score less", () => {
    const sure = founder({ stage: "series-a", confidence: { stage: 1 } });
    const half = founder({ stage: "series-a", confidence: { stage: 0.5 } });
    const none = founder();
    const s = scoreInvestor(sure, fintechA, undefined, NOW).score;
    const h = scoreInvestor(half, fintechA, undefined, NOW).score;
    const n = scoreInvestor(none, fintechA, undefined, NOW).score;
    expect(s).toBeGreaterThan(h);
    expect(h).toBeGreaterThan(n);
    expect(h - n).toBeCloseTo((s - n) / 2, 0);
    const zero = founder({ stage: "series-a", confidence: { stage: 0 } });
    expect(scoreInvestor(zero, fintechA, undefined, NOW).score).toBe(n);
  });

  it("writes a reason from the top two terms and picks evidence deals", () => {
    const m = scoreInvestor(bioFounder, bioPreSeed, undefined, NOW);
    expect(m.reason).toBe("Backed 4 biotech deals in 24 months; mostly pre-seed");
    expect(m.evidence).toHaveLength(3);
    expect(m.evidence.every((d) => d.sector === "biotech/therapeutics" && d.round === "pre-seed")).toBe(true);
    // newest first on ties
    expect(m.evidence.map((d) => d.date)).toEqual([...m.evidence.map((d) => d.date)].sort().reverse());
  });

  it("tops evidence up to two deals when little matches", () => {
    const m = scoreInvestor(bioFounder, fintechA, undefined, NOW);
    expect(m.evidence.length).toBeGreaterThanOrEqual(2);
  });

  it("blends stated thesis for thin-history investors", () => {
    const thin = investor("thin", [deal("fintech", "seed", 30)], {
      sectors: { "biotech/therapeutics": 1 },
      stages: { "pre-seed": 1 },
    });
    expect(thin.thinHistory).toBe(true);
    const m = scoreInvestor(bioFounder, thin, undefined, NOW);
    expect(m.breakdown.sectorFit).toBeGreaterThan(0.5);
    expect(m.reason).toContain("thin history");
  });

  it("says sector unclear for off-taxonomy pitches", () => {
    const f = founder({ sectors: { other: 1 }, stage: "series-a" });
    expect(scoreInvestor(f, fintechA, undefined, NOW).reason).toMatch(/^Sector unclear, matched on stage/);
  });
});

describe("stage and cheque fit", () => {
  it("softens adjacent stages by 0.5", () => {
    expect(stageFitRaw({ seed: 1 }, "seed")).toBe(1);
    expect(stageFitRaw({ seed: 1 }, "pre-seed")).toBe(0.5);
    expect(stageFitRaw({ seed: 1 }, "series-b-plus")).toBe(0);
  });

  it("is 1 inside the IQR and decays linearly to 0 at 3x outside", () => {
    const band: [number, number] = [1e6, 2e6];
    expect(chequeFitRaw(1.5e6, band)).toBe(1);
    expect(chequeFitRaw(4e6, band)).toBeCloseTo(0.5);
    expect(chequeFitRaw(6e6, band)).toBe(0);
    expect(chequeFitRaw(10e6, band)).toBe(0);
    expect(chequeFitRaw(0.5e6, band)).toBeCloseTo(0.5);
    expect(chequeFitRaw(1e6 / 3, band)).toBeCloseTo(0);
    expect(chequeFitRaw(1e6, [0, 0])).toBeUndefined();
  });
});

describe("debriefs", () => {
  const d = (fit: Debrief["fit"], tag: Debrief["tag"]): Debrief => ({
    roomId: "r",
    founderId: "f",
    investorId: "bio",
    fit,
    again: true,
    tag,
    seeded: true,
  });

  it("uses a Beta(1,1) prior: neutral with no data, posterior mean otherwise", () => {
    expect(debriefStats([], "bio")).toMatchObject({ adj: 0.5, n: 0, weights: BASE_WEIGHTS });
    const s = debriefStats([d("yes", "team"), d("yes", "team"), d("maybe", "traction")], "bio");
    expect(s.adj).toBeCloseTo((1 + 2.5) / 5);
    expect(s.n).toBe(3);
  });

  it("shifts weight to stage when stage tags are the repeated majority", () => {
    const s = debriefStats([d("no", "stage"), d("no", "stage"), d("yes", "team")], "bio");
    expect(s.weights.stage).toBe(0.35);
    expect(s.weights.sector).toBe(0.35);
    const sum = Object.values(s.weights).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1);
  });

  it("feeds the adjustment into the score", () => {
    const good = rankInvestors(bioFounder, [bioPreSeed], [d("yes", "team"), d("yes", "team")])[0];
    const bad = rankInvestors(bioFounder, [bioPreSeed], [d("no", "team"), d("no", "team")])[0];
    expect(good.score).toBeGreaterThan(bad.score);
  });
});

describe("reason lines", () => {
  const d = (fit: Debrief["fit"], tag: Debrief["tag"] = "team"): Debrief => ({
    roomId: "r",
    founderId: "f",
    investorId: "bio",
    fit,
    again: true,
    tag,
    seeded: true,
  });
  // Unknown sector, stage and raise leave activity and debriefs as the only known terms.
  const blank = founder();

  it("says debriefs lean positive only when the posterior is above 0.55", () => {
    const stats = debriefStats([d("yes"), d("yes"), d("yes")], "bio");
    const m = scoreInvestor(blank, bioPreSeed, stats, NOW);
    expect(m.reason).toContain("room debriefs lean positive (seeded, 3)");
  });

  it("calls neutral or negative debriefs mixed, never positive", () => {
    for (const fits of [["yes", "no"], ["no", "no"]] as Debrief["fit"][][]) {
      const stats = debriefStats(fits.map((f) => d(f)), "bio");
      expect(stats.adj).toBeLessThanOrEqual(0.55);
      const m = scoreInvestor(blank, bioPreSeed, stats, NOW);
      expect(m.reason).not.toContain("positive");
      expect(m.reason).toContain(`mixed room debriefs (seeded, ${fits.length})`);
    }
  });

  it("never mentions debriefs when there are none", () => {
    const m = scoreInvestor(blank, bioPreSeed, debriefStats([], "bio"), NOW);
    expect(m.reason).not.toContain("debrief");
  });

  it("states cheque bands in pounds", () => {
    const chequeOnly = founder({ raise: 1.2e6, confidence: { raise: 1 } });
    const inv = investor("chq", repeat(4, (i) => deal("fintech", "unknown", 20 + i * 30, 1.27e6)));
    const m = scoreInvestor(chequeOnly, inv, undefined, NOW);
    expect(m.reason).toContain("£1m");
    expect(m.reason).not.toContain("$");
  });

  it("picks evidence with the debrief-shifted weights", () => {
    // Founder: fintech seed. One deal matches the sector only, one the stage only, both equally
    // weighted by base weights would favour sector (0.4 vs 0.3); stage-tag debriefs flip it.
    const mixed = founder({ id: "mx", sectors: { fintech: 1 }, stage: "seed" });
    const inv = investor("ev", [
      deal("fintech", "series-b-plus", 30),
      deal("biotech/therapeutics", "seed", 40),
      deal("biotech/therapeutics", "seed", 50),
      deal("fintech", "series-b-plus", 60),
    ]);
    const base = scoreInvestor(mixed, inv, undefined, NOW);
    expect(base.evidence[0].sector).toBe("fintech");
    const stageHeavy = { adj: 0.5, n: 3, weights: { ...BASE_WEIGHTS, sector: 0.25, stage: 0.45 } };
    const shifted = scoreInvestor(mixed, inv, stageHeavy, NOW);
    expect(shifted.evidence[0].round).toBe("seed");
  });
});

describe("rankFounders", () => {
  it("ranks the founder pool for an investor", () => {
    const fintechFounder = founder({ id: "f2", sectors: { fintech: 1 }, stage: "series-a" });
    const ranked = rankFounders(bioPreSeed, [fintechFounder, bioFounder], [], NOW);
    expect(ranked[0].founderId).toBe("f1");
    expect(ranked[0].reason).toContain("Biotech");
  });
});

describe("stage reason honesty", () => {
  it("never calls a non-adjacent stage 'next to your stage'", () => {
    const lateBio = investor("late", [
      deal("biotech/therapeutics", "series-b-plus", 60, 40_000_000),
      deal("biotech/therapeutics", "series-b-plus", 120, 50_000_000),
      deal("biotech/therapeutics", "series-b-plus", 200, 60_000_000),
      deal("biotech/therapeutics", "series-b-plus", 300, 45_000_000),
    ]);
    const f = founder({ sectors: { "biotech/therapeutics": 1 }, stage: "pre-seed", confidence: { sectors: 0.9, stage: 0.9 } });
    expect(scoreInvestor(f, lateBio, undefined, NOW).reason).not.toContain("next to your stage");
  });
});
