import { describe, expect, it } from "vitest";
import { choosePrecedent, warmPath } from "@/lib/context/actions";
import type { CohortLite } from "@/lib/context/cohortRead";
import { buildFeed, cleanSectors, upsertWatch } from "@/lib/context/watch";
import { deal, investor } from "./helpers";

const NOW = new Date("2026-11-14T00:00:00Z");

const inv = investor("acme", [deal("fintech", "seed", 30), deal("consumer", "series-a", 10), deal("fintech", "series-a", 400)]);

describe("precedent", () => {
  it("prefers a same-sector, next-stage deal and marks investors.json deals as not led", () => {
    const p = choosePrecedent(inv, null, "fintech", "pre-seed");
    expect(p).toMatchObject({ company: "fintech-seed-30", round: "Seed", led: false });
  });

  it("prefers a round the investor led in the cohort", () => {
    const cohort: CohortLite = {
      companies: { c1: { id: "c1", name: "LedCo", sector: "consumer" } },
      rounds: {
        r1: {
          id: "r1",
          companyId: "c1",
          stage: "seed",
          label: "Seed",
          date: "2025-01-01",
          participants: [{ investorId: inv.calaId, name: inv.name, isLead: true }],
          sources: [{ name: "press", url: "https://p.example" }],
        },
      },
      investors: {},
    };
    expect(choosePrecedent(inv, cohort, "fintech", "pre-seed")).toMatchObject({ company: "LedCo", led: true, companyCalaId: "c1" });
  });
});

describe("warm path", () => {
  const LED_ID = "00000000-0000-4000-8000-000000000001";
  const round = (id: string, companyId: string, stage: "seed" | "series-a", date: string, isLead?: boolean) => ({
    id,
    companyId,
    stage,
    label: stage,
    date,
    participants: [{ investorId: inv.calaId, name: inv.name, ...(isLead ? { isLead } : {}) }],
    sources: [],
  });
  const cohort: CohortLite = {
    companies: {
      own: { id: "own", name: "Raise", sector: "fintech" },
      fin: { id: "fin", name: "FinJoined", sector: "fintech" },
      [LED_ID]: { id: LED_ID, name: "FinLed", sector: "fintech" },
      con: { id: "con", name: "ConsumerLed", sector: "consumer" },
      slush: { id: "slush", name: "FinSlush", sector: "fintech" },
      other: { id: "other", name: "NotBacked", sector: "fintech" },
    },
    rounds: {
      r0: round("r0", "own", "seed", "2026-06-01", true),
      r1: round("r1", "fin", "seed", "2026-09-01"),
      r2: round("r2", LED_ID, "seed", "2024-01-01", true),
      r3: round("r3", "con", "seed", "2026-10-01", true),
      r4: round("r4", "slush", "seed", "2023-01-01"),
      r5: { ...round("r5", "other", "seed", "2026-10-01"), participants: [{ investorId: "someone-else", name: "Else" }] },
      r6: round("r6", "fin", "series-a", "2026-10-01"),
    },
    investors: {},
  };
  const atSlush = (c: { id: string }) => (c.id === "slush" ? { id: "ev", name: "Slush 2026", date: "2026-11-18", place: "Helsinki" } : undefined);

  it("ranks same sector first, led before joined, then Slush attendees, max three, never the founder's company", () => {
    const w = warmPath(inv, cohort, { sector: "fintech", stage: "seed", excludeCompanyIds: ["own"] }, atSlush);
    expect(w.map((f) => f.company)).toEqual(["FinLed", "FinSlush", "FinJoined"]);
    expect(w[0]).toMatchObject({ led: true, round: "Seed", year: "2024", companyCalaId: LED_ID });
    expect(w[0].event).toBeUndefined();
    expect(w[1].event).toMatchObject({ name: "Slush 2026", date: "2026-11-18" });
  });

  it("keeps one entry per company, its round nearest the founder's stage", () => {
    const w = warmPath(inv, cohort, { sector: "fintech", stage: "seed", excludeCompanyIds: ["own"] }, () => undefined);
    // "fin" is not a Cala entity id, so it gets no link.
    expect(w.filter((f) => f.company === "FinJoined")).toEqual([{ company: "FinJoined", round: "Seed", year: "2026", led: false }]);
  });

  it("without the founder's sector, a led round in another sector ranks first", () => {
    const w = warmPath(inv, cohort, { excludeCompanyIds: ["own"] }, () => undefined);
    expect(w[0].led).toBe(true);
    expect(w.map((f) => f.company)).not.toContain("NotBacked");
  });

  it("is empty without a cohort", () => {
    expect(warmPath(inv, null, { sector: "fintech" }, () => undefined)).toEqual([]);
  });
});

