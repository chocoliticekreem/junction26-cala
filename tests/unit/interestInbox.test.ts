import { describe, expect, it } from "vitest";
import { evidenceLine } from "@/components/InterestInbox";
import { NOW, deal, founder, investor, repeat } from "./helpers";

const bioFounder = founder({ sectors: { "biotech/therapeutics": 1 }, stage: "pre-seed" });

describe("evidenceLine", () => {
  it("counts only deals inside the 24-month window", () => {
    const inv = investor("bio", [
      ...repeat(2, (i) => deal("biotech/therapeutics", "pre-seed", 100 + i * 30)),
      ...repeat(5, (i) => deal("biotech/therapeutics", "pre-seed", 900 + i * 30)),
    ]);
    const { line, deals } = evidenceLine(inv, bioFounder, NOW);
    expect(line).toMatch(/^backed 2 pre-seed biotech companies since \d{4}$/);
    expect(deals).toHaveLength(2);
  });

  it("says so plainly when nothing recent matches", () => {
    const inv = investor("old", [deal("biotech/therapeutics", "pre-seed", 1000)]);
    expect(evidenceLine(inv, bioFounder, NOW).line).toBe("no biotech deals in the last 24 months");
    expect(evidenceLine(inv, founder(), NOW).line).toBe("no deals in the last 24 months");
  });
});
