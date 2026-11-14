import { describe, expect, it } from "vitest";
import { ALL_SECTORS, SECTORS, SECTOR_COLOR, STAGES } from "@/lib/taxonomy";

describe("taxonomy", () => {
  it("has 18 sectors plus other and 5 stages", () => {
    expect(SECTORS).toHaveLength(18);
    expect(ALL_SECTORS).toHaveLength(19);
    expect(STAGES).toHaveLength(5);
  });
  it("gives every sector a colour", () => {
    for (const s of ALL_SECTORS) expect(SECTOR_COLOR[s]).toMatch(/^hsl\(/);
  });
});
