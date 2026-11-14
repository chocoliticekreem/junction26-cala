import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  defaultInvestor,
  loadDebriefs,
  loadFounders,
  loadInvestors,
  loadProgrammes,
  loadQuotes,
  loadReplay,
  usingFixtures,
} from "@/lib/data";
import { buildReplay } from "../../scripts/build-replay";
import { isSector, isStage } from "@/lib/taxonomy";

describe("loaders", () => {
  it("return arrays", () => {
    expect(Array.isArray(loadInvestors())).toBe(true);
    expect(Array.isArray(loadFounders())).toBe(true);
    expect(Array.isArray(loadDebriefs())).toBe(true);
    expect(Array.isArray(loadProgrammes())).toBe(true);
    expect(Array.isArray(loadQuotes())).toBe(true);
    expect(Array.isArray(loadReplay())).toBe(true);
  });

  it("reports fixtures only when loaded investors carry the flag", () => {
    expect(usingFixtures()).toBe(loadInvestors().some((i) => i.fixture === true));
  });

  it("defaults the investor view to a London investor with partners on record", () => {
    const real = loadInvestors();
    const pick = defaultInvestor(real);
    expect(pick?.partners.length).toBeGreaterThan(0);
    expect(pick?.description).toMatch(/london/i);
    expect(pick).toBe(real.find((i) => i.partners.length > 0 && /london/i.test(i.description ?? "")));
    const bare = { ...real[0], partners: [], description: "Menlo Park" };
    const remote = { ...real[1], partners: [{ calaId: "p", name: "P" }], description: "Paris" };
    expect(defaultInvestor([bare, remote])).toBe(remote);
    expect(defaultInvestor([bare])).toBe(bare);
    expect(defaultInvestor([])).toBeUndefined();
  });

  it("ships no invented quotes", () => {
    expect(loadQuotes()).toEqual([]);
  });
});

describe("founder seed", () => {
  const founders = loadFounders();

  it("has 40 seeded founders with unique ids", () => {
    expect(founders).toHaveLength(40);
    expect(new Set(founders.map((f) => f.id)).size).toBe(40);
    expect(founders.every((f) => f.seeded === true)).toBe(true);
  });

  it("has sector weights that sum to 1 over taxonomy labels", () => {
    for (const f of founders) {
      const entries = Object.entries(f.sectors);
      expect(entries.every(([s]) => isSector(s))).toBe(true);
      const sum = entries.reduce((a, [, w]) => a + (w ?? 0), 0);
      expect(sum).toBeCloseTo(1, 5);
    }
  });

  it("has enough biotech founders to fire the room threshold of 12", () => {
    const biotech = founders.filter((f) => (f.sectors["biotech/therapeutics"] ?? 0) >= 0.5);
    expect(biotech.length).toBeGreaterThanOrEqual(12);
  });

  it("has valid stages, confidences and example-domain contacts", () => {
    for (const f of founders) {
      expect(f.stage && isStage(f.stage)).toBe(true);
      for (const c of Object.values(f.confidence)) {
        expect(c).toBeGreaterThanOrEqual(0.6);
        expect(c).toBeLessThanOrEqual(0.95);
      }
      expect(f.website).toMatch(/^https:\/\/[a-z0-9-]+\.example$/);
      expect(f.email?.endsWith(`@${new URL(f.website as string).hostname}`)).toBe(true);
    }
  });
});

describe("debrief seed", () => {
  it("references seeded founders and fixture investor ids", () => {
    const ids = new Set(loadFounders().map((f) => f.id));
    const debriefs = loadDebriefs();
    expect(debriefs).toHaveLength(30);
    for (const d of debriefs) {
      expect(d.seeded).toBe(true);
      expect(ids.has(d.founderId)).toBe(true);
      expect(d.investorId).toMatch(/^fx-\d{3}$/);
    }
  });
});

describe("programmes", () => {
  const programmes = loadProgrammes();

  it("have https URLs, checkedOn dates and valid stages", () => {
    expect(programmes.length).toBeGreaterThanOrEqual(18);
    expect(new Set(programmes.map((p) => p.id)).size).toBe(programmes.length);
    for (const p of programmes) {
      expect(p.url).toMatch(/^https:\/\//);
      expect(p.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(p.stages.every(isStage)).toBe(true);
      expect(p.description.length).toBeGreaterThan(20);
      if (p.sectors !== "any") expect(p.sectors.every(isSector)).toBe(true);
    }
  });
});

describe("replay", () => {
  const events = loadReplay();

  it("is sorted by t and lasts about a minute", () => {
    for (let i = 1; i < events.length; i++) {
      expect(events[i].t).toBeGreaterThanOrEqual(events[i - 1].t);
    }
    const last = events[events.length - 1].t;
    expect(last).toBeGreaterThan(50_000);
    expect(last).toBeLessThan(75_000);
  });

  it("reacts in stages: biotech, then stage, then raise", () => {
    const profile = events.filter((e) => e.kind === "profile");
    const firstBio = profile.find((e) =>
      e.extraction?.sectors.some((s) => s.label === "biotech/therapeutics"),
    );
    const stage = profile.find((e) => e.extraction?.stage?.value === "pre-seed");
    const raise = profile.find((e) => e.extraction?.raise_amount?.value === 1524000);
    expect(firstBio).toBeDefined();
    expect(stage).toBeDefined();
    expect(raise).toBeDefined();
    expect(firstBio!.t).toBeLessThan(stage!.t);
    expect(stage!.t).toBeLessThan(raise!.t);
  });

  it("places each extraction about 800 ms after its trigger word is spoken", () => {
    const transcript = events.filter((e) => e.kind === "transcript");
    const stage = events.find((e) => e.extraction?.stage);
    const spoken = transcript.find((e) => e.text?.toLowerCase().includes("pre-seed"));
    expect(stage!.t - spoken!.t).toBeLessThanOrEqual(800 + 1200);
    expect(stage!.t).toBeGreaterThan(spoken!.t - 1200);
  });

  it("matches what the build script produces from the script file", () => {
    const script = readFileSync(
      path.join(process.cwd(), "data", "replay", "demo-pitch.script.md"),
      "utf8",
    );
    expect(buildReplay(script)).toEqual(events);
  });
});
