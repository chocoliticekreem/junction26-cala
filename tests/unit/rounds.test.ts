import { describe, expect, it } from "vitest";
import type { CalaEdge, CalaEntity } from "@/lib/cala";
import {
  dealFromRound,
  dedupeFinancings,
  matchEventParticipants,
  mergeGraphDeals,
  parseFundingRound,
  roundStage,
  sameFinancing,
} from "@/lib/rounds";
import type { Deal } from "@/lib/types";
import fixture from "./fixtures/cala-graph.json";

const [raySeed, trogenixA, rayB] = fixture.rounds as unknown as CalaEntity[];
const attendees = fixture.eventParticipants as unknown as CalaEdge[];
const FOUR_BIO = "30b28644-8080-4d4c-bd57-8b67b3f75a22";
const IQ_CAPITAL = "0974156f-b65e-4c2f-89d8-2f4eed882f47";

describe("parseFundingRound (recorded Cala responses)", () => {
  it("reads label, amount, date, issuer and the lead flag", () => {
    const r = parseFundingRound(raySeed);
    expect(r).toMatchObject({ roundId: raySeed.id, name: "Seed", stage: "seed", amountUsd: 6_000_000, amount: "$6M", date: "2022-01-01" });
    expect(r.issuer?.name).toBe("Ray Therapeutics, Inc.");
    expect(r.participants.find((p) => p.id === FOUR_BIO)).toMatchObject({ role: "INVESTOR", isLead: true });
    expect(r.hasLeadData).toBe(true);
  });

  it("falls back to announcement_date and converts GBP at the fixed rate", () => {
    const r = parseFundingRound(trogenixA);
    expect(r.stage).toBe("series-a");
    expect(r.date).toBe("2025-10-06");
    expect(r.datePrecision).toBeUndefined();
    expect(r.amount).toBe("£70M");
    expect(r.amountUsd).toBe(Math.round(70_000_000 * 1.27));
  });

  it("orders sources by rank, PRIMARY before PRESS", () => {
    const r = parseFundingRound(rayB);
    expect(r.sources[0].rank).toBe("PRIMARY");
    expect(r.sources.map((s) => s.rank)).toContain("PRESS");
  });
});

describe("roundStage", () => {
  it("maps round_label codes and drops debt and grants", () => {
    expect(roundStage("PRE_SEED", "Pre-Seed")).toBe("pre-seed");
    expect(roundStage("SERIES_B", "Series B")).toBe("series-b-plus");
    expect(roundStage(undefined, "Seed+")).toBe("seed");
    expect(roundStage("GRANT", "Grant")).toBeNull();
    expect(roundStage("SEED", "Seed", "DEBT")).toBeNull();
    expect(roundStage("FUNDING_ROUND", "Funding round")).toBe("unknown");
  });
});

describe("dealFromRound", () => {
  it("marks the lead", () => {
    const d = dealFromRound(parseFundingRound(raySeed), new Set([FOUR_BIO]), "biotech/therapeutics");
    expect(d).toMatchObject({ company: "Ray Therapeutics, Inc.", round: "seed", isLead: true, roundId: raySeed.id });
  });

  it("marks a known non-lead as false when the round names another lead", () => {
    const r = parseFundingRound(trogenixA);
    expect(dealFromRound(r, new Set([FOUR_BIO]), "biotech/therapeutics")?.isLead).toBe(false);
    expect(dealFromRound(r, new Set([IQ_CAPITAL]), "biotech/therapeutics")?.isLead).toBe(true);
  });

  it("leaves isLead out when no participant is marked lead", () => {
    const r = parseFundingRound(raySeed);
    const noLead = { ...r, participants: r.participants.map((p) => ({ ...p, isLead: false })), hasLeadData: false };
    expect(dealFromRound(noLead, new Set([FOUR_BIO]), "biotech/therapeutics")).not.toHaveProperty("isLead");
  });

  it("carries the best source rank with that source first", () => {
    const d = dealFromRound(parseFundingRound(rayB), new Set([FOUR_BIO]), "biotech/therapeutics")!;
    expect(d.sourceRank).toBe("PRIMARY");
    expect(d.sources[0].url).toMatch(/^https:/);
  });

  it("ignores lenders, investors not in the round, and non-equity rounds", () => {
    const r = parseFundingRound(raySeed);
    expect(dealFromRound(r, new Set(["someone-else"]), "fintech")).toBeUndefined();
    const lent = { ...r, participants: r.participants.map((p) => (p.id === FOUR_BIO ? { ...p, role: "LENDER" } : p)) };
    expect(dealFromRound(lent, new Set([FOUR_BIO]), "fintech")).toBeUndefined();
    expect(dealFromRound({ ...r, stage: null }, new Set([FOUR_BIO]), "fintech")).toBeUndefined();
  });
});