describe("watch feed", () => {
  const other = investor("other", [deal("fintech", "seed", 5)]);

  it("keeps known sectors only and upserts per investor", () => {
    expect(cleanSectors(["fintech", "nope", "fintech", 3])).toEqual(["fintech"]);
    const a = upsertWatch(undefined, "raise", inv, ["fintech"], NOW);
    const b = upsertWatch(a, "raise", inv, ["consumer"], new Date("2026-12-01T00:00:00Z"));
    expect(b.items).toEqual([{ investorId: inv.id, name: inv.name, sectors: ["consumer"], since: "2026-11-14" }]);
  });

  it("returns only watched investors' rounds in watched sectors since the date, newest first", () => {
    const list = upsertWatch(undefined, "raise", inv, ["fintech"], NOW);
    const feed = buildFeed(list, [inv, other], null, "2026-01-01");
    expect(feed.map((f) => f.company)).toEqual(["fintech-seed-30"]);
    expect(feed[0].led).toBeNull();
  });

  it("an empty sector list watches every sector", () => {
    const list = upsertWatch(undefined, "raise", inv, [], NOW);
    expect(buildFeed(list, [inv], null, "2026-01-01").map((f) => f.company)).toEqual(["consumer-series-a-10", "fintech-seed-30"]);
  });

  it("uses cohort lead flags when the cohort has the round", () => {
    const list = upsertWatch(undefined, "raise", inv, ["fintech"], NOW);
    const cohort: CohortLite = {
      companies: { c1: { id: "c1", name: "LedCo", sector: "fintech" } },
      rounds: {
        r1: { id: "r1", companyId: "c1", stage: "seed", label: "Seed", date: "2026-10-01", participants: [{ investorId: inv.calaId, name: inv.name, isLead: true }], sources: [] },
        r2: { id: "r2", companyId: "c1", stage: "seed", label: "Seed", date: "2025-01-01", participants: [{ investorId: inv.calaId, name: inv.name, isLead: true }], sources: [] },
      },
      investors: {},
    };
    const feed = buildFeed(list, [inv], cohort, "2026-01-01");
    expect(feed.map((f) => [f.company, f.led])).toEqual([
      ["fintech-seed-30", null],
      ["LedCo", true],
    ]);
  });
});

describe("precedent never cites the founder's own company", () => {
  it("skips rounds of excluded companies", async () => {
    const { choosePrecedent } = await import("@/lib/context/actions");
    const inv = { id: "lsvp", calaId: "lsvp", name: "Lightspeed", kind: "fund", statedThesis: { text: "", sectors: {}, stages: {}, sources: [] }, deals: [], revealed: { S: {}, G: {}, chequeBand: [0, 0], activity: 0, dealCount24m: 0 }, contradiction: 0, thinHistory: true, partners: [], doors: [] } as never;
    const cohort = {
      companies: { own: { id: "own", name: "Cala", sector: "AI infrastructure" }, other: { id: "other", name: "Zenzap", sector: "AI infrastructure" } },
      rounds: {
        r1: { id: "r1", companyId: "own", stage: "seed", label: "Seed", date: "2026-05-11", participants: [{ investorId: "lsvp", name: "Lightspeed", isLead: true }], sources: [] },
        r2: { id: "r2", companyId: "other", stage: "seed", label: "Seed", date: "2025-03-01", participants: [{ investorId: "lsvp", name: "Lightspeed", isLead: false }], sources: [] },
      },
      investors: {},
    } as never;
    expect(choosePrecedent(inv, cohort, "AI infrastructure" as never, "seed", ["own"])?.company).toBe("Zenzap");
    expect(choosePrecedent(inv, cohort, "AI infrastructure" as never, "seed")?.company).toBe("Cala");
  });
});
