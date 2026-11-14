import { afterEach, describe, expect, it } from "vitest";
import fixture from "@/tests/fixtures/spotter-cohort.json";
import { GET } from "@/app/api/spotter/investors/route";
import { adaptSpotter, cityOf } from "@/components/spotter/adapt";
import { runSpotter } from "@/lib/sim/spotter";
import type { Cohort } from "@/lib/sim/types";
import { MIN_ROUNDS, spotterInvestorOptions } from "@/lib/sim/spotter/investors";

const cohort = fixture as unknown as Cohort;

describe("spotterInvestorOptions", () => {
  it("lists only investors with an id and at least MIN_ROUNDS rounds, busiest first", () => {
    const opts = spotterInvestorOptions(cohort);
    expect(opts.length).toBeGreaterThan(0);
    expect(opts.every((o) => o.id && o.rounds >= MIN_ROUNDS)).toBe(true);
    expect(opts.map((o) => o.rounds)).toEqual([...opts.map((o) => o.rounds)].sort((a, b) => b - a));
    expect(opts.some((o) => o.id === "inv:index")).toBe(true);
  });
});

describe("GET /api/spotter/investors", () => {
  const prev = process.env.E2E_MOCK;
  afterEach(() => {
    if (prev === undefined) delete process.env.E2E_MOCK;
    else process.env.E2E_MOCK = prev;
  });

  it("returns a deterministic mock under E2E_MOCK=1", async () => {
    process.env.E2E_MOCK = "1";
    const body = await (await GET()).json();
    expect(body.mock).toBe(true);
    expect(body.investors.some((i: { id: string }) => i.id === "seedcamp")).toBe(true);
  });
});

describe("adaptSpotter", () => {
  it("maps 0..1 scores to 0..100, precedent steps to arrays and hq to a city", () => {
    const view = adaptSpotter(runSpotter(cohort, { investorId: "inv:index" }));
    expect(view.investor.taste.sectors.length).toBeGreaterThan(0);
    expect(view.investor.taste.stages.length).toBeGreaterThan(0);
    for (const p of view.picks) {
      for (const v of Object.values(p.scores)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
        expect(Number.isInteger(v)).toBe(true);
      }
      expect(p.precedents.every((x) => x.steps.length >= 1)).toBe(true);
    }
  });

  it("shows a company name once even when the cohort holds it under two ids", () => {
    const raw = runSpotter(cohort, { investorId: "inv:index" });
    const twin = { ...raw.picks[0], company: { ...raw.picks[0].company, id: "c:twin", name: raw.picks[0].company.name.toUpperCase() } };
    const view = adaptSpotter({ ...raw, picks: [raw.picks[0], twin, ...raw.picks.slice(1)] });
    expect(view.picks.filter((p) => p.company.name.toLowerCase() === raw.picks[0].company.name.toLowerCase())).toHaveLength(1);
    expect(view.picks[0].company.id).toBe(raw.picks[0].company.id);
  });

  it("cityOf keeps the city out of a postal address", () => {
    expect(cityOf("Mindspace, 9 Appold Street, London, England, EC2A 2AP, United Kingdom")).toBe("London");
    expect(cityOf("San Francisco, CA, United States")).toBe("San Francisco");
    expect(cityOf("250 Greenwich Street, Floor 39 (7 World Trade Center), New York, NY 10007, US")).toBe("New York");
    expect(cityOf("Madrid, Spain")).toBe("Madrid");
    expect(cityOf("London")).toBe("London");
    expect(cityOf(undefined)).toBeUndefined();
  });
});
