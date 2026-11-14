import { describe, expect, it } from "vitest";
import { LEAD_WEIGHT, computeRevealed } from "@/lib/revealed";
import { scoreInvestor } from "@/lib/scoring";
import type { Deal } from "@/lib/types";
import { NOW, deal, founder, investor } from "./helpers";

const led = (d: Deal): Deal => ({ ...d, isLead: true });
const joined = (d: Deal): Deal => ({ ...d, isLead: false });

describe("led rounds in revealed distributions", () => {
  it("weighs a led round LEAD_WEIGHT times a joined one", () => {
    const r = computeRevealed([led(deal("fintech", "seed", 0)), joined(deal("edtech", "series-a", 0))], NOW);
    expect(LEAD_WEIGHT).toBe(1.5);
    expect(r.S.fintech).toBeCloseTo(1.5 / 2.5);
    expect(r.G.seed).toBeCloseTo(1.5 / 2.5);
  });

  it("treats unknown lead status as a plain participation", () => {
    const r = computeRevealed([deal("fintech", "seed", 0), deal("edtech", "seed", 0)], NOW);
    expect(r.S.fintech).toBeCloseTo(0.5);
  });

  it("sets leadShare over deals with known lead status, and omits it when none is known", () => {
    const r = computeRevealed(
      [led(deal("fintech", "seed", 0)), joined(deal("fintech", "seed", 10)), joined(deal("fintech", "seed", 20)), deal("fintech", "seed", 30)],
      NOW,
    );
    expect(r.leadShare).toBeCloseTo(1 / 3);
    expect(computeRevealed([deal("fintech", "seed", 0)], NOW)).not.toHaveProperty("leadShare");
  });

  it("ignores lead flags outside the 24-month window", () => {
    expect(computeRevealed([led(deal("fintech", "seed", 900)), joined(deal("fintech", "seed", 0))], NOW).leadShare).toBe(0);
  });
});

describe("led-rounds reason fragment", () => {
  const f = founder({ sectors: { "biotech/therapeutics": 1 }, stage: "seed", confidence: { sectors: 1, stage: 1 } });

  it("says how many shared-sector rounds at the founder's stage it led, and since when", () => {
    const inv = investor("lead", [
      led(deal("biotech/therapeutics", "seed", 100)),
      led(deal("biotech/therapeutics", "seed", 400)),
      led(deal("biotech/therapeutics", "series-a", 50)),
      joined(deal("biotech/therapeutics", "seed", 20)),
    ]);
    expect(scoreInvestor(f, inv, undefined, NOW).reason).toMatch(/; led 2 biotech seed rounds since 2025$/);
  });

  it("falls back to all led rounds in the sector when none is at the founder's stage", () => {
    const inv = investor("lead2", [
      led(deal("biotech/therapeutics", "series-a", 50)),
      joined(deal("biotech/therapeutics", "seed", 20)),
      joined(deal("biotech/therapeutics", "seed", 30)),
    ]);
    expect(scoreInvestor(f, inv, undefined, NOW).reason).toMatch(/; led 1 biotech round since 2026$/);
  });

  it("adds nothing when no lead data exists", () => {
    const inv = investor("plain", [deal("biotech/therapeutics", "seed", 20), deal("biotech/therapeutics", "seed", 30)]);
    expect(scoreInvestor(f, inv, undefined, NOW).reason).not.toMatch(/led /);
  });
});
