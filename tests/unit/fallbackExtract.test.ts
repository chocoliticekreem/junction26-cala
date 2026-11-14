import { describe, expect, it } from "vitest";
import { fallbackExtract } from "@/lib/fallbackExtract";

const labels = (t: string) => fallbackExtract(t).sectors.map((s) => s.label);

describe("fallbackExtract", () => {
  it("detects biotech and pre-seed with triggers", () => {
    const e = fallbackExtract("We are building therapeutics for rare disease and raising our pre-seed.");
    expect(e.sectors[0].label).toBe("biotech/therapeutics");
    expect(e.stage).toEqual({ value: "pre-seed", confidence: 0.9 });
    expect(e.triggers?.["biotech/therapeutics"]).toBe("therapeutics");
    expect(e.triggers?.stage).toBe("pre-seed");
  });

  it("tolerates STT misspellings and synonyms", () => {
    expect(labels("a crisper platform for gene editing")).toContain("biotech/therapeutics");
    expect(fallbackExtract("our crisper platform").triggers?.["biotech/therapeutics"]).toBe("crisper");
    expect(labels("AI for drug discovery")).toContain("biotech/therapeutics");
    expect(labels("a novel antibody")).toContain("biotech/therapeutics");
    expect(labels("a therapeutic for asthma")).toContain("biotech/therapeutics");
  });

  it("recognises stage phrasings", () => {
    expect(fallbackExtract("raising a preseed").stage?.value).toBe("pre-seed");
    expect(fallbackExtract("raising a pre seed").stage?.value).toBe("pre-seed");
    expect(fallbackExtract("closing an angel round").stage?.value).toBe("pre-seed");
    expect(fallbackExtract("we are raising our seed round").stage?.value).toBe("seed");
    expect(fallbackExtract("we're raising a Series A").stage?.value).toBe("series-a");
    expect(fallbackExtract("series and parallel circuits").stage).toBeUndefined();
  });

  it("prefers the stage in the sentence about the current raise", () => {
    expect(fallbackExtract("We did a pre-seed in 2024. Now we are raising a seed round.").stage?.value).toBe("seed");
  });

  it("parses raise amounts and converts to USD", () => {
    expect(fallbackExtract("We're raising £1.5m").raise_amount?.value).toBe(1_905_000);
    expect(fallbackExtract("we are raising 1.5 million").raise_amount?.value).toBe(1_905_000);
    expect(fallbackExtract("raising $800k").raise_amount?.value).toBe(800_000);
    expect(fallbackExtract("we're looking for two million pounds").raise_amount?.value).toBe(2_540_000);
    expect(fallbackExtract("raising €2m").raise_amount?.value).toBe(2_160_000);
    expect(fallbackExtract("raising one and a half million dollars").raise_amount?.value).toBe(1_500_000);
    expect(fallbackExtract("raising £1.5m").triggers?.raise_amount).toBe("£1.5m");
  });

  it("does not mistake revenue or durations for the raise", () => {
    const e = fallbackExtract("We have £20k MRR and are raising £1m over 18 months");
    expect(e.raise_amount?.value).toBe(1_270_000);
    expect(e.traction?.revenue).toBe("£20k MRR");
    expect(fallbackExtract("we have 12 months of runway").raise_amount).toBeUndefined();
  });

  it("extracts traction, team, geography and model", () => {
    const e = fallbackExtract(
      "Based in London. We have 1,200 users, growing 20% month on month. I have a PhD and I'm ex-DeepMind, a second-time founder. We sell B2B SaaS.",
    );
    expect(e.traction?.users).toBe("1,200 users");
    expect(e.traction?.growth).toMatch(/20% month on month/);
    expect(e.team_signals?.map((t) => t.value)).toEqual(
      expect.arrayContaining(["PhD", "ex-DeepMind", "second-time founder"]),
    );
    expect(e.geography?.value).toBe("London");
    expect(e.business_model?.value).toBe("B2B SaaS");
  });

  it("returns an empty extraction for empty or off-topic text", () => {
    expect(fallbackExtract("")).toEqual({ sectors: [] });
    expect(fallbackExtract("hello everyone, thanks for having me").sectors).toEqual([]);
  });

  it("runs in under 5ms on a pitch-length chunk", () => {
    const text = "We are a London biotech building CRISPR therapeutics, raising a £1.5m pre-seed. ".repeat(5);
    fallbackExtract(text);
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) fallbackExtract(text);
    expect((performance.now() - t0) / 20).toBeLessThan(5);
  });
});
