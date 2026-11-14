import { describe, expect, it } from "vitest";
import {
  MemoryLRU,
  dedupeByKey,
  entitySources,
  investorKey,
  normaliseDate,
  normaliseRound,
  parseAmountUsd,
  searchSources,
  toSource,
  type CalaEntity,
  type CalaSearchResponse,
} from "@/lib/cala";

describe("normaliseDate", () => {
  it.each([
    ["1 Oct 2025", "2025-10-01", false],
    ["12 Sep 2025", "2025-09-12", false],
    ["2025-03-04", "2025-03-04", false],
    ["September 23, 2025", "2025-09-23", false],
    ["Oct 2025", "2025-10-15", true],
    ["Jun 2025", "2025-06-15", true],
    ["Sept 2025", "2025-09-15", true],
    ["Late 2025", "2025-10-01", true],
    ["Early 2026", "2026-02-01", true],
    ["Mid-2024", "2024-06-01", true],
    ["Q3 2025", "2025-08-15", true],
    ["H1 2025", "2025-04-01", true],
    ["2025", "2025-07-01", true],
    ["2025-07", "2025-07-15", true],
  ])("%s -> %s", (raw, date, approximate) => {
    expect(normaliseDate(raw)).toEqual({ date, approximate });
  });

  it.each(["", "—", "Undisclosed", undefined, null, 2025])("returns no date for %s", (raw) => {
    expect(normaliseDate(raw).date).toBeUndefined();
  });

  it("does not read words that merely contain month letters as months", () => {
    expect(normaliseDate("Marketing push 2025")).toEqual({ date: "2025-07-01", approximate: true });
  });
});

describe("parseAmountUsd", () => {
  it.each([
    ["$8.3M", 8_300_000],
    ["~$2.7M", 2_700_000],
    ["$1.6M (€1.3M)", 1_600_000],
    ["~$0.8M", 800_000],
    ["€5.5M", 5_940_000],
    ["£500k", 635_000],
    ["£4,500,000", 5_715_000],
    ["€12.6M (~£10.9M)", 13_608_000],
    ["$13.2M (~£9.8M)", 13_200_000],
    ["£4M (~$5.4M)", 5_400_000],
    ["US$35,000,000", 35_000_000],
    ["$1.2bn", 1_200_000_000],
    ["over 100M", 100_000_000],
    ["GBP 2 million", 2_540_000],
  ])("%s -> %d", (raw, usd) => {
    expect(parseAmountUsd(raw)).toBeCloseTo(usd, -1);
  });

  it.each(["Undisclosed", "—", "", "Series 2", "2025", undefined])("returns undefined for %s", (raw) => {
    expect(parseAmountUsd(raw)).toBeUndefined();
  });
});

describe("normaliseRound", () => {
  it.each([
    ["Pre-Seed", "pre-seed"],
    ["Angel", "pre-seed"],
    ["Seed", "seed"],
    ["Seed+", "seed"],
    ["Seed Extension", "seed"],
    ["Pre-Series A", "seed"],
    ["Series A", "series-a"],
    ["Series A+", "series-a"],
    ["Series B", "series-b-plus"],
    ["Series D", "series-b-plus"],
    ["Growth", "series-b-plus"],
    ["—", "unknown"],
    ["Convertible Note", "unknown"],
    ["", "unknown"],
  ])("%s -> %s", (raw, stage) => {
    expect(normaliseRound(raw)).toBe(stage);
  });

  it.each(["Grant", "Non-Equity Assistance", "Debt Financing", "IPO", "Acquisition"])(
    "drops non-equity round %s",
    (raw) => {
      expect(normaliseRound(raw)).toBeNull();
    },
  );
});

describe("investorKey and dedupe", () => {
  it("collapses Cala's Seedcamp vehicle variants onto one key", () => {
    const variants = [
      "Seedcamp",
      "Seedcamp Limited",
      "SEEDCAMP INVESTMENT MANAGEMENT LLP",
      "SEEDCAMP GP LLP",
      "SEEDCAMP III L.P.",
      "SEEDCAMP VI (ENG) LIMITED",
      "Seedcamp Holdings Limited",
    ];
    expect(new Set(variants.map(investorKey))).toEqual(new Set(["seedcamp"]));
  });

  it("matches common name variants", () => {
    expect(investorKey("Balderton Capital")).toBe(investorKey("Balderton"));
    expect(investorKey("Index Ventures (UK) LLP")).toBe(investorKey("Index Ventures"));
    expect(investorKey("Local Globe")).toBe(investorKey("LocalGlobe"));
    expect(investorKey("IQ Capital Partners")).toBe(investorKey("IQ Capital"));
  });

  it("keeps distinct funds apart", () => {
    expect(investorKey("Octopus Ventures")).not.toBe(investorKey("Notion Capital"));
    expect(investorKey("2150")).toBe("2150");
    expect(investorKey("Israeli SeedCamp")).not.toBe(investorKey("Seedcamp"));
  });

  it("dedupeByKey keeps one entry per key using the preference", () => {
    const out = dedupeByKey(
      [{ n: "SEEDCAMP GP LLP" }, { n: "Seedcamp" }, { n: "LocalGlobe" }],
      (x) => x.n,
      (a, b) => (b.n.length < a.n.length ? b : a),
    );
    expect(out.map((x) => x.n).sort()).toEqual(["LocalGlobe", "Seedcamp"]);
  });
});

describe("source helpers", () => {
  it("maps Cala sources and drops empty documents", () => {
    expect(toSource({ name: "Cala AI", document: "", date: "2026-07-22" })).toEqual({
      name: "Cala AI",
      date: "2026-07-22",
    });
    expect(toSource({ name: "tech.eu", document: "https://tech.eu/x", date: "2023-12-14" })).toEqual({
      name: "tech.eu",
      url: "https://tech.eu/x",
      date: "2023-12-14",
    });
    expect(toSource({})).toBeUndefined();
  });

  it("collects and dedupes search and entity sources", () => {
    const search: CalaSearchResponse = {
      content: "x",
      entities: [],
      context: [
        { id: "1", content: "a", origins: [{ source: { name: "S" }, document: { name: "Doc", url: "https://a.com/1" } }] },
        { id: "2", content: "b", origins: [{ source: { name: "S" }, document: { name: "Doc", url: "https://a.com/1" } }] },
      ],
    };
    expect(searchSources(search)).toEqual([{ name: "Doc", url: "https://a.com/1" }]);
    const entity: CalaEntity = {
      id: "e",
      name: "E",
      entity_type: "Company",
      properties: { name: { value: "E", sources: [{ name: "n", document: "https://n.com" }] } },
      relationships: {
        outgoing: { INVESTED_IN: [{ id: "c", name: "C", entity_type: "Company", properties: { sources: [{ name: "m", document: "https://m.com" }] } }] },
      },
    };
    expect(entitySources(entity).map((s) => s.url)).toEqual(["https://n.com", "https://m.com"]);
  });
});

describe("MemoryLRU", () => {
  it("evicts the least recently used entry", async () => {
    const c = new MemoryLRU(2);
    await c.set("a", 1);
    await c.set("b", 2);
    await c.get("a");
    await c.set("c", 3);
    expect(await c.get("b")).toBeUndefined();
    expect(await c.get("a")).toBe(1);
    expect(await c.get("c")).toBe(3);
  });
});
