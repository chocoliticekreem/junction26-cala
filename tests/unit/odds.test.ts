import { describe, expect, it } from "vitest";
import { odds, vsTypical } from "@/components/path/odds";

describe("odds", () => {
  it("never rounds a small share to 0% or 1%", () => {
    expect(odds(0.014)).toBe("1 in 71");
    expect(odds(0.004)).toBe("1 in 250");
    expect(odds(0, 5000)).toBe("<1 in 5,000");
  });

  it("keeps one decimal under 10% and whole percents above", () => {
    expect(odds(0.083)).toBe("8.3%");
    expect(odds(0.02)).toBe("2.0%");
    expect(odds(0.624)).toBe("62%");
  });
});

describe("vsTypical", () => {
  it("states the ratio to the typical company, or nothing without a base rate", () => {
    expect(vsTypical(0.083, 0.037)).toBe("2.2× typical");
    expect(vsTypical(0.017, 0.017)).toBe("about typical");
    expect(vsTypical(0.01, 0)).toBeUndefined();
  });
});
