import { describe, expect, it } from "vitest";
import {
  CONTRADICTION_THRESHOLD,
  computeRevealed,
  contradictionLine,
  contradictionScore,
  hasClearLead,
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

  const stated = (sectors: object, stages: object) => ({ text: "", sectors, stages, sources: [] });

  it("never contrasts against a category the stated thesis includes", () => {
    // Says pre-seed and seed; 12 seed deals are on-thesis, the 8 Series A deals are not.
    const deals = [
      ...repeat(6, (i) => deal("fintech", "pre-seed", i * 20)),
      ...repeat(12, (i) => deal("fintech", "seed", 3 + i * 20)),
      ...repeat(8, (i) => deal("fintech", "series-a", 7 + i * 20)),
    ];
    const line = contradictionLine({ deals, statedThesis: stated({ fintech: 1 }, { "pre-seed": 0.6, seed: 0.4 }) }, NOW);
    expect(line).toBe("Says pre-seed and seed; 8 of last 26 deals were Series A");
  });

  it("prefers a contrast at >= 40% of counted deals over a wider but weaker one", () => {
    // Sector: 9 of 20 off-thesis (45%, all applied AI). Stage: 12 of 20 off-thesis (60% gap)
    // but split 6 Series A / 6 Series B+, so its top category is only 30%.
    const deals = [
      ...repeat(9, (i) => deal("applied AI/vertical SaaS", i % 2 ? "series-a" : "seed", i * 20)),
      ...repeat(11, (i) => deal("fintech", i < 6 ? "series-b-plus" : i % 2 ? "series-a" : "seed", 5 + i * 20)),
    ];
    const line = contradictionLine({ deals, statedThesis: stated({ fintech: 1 }, { seed: 1 }) }, NOW);
    expect(line).toBe("Says fintech; 9 of last 20 deals were applied AI");
  });

  it("between two strong contrasts, picks the dimension with the larger gap", () => {
    const deals = [
      ...repeat(9, (i) => deal("climate/energy", "series-a", i * 20)),
      ...repeat(1, (i) => deal("fintech", "series-a", 5 + i * 20)),
    ];
    // Stage gap 100% (all Series A) beats sector gap 90%.
    const line = contradictionLine({ deals, statedThesis: stated({ fintech: 1 }, { seed: 1 }) }, NOW);
    expect(line).toBe("Says seed; 10 of last 10 deals were Series A");
  });

  it("reads a contiguous stage thesis as a range and a wide sector thesis by size", () => {
    const stages = contradictionLine(
      {
        deals: repeat(6, (i) => deal("fintech", i < 4 ? "series-b-plus" : "seed", i * 20)),
        statedThesis: stated({ fintech: 1 }, { "pre-seed": 0.4, seed: 0.3, "series-a": 0.3 }),
      },
      NOW,
    );
    expect(stages).toBe("Says pre-seed to Series A; 4 of last 6 deals were Series B+");
    const sectors = contradictionLine(
      {
        deals: repeat(6, (i) => deal(i < 4 ? "edtech" : "fintech", "seed", i * 20)),
        statedThesis: stated({ fintech: 0.4, consumer: 0.3, proptech: 0.3 }, {}),
      },
      NOW,
    );
    expect(sectors).toBe("Says 3 sectors, not edtech; 4 of last 6 deals were edtech");
  });

  it("ignores passing mentions, the 'other' bucket, and contrasts under 25% of deals", () => {
    const mention = contradictionLine(
      {
        deals: repeat(5, (i) => deal(i < 3 ? "edtech" : "fintech", "seed", i * 20)),
        statedThesis: stated({ fintech: 0.95, edtech: 0.05 }, {}),
      },
      NOW,
    );
    expect(mention).toBe("Says fintech; 3 of last 5 deals were edtech");
    const other = contradictionLine(
      { deals: repeat(5, (i) => deal(i < 4 ? "other" : "fintech", "seed", i * 20)), statedThesis: stated({ fintech: 1 }, {}) },
      NOW,
    );
    expect(other).toBeUndefined();
    const weak = contradictionLine(
      {
        deals: [
          ...repeat(5, (i) => deal("applied AI/vertical SaaS", "seed", i * 20)),
          ...repeat(21, (i) => deal("fintech", "seed", 5 + i * 20)),
        ],
        statedThesis: stated({ fintech: 1 }, {}),
      },
      NOW,
    );
    expect(weak).toBeUndefined();
  });

  it("treats a flat or tied stated distribution as no stated preference", () => {
    // Medicxi-shaped: "across the full drug development continuum", all Series B+ in practice.
    const flat = { "pre-idea": 0.25, "pre-seed": 0.25, seed: 0.25, "series-a": 0.125, "series-b-plus": 0.125 };
    const deals = repeat(5, (i) => deal("biotech/therapeutics", "series-b-plus", i * 20));
    const inv = investor("flat", deals, { sectors: { "biotech/therapeutics": 1 }, stages: flat });
    expect(inv.contradiction).toBe(0);
    expect(inv.contradictionLine).toBeUndefined();
    // Conception X-shaped tie: pre-idea and pre-seed at 0.5 each.
    const tied = investor("tied", repeat(4, (i) => deal("deep tech/hardware", "pre-seed", i * 20)), {
      stages: { "pre-idea": 0.5, "pre-seed": 0.5 },
    });
    expect(tied.contradiction).toBe(0);
    expect(tied.contradictionLine).toBeUndefined();
    expect(hasClearLead(flat)).toBe(false);
    expect(hasClearLead({ seed: 0.6, "series-a": 0.4 })).toBe(true);
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