const g = (over: Partial<Deal>): Deal => ({
  company: "Acme Bio",
  companyCalaId: "acme",
  round: "seed",
  date: "2025-06-01",
  sector: "biotech/therapeutics",
  sources: [{ name: "graph", url: "https://graph.example" }],
  roundId: "r1",
  ...over,
});

describe("sameFinancing / dedupeFinancings", () => {
  it("matches the same issuer within 45 days and 10% of amount", () => {
    expect(sameFinancing(g({ amountUsd: 10e6 }), g({ date: "2025-07-10", amountUsd: 10.8e6 }))).toBe(true);
    expect(sameFinancing(g({ amountUsd: 10e6 }), g({ date: "2025-07-20", amountUsd: 10e6 }))).toBe(false);
    expect(sameFinancing(g({ amountUsd: 10e6 }), g({ amountUsd: 12e6 }))).toBe(false);
    expect(sameFinancing(g({}), g({ company: "Other", companyCalaId: "other" }))).toBe(false);
  });

  it("without both amounts, needs the same known round", () => {
    expect(sameFinancing(g({}), g({ date: "2025-06-20", amountUsd: 5e6 }))).toBe(true);
    expect(sameFinancing(g({}), g({ round: "series-a" }))).toBe(false);
    expect(sameFinancing(g({ round: "unknown" }), g({ round: "unknown" }))).toBe(false);
  });

  it("keeps the more complete record", () => {
    const filing = g({ roundId: "filing", amountUsd: 5e6 });
    const round = g({ roundId: "round", amountUsd: 5.2e6, isLead: true, sourceRank: "PRESS" });
    expect(dedupeFinancings([filing, round]).map((d) => d.roundId)).toEqual(["round"]);
  });
});

describe("mergeGraphDeals", () => {
  const query: Deal = {
    company: "Acme Bio Ltd",
    round: "seed",
    date: "2025-07-15",
    amount: "$5M",
    amountUsd: 5e6,
    sector: "healthtech",
    sources: [{ name: "Cala knowledge query" }],
  };

  it("replaces the query deal for the same company and round, keeping its sector and citations", () => {
    const { deals, replaced, added } = mergeGraphDeals([query], [g({ isLead: true })]);
    expect({ replaced, added }).toEqual({ replaced: 1, added: 0 });
    expect(deals).toHaveLength(1);
    expect(deals[0]).toMatchObject({ roundId: "r1", isLead: true, sector: "healthtech", date: "2025-06-01", amountUsd: 5e6 });
    expect(deals[0].sources.map((s) => s.name)).toEqual(["graph", "Cala knowledge query"]);
  });

  it("keeps query deals for other rounds and adds new graph deals", () => {
    const { deals, added } = mergeGraphDeals([query], [g({ round: "series-a", roundId: "r2" })]);
    expect(added).toBe(1);
    expect(deals).toHaveLength(2);
  });

  it("on re-run keeps the earlier sector, unless it was the 'other' fallback", () => {
    const kept = mergeGraphDeals([g({ sector: "fintech" })], [g({ sector: "edtech" })]).deals[0];
    expect(kept.sector).toBe("fintech");
    const fixed = mergeGraphDeals([g({ sector: "other" })], [g({ sector: "biotech/therapeutics" })]).deals[0];
    expect(fixed.sector).toBe("biotech/therapeutics");
  });

  it("is idempotent on re-run (same roundId)", () => {
    const once = mergeGraphDeals([query], [g({})]).deals;
    const twice = mergeGraphDeals(once, [g({})]);
    expect(twice.deals).toHaveLength(1);
    expect(twice.added + twice.replaced).toBe(0);
  });
});

// Fixture: participants of one recorded event (Slush 2026), trimmed.
describe("matchEventParticipants", () => {
  const investors = [
    { id: "ewor", calaId: "a2e00460-78f7-42c7-bb1b-8aaecce08f9f", name: "EWOR" },
    { id: "point-nine", calaId: "not-the-attendee-id", name: "Point Nine" },
    { id: "form-ventures", calaId: "x", name: "Form Ventures" },
    { id: "techstars-london", calaId: "y", name: "Techstars London" },
    { id: "zinc", calaId: "z", name: "Zinc" },
  ];

  it("matches by Cala id, and by name only when the participant's name says investor", () => {
    const m = matchEventParticipants(attendees, investors);
    expect([...m.keys()].sort()).toEqual(["ewor", "point-nine"]);
    expect(m.get("ewor")).toMatchObject({ via: "id", source: { name: "Slush", url: "https://slush.org/" } });
    expect(m.get("point-nine")).toMatchObject({ via: "name", attendeeId: "c934f7e3-6ee3-4983-b0e1-f7827df567f9" });
  });
});
