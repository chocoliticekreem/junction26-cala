import { describe, expect, it } from "vitest";
import {
  CONTRADICTION_THRESHOLD,
  computeRevealed,
  contradictionLine,
  contradictionScore,
} from "@/lib/revealed";
import { NOW, deal, investor, repeat } from "./helpers";

describe("computeRevealed", () => {
  it("decays older deals with a 12-month half-life", () => {
    const r = computeRevealed([deal("fintech", "seed", 0), deal("climate/energy", "seed", 365)], NOW);
    // weights 1 and ~0.5 -> 2/3 vs 1/3
    expect(r.S.fintech).toBeCloseTo(2 / 3, 2);
    expect(r.S["climate/energy"]).toBeCloseTo(1 / 3, 2);
  });

  it("ignores deals outside the 24-month window and undated deals", () => {
    const undated = { ...deal("edtech", "seed", 10), date: undefined };
    const r = computeRevealed([deal("fintech", "seed", 30), deal("edtech", "seed", 800), undated], NOW);
    expect(r.dealCount24m).toBe(1);
    expect(r.S).toEqual({ fintech: 1 });
  });

  it("counts unknown-round deals toward sector only", () => {
    const r = computeRevealed([deal("fintech", "unknown", 10), deal("edtech", "seed", 10)], NOW);
    expect(r.S.fintech).toBeCloseTo(0.5);
    expect(r.G).toEqual({ seed: 1 });
  });

  it("computes the cheque IQR, median and log-scaled activity", () => {
    const amounts = [1, 2, 3, 4, 5].map((m) => m * 1e6);
    const r = computeRevealed(amounts.map((a, i) => deal("fintech", "seed", 10 + i, a)), NOW);
    expect(r.chequeBand).toEqual([2e6, 4e6]);
    expect(r.chequeMedian).toBe(3e6);
    expect(r.activity).toBeCloseTo(Math.log1p(5) / Math.log1p(12), 5);
    const busy = computeRevealed(repeat(20, (i) => deal("fintech", "seed", i)), NOW);
    expect(busy.activity).toBe(1);
    expect(computeRevealed([], NOW)).toMatchObject({ activity: 0, chequeBand: [0, 0], dealCount24m: 0 });
  });
});

describe("contradiction", () => {
  const seriesA = [
    ...repeat(9, (i) => deal("biotech/therapeutics", "series-a", 20 + i * 30)),
    ...repeat(3, (i) => deal("biotech/therapeutics", "seed", 40 + i * 30)),
    ...repeat(2, (i) => deal("biotech/therapeutics", "pre-seed", 60 + i * 30)),
  ];

  it("is 0 when the stated thesis is empty", () => {
    const inv = investor("a", seriesA);
    expect(contradictionScore(inv.statedThesis, inv.revealed)).toBe(0);
    expect(inv.contradiction).toBe(0);
    expect(inv.contradictionLine).toBeUndefined();
  });

  it("fires above 0.4 with a counted line: says pre-seed, mostly Series A", () => {
    const inv = investor("b", seriesA, { sectors: { "biotech/therapeutics": 1 }, stages: { "pre-seed": 1 } });
    expect(inv.contradiction).toBeGreaterThan(CONTRADICTION_THRESHOLD);
    expect(inv.contradictionLine).toBe("Says pre-seed; 9 of last 14 deals were Series A");
  });

  it("averages sector and stage TVD", () => {
    const inv = investor("c", repeat(4, (i) => deal("fintech", "seed", i * 10)), {
      sectors: { "climate/energy": 1 },
      stages: { seed: 1 },
    });
    expect(inv.contradiction).toBeCloseTo(0.5, 5); // sector TVD 1, stage TVD 0
  });

  it("does not fire at or below 0.4 for a mild disagreement", () => {
    const deals = [
      ...repeat(7, (i) => deal("fintech", "seed", i * 20)),
      ...repeat(3, (i) => deal("insurtech", "seed", 5 + i * 20)),
    ];
    const inv = investor("d", deals, { sectors: { fintech: 1 }, stages: { seed: 1 } });
    expect(inv.contradiction).toBeLessThanOrEqual(CONTRADICTION_THRESHOLD);
    expect(inv.contradictionLine).toBeUndefined();
  });

  it("builds a sector line from counted deals only", () => {
    const deals = [
      ...repeat(6, (i) => deal("climate/energy", "seed", i * 20)),
      ...repeat(4, (i) => deal("fintech", "seed", 5 + i * 20)),
      ...repeat(5, (i) => deal("climate/energy", "seed", 800 + i)), // outside window
    ];
    const line = contradictionLine(
      { deals, statedThesis: { text: "", sectors: { fintech: 1 }, stages: { seed: 1 }, sources: [] } },
      NOW,
    );
    expect(line).toBe("Says fintech; 6 of last 10 deals were climate");
  });

  it("never claims a contradiction for thin history", () => {
    const inv = investor("e", [deal("fintech", "series-a", 10), deal("fintech", "series-a", 20)], {
      sectors: { "climate/energy": 1 },
      stages: { "pre-seed": 1 },
    });
    expect(inv.thinHistory).toBe(true);
    expect(inv.contradiction).toBe(0);
    expect(inv.contradictionLine).toBeUndefined();
  });
});
