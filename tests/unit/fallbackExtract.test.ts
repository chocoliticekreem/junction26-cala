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

  it("labels off-taxonomy pitches as other so cards can say sector unclear", () => {
    for (const text of [
      "We build defence tech for naval operators",
      "An agritech platform for farmers",
      "We're a games studio making mobile titles",
      "Legal tech for small firms",
      "A space company launching cubesats",
      "A food & beverage brand",
      "HR platform for recruiting teams",
      "Govtech for local councils",
      "A sports analytics startup",
    ]) {
      const e = fallbackExtract(text);
      expect(e.sectors.map((s) => s.label), text).toEqual(["other"]);
      expect(e.sectors[0].confidence).toBeGreaterThan(0.4);
      expect(e.sectors[0].confidence).toBeLessThan(0.8);
    }
  });

  it("keeps a strongly heard taxonomy label next to other", () => {
    const e = fallbackExtract("Defence cybersecurity: threat detection for the military");
    expect(e.sectors.map((s) => s.label)).toEqual(expect.arrayContaining(["cybersecurity", "other"]));
  });

  it("extracts company, founder name and one-liner from the demo opening", () => {
    const e = fallbackExtract(
      "Hi, I'm Amara, founder of Helixa Bio, a London startup. We're building therapeutics for autoimmune disease, specifically AI-designed antibody drugs.",
    );
    expect(e.company).toEqual({ value: "Helixa Bio", confidence: 0.85 });
    expect(e.founder_name?.value).toBe("Amara");
    expect(e.one_liner?.value).toBe("Therapeutics for autoimmune disease");
    expect(e.geography?.value).toBe("London");
  });

  it("recognises other company phrasings", () => {
    const company = (t: string) => fallbackExtract(t).company?.value;
    expect(company("I'm Joe Bloggs, co-founder and CEO of Acme.ai.")).toBe("Acme.ai");
    expect(company("I'm the founder of Helixa.")).toBe("Helixa");
    expect(company("Helixa Bio is a London biotech startup.")).toBe("Helixa Bio");
    expect(company("We're Helixa Bio, a London startup.")).toBe("Helixa Bio");
    expect(company("At Helixa we design antibodies.")).toBe("Helixa");
    expect(company("I'm the founder of Helixa Bio London")).toBe("Helixa Bio");
  });

  it("prefers the strongest company phrasing in a chunk", () => {
    const e = fallbackExtract("At Nimbus we love science. I'm the founder of Helixa Bio.");
    expect(e.company).toEqual({ value: "Helixa Bio", confidence: 0.85 });
  });

  it("does not invent a company from stages, places, people or past roles", () => {
    for (const text of [
      "I'm excited to be here. We're pre-seed.",
      "We're Series A, raising $10m.",
      "We're Amara and Kwame, and we love science.",
      "We're London-based.",
      "At Imperial, we spun out the platform.",
      "At Imperial College we ran the first study.",
      "I was previously a founder of Stripe.",
      "founder of a london startup",
      "This is a great company.",
    ]) {
      expect(fallbackExtract(text).company, text).toBeUndefined();
    }
  });

  it("captures the founder name only next to a founder role or a greeting", () => {
    const name = (t: string) => fallbackExtract(t).founder_name?.value;
    expect(name("Hi everyone, I'm Amara.")).toBe("Amara");
    expect(name("My name is Joe Bloggs and I run a lab.")).toBe("Joe Bloggs");
    expect(name("I'm Really Tired today.")).toBeUndefined();
    expect(name("My name is Joe Bloggs, the CEO of Acme.")).toBe("Joe Bloggs");
    expect(name("I'm excited to be here.")).toBeUndefined();
    expect(name("I'm British, and I'm a founder.")).toBeUndefined();
    expect(name("I'm London based, founder of Acme.")).toBeUndefined();
  });

  it("builds a short one-liner from the pitch's own words", () => {
    const line = (t: string) => fallbackExtract(t).one_liner?.value;
    expect(line("We help pharma companies find drug candidates faster.")).toBe(
      "Helps pharma companies find drug candidates faster",
    );
    expect(line("We are building a payments app for freelancers - it's great.")).toBe(
      "Payments app for freelancers",
    );
    expect(line("We build developer tools for data teams.")).toBe("Developer tools for data teams");
    const long = line(
      "We build developer tools for data teams who struggle with flaky pipelines and slow continuous integration across many repositories.",
    );
    expect(long!.length).toBeLessThanOrEqual(80);
    expect(long).toMatch(/^Developer tools for data teams/);
    expect(long).not.toMatch(/\s$/);
  });

  it("skips one-liners that are not about the product", () => {
    const line = (t: string) => fallbackExtract(t).one_liner;
    expect(line("We make money by licensing.")).toBeUndefined();
    expect(line("We're building our team.")).toBeUndefined();
    expect(line("We're making progress.")).toBeUndefined();
    expect(line("We help them.")).toBeUndefined();
    expect(line("we use machine learning to design candidates")).toBeUndefined();
  });

  it("runs in under 5ms on a pitch-length chunk", () => {
    const text = "We are a London biotech building CRISPR therapeutics, raising a £1.5m pre-seed. ".repeat(5);
    fallbackExtract(text);
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) fallbackExtract(text);
    expect((performance.now() - t0) / 20).toBeLessThan(5);
  });
});
