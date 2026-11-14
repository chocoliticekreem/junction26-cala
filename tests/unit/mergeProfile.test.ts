import { describe, expect, it } from "vitest";
import { emptyProfile, mergeProfile } from "@/lib/mergeProfile";

describe("mergeProfile", () => {
  it("starts from an empty live profile", () => {
    expect(emptyProfile()).toEqual({ id: "live", sectors: {}, teamSignals: [], confidence: {} });
    expect(emptyProfile("x").id).toBe("x");
  });

  it("accumulates sector evidence and renormalises to sum 1", () => {
    let p = mergeProfile(emptyProfile(), { sectors: [{ label: "biotech/therapeutics", confidence: 0.9 }] });
    expect(p.sectors).toEqual({ "biotech/therapeutics": 1 });
    p = mergeProfile(p, { sectors: [{ label: "healthtech", confidence: 0.3 }] });
    expect(p.sectors["biotech/therapeutics"]).toBeCloseTo(0.75);
    expect(p.sectors.healthtech).toBeCloseTo(0.25);
    p = mergeProfile(p, { sectors: [{ label: "biotech/therapeutics", confidence: 0.8 }] });
    const sum = Object.values(p.sectors).reduce((a, b) => a + (b ?? 0), 0);
    expect(sum).toBeCloseTo(1);
    expect(p.sectors["biotech/therapeutics"]).toBeCloseTo(1.7 / 2.0);
    expect(p.confidence.sectors).toBeGreaterThan(0.9);
  });

  it("keeps sectors when a chunk has none", () => {
    const p = mergeProfile(emptyProfile(), { sectors: [{ label: "fintech", confidence: 0.7 }] });
    expect(mergeProfile(p, { sectors: [] }).sectors).toEqual({ fintech: 1 });
  });

  it("replaces stage and raise only on equal-or-higher confidence", () => {
    let p = mergeProfile(emptyProfile(), { sectors: [], stage: { value: "pre-seed", confidence: 0.8 }, raise_amount: { value: 1e6, confidence: 0.8 } });
    p = mergeProfile(p, { sectors: [], stage: { value: "seed", confidence: 0.5 }, raise_amount: { value: 5e6, confidence: 0.4 } });
    expect(p.stage).toBe("pre-seed");
    expect(p.raise).toBe(1e6);
    p = mergeProfile(p, { sectors: [], stage: { value: "seed", confidence: 0.8 } });
    expect(p.stage).toBe("seed");
    expect(p.confidence.stage).toBe(0.8);
  });

  it("de-duplicates team signals and merges traction fields", () => {
    let p = mergeProfile(emptyProfile(), {
      sectors: [],
      team_signals: [{ value: "PhD", confidence: 0.8 }],
      traction: { users: "100 users", confidence: 0.8 },
    });
    p = mergeProfile(p, {
      sectors: [],
      team_signals: [{ value: "phd", confidence: 0.9 }, { value: "ex-Google", confidence: 0.7 }],
      traction: { revenue: "£10k MRR", users: "50 users", confidence: 0.5 },
    });
    expect(p.teamSignals).toEqual(["PhD", "ex-Google"]);
    expect(p.traction).toEqual({ users: "100 users", revenue: "£10k MRR" });
    expect(p.confidence.teamSignals).toBe(0.9);
  });

  it("does not mutate its input", () => {
    const p = emptyProfile();
    mergeProfile(p, { sectors: [{ label: "fintech", confidence: 0.7 }], team_signals: [{ value: "PhD", confidence: 1 }] });
    expect(p).toEqual(emptyProfile());
  });
});
