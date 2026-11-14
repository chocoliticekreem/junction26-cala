import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Investor } from "@/lib/types";
import { CONTRADICTION_THRESHOLD } from "@/lib/revealed";
import { rankInvestors } from "@/lib/scoring";
import { fallbackExtract } from "@/lib/fallbackExtract";
import { emptyProfile, mergeProfile } from "@/lib/mergeProfile";

const investors: Investor[] = JSON.parse(
  readFileSync(path.join(__dirname, "../../data/investors.fixture.json"), "utf8"),
);

describe("investors.fixture.json", () => {
  it("has 200 fixture investors with ids fx-001..fx-200", () => {
    expect(investors).toHaveLength(200);
    expect(investors.every((i) => i.fixture === true && i.name.endsWith("(fixture)"))).toBe(true);
    expect(investors.map((i) => i.id)).toEqual(
      Array.from({ length: 200 }, (_, i) => `fx-${String(i + 1).padStart(3, "0")}`),
    );
    expect(investors.every((i) => i.doors.some((d) => d.kind === "room"))).toBe(true);
    expect(investors.every((i) => i.deals.length <= 25)).toBe(true);
  });

  it("has the demo shape: contradictions and thin history", () => {
    const flagged = investors.filter((i) => i.contradiction > CONTRADICTION_THRESHOLD);
    expect(flagged.length).toBeGreaterThanOrEqual(8);
    expect(flagged.some((i) => /^Says pre-seed; \d+ of last \d+ deals were Series A$/.test(i.contradictionLine ?? ""))).toBe(true);
    expect(investors.filter((i) => i.thinHistory).length).toBeGreaterThanOrEqual(12);
  });

  it("ranks biotech investors top 3 for a biotech pre-seed pitch", () => {
    const profile = mergeProfile(
      emptyProfile(),
      fallbackExtract("We're a London biotech building CRISPR therapeutics, raising a £1.5m pre-seed."),
    );
    const top = rankInvestors(profile, investors).slice(0, 3);
    const byId = new Map(investors.map((i) => [i.id, i]));
    for (const m of top) {
      expect(byId.get(m.investorId)!.revealed.S["biotech/therapeutics"] ?? 0).toBeGreaterThan(0.6);
      expect(m.evidence.length).toBeGreaterThanOrEqual(2);
    }
  });
});
