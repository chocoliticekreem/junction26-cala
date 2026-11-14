import { afterEach, describe, expect, it } from "vitest";
import fixture from "@/tests/fixtures/spotter-cohort.json";
import { POST } from "@/app/api/spotter/route";
import { spotterCandidates, spotterIndex } from "@/lib/sim/spotter";
import { hostEventName, hostEvents, MAX_GROUPS, MAX_INVITES, MIN_GROUP } from "@/lib/sim/spotter/host";
import { tasteFromIndex } from "@/lib/sim/spotter/taste";
import type { Cohort } from "@/lib/sim/types";

const cohort = fixture as unknown as Cohort;

describe("hostEvents", () => {
  it("groups the fund's lane by sector, drops groups under MIN_GROUP and never pads", () => {
    const idx = spotterIndex(cohort);
    const taste = tasteFromIndex(idx, "inv:index");
    const bySector = new Map<string, string[]>();
    for (const c of spotterCandidates(idx, taste)) bySector.set(c.row.co.sector, [...(bySector.get(c.row.co.sector) ?? []), c.row.co.id]);

    const events = hostEvents(cohort, { investorId: "inv:index" });
    expect(events.length).toBeGreaterThan(0);
    expect(events.length).toBeLessThanOrEqual(MAX_GROUPS);
    for (const e of events) {
      const lane = bySector.get(e.sector)!;
      expect(e.count).toBe(lane.length);
      expect(e.count).toBeGreaterThanOrEqual(MIN_GROUP);
      expect(e.companies.length).toBe(Math.min(MAX_INVITES, lane.length));
      for (const c of e.companies) expect(lane).toContain(c.id);
      expect(new Set(e.companies.map((c) => c.id)).size).toBe(e.companies.length);
      expect(e.name).toBe(hostEventName(e.sector));
    }
    for (const [sector, ids] of bySector) if (ids.length < MIN_GROUP) expect(events.some((e) => e.sector === sector)).toBe(false);
  });

  it("counts attendees with the given predicate and tags each invite", () => {
    const idx = spotterIndex(cohort);
    const lane = spotterCandidates(idx, tasteFromIndex(idx, "inv:index")).map((c) => c.row.co.id);
    const attending = new Set(lane.filter((_, i) => i % 2 === 0));
    const events = hostEvents(cohort, { investorId: "inv:index", attending: (c) => attending.has(c.id) });
    for (const e of events) {
      const full = lane.filter((id) => idx.rows.get(id)!.co.sector === e.sector);
      expect(e.atSlush).toBe(full.filter((id) => attending.has(id)).length);
      for (const c of e.companies) expect(c.atSlush).toBe(attending.has(c.id));
    }
    expect(hostEvents(cohort, { investorId: "inv:index" }).every((e) => e.atSlush === 0)).toBe(true);
  });

  it("names the event from the sector, deterministically", () => {
    expect(hostEventName("fintech")).toBe("Fintech founders breakfast · Slush week");
    expect(hostEventName("applied AI/vertical SaaS")).toBe("Applied AI founders breakfast · Slush week");
  });

  it("rejects an unknown investor", () => {
    expect(() => hostEvents(cohort, { investorName: "Nobody Capital" })).toThrow(/No investor/);
  });
});

describe("POST /api/spotter host", () => {
  const prev = process.env.E2E_MOCK;
  afterEach(() => {
    if (prev === undefined) delete process.env.E2E_MOCK;
    else process.env.E2E_MOCK = prev;
  });

  it("returns host events under E2E_MOCK=1", async () => {
    process.env.E2E_MOCK = "1";
    const res = await POST(new Request("http://x/api/spotter", { method: "POST", body: JSON.stringify({ investorName: "Seedcamp" }) }));
    const body = await res.json();
    expect(body.host).toHaveLength(2);
    expect(body.host[0].name).toMatch(/breakfast/);
    expect(body.host[0].companies.length).toBe(body.host[0].count);
  });
});
