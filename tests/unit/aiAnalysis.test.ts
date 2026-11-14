import { describe, expect, it, vi } from "vitest";
import { analyzeFounder, FOUNDER_TOOL } from "@/lib/ai/analyzeFounder";
import { analyzeVision } from "@/lib/ai/analyzeVision";
import type { ToolCaller } from "@/lib/ai/strict";
import { tagAll, textHash, type CacheEntry, type TagCache } from "@/lib/ai/tagCompanies";
import { dealKey, withDealTags } from "@/lib/data";
import { emptyProfile, mergeProfile } from "@/lib/mergeProfile";
import { fitModel } from "@/lib/sim/fit";
import { companiesLike } from "@/lib/sim/similarity";
import { simulate } from "@/lib/sim/simulate";
import type { Cohort, StartState, Vision } from "@/lib/sim/types";
import { fixture } from "./simHelpers";
import type { Investor } from "@/lib/types";

const stub = (out: unknown): ToolCaller => vi.fn(async () => out);
const failing: ToolCaller = async () => {
  throw new Error("boom");
};

describe("analyzeFounder", () => {
  const eeg = {
    primary_sector: "deep tech/hardware",
    tags: ["EEG", "consumer neurotech", "wearable", "eeg"],
    sectors: [
      { label: "deep tech/hardware", confidence: 0.8 },
      { label: "medtech/devices", confidence: 0.4 },
    ],
    stage: { value: "pre-seed", confidence: 0.7 },
    raise_amount: { value: 1500000, confidence: 0.8 },
    company: { value: "Lumen", confidence: 0.9 },
  };

  it("returns the broad sector, the precise domain as tags, and analysis: ai", async () => {
    const call = stub(eeg);
    const r = await analyzeFounder("we make an e e g headband for focus", { call });
    expect(r.analysis).toBe("ai");
    expect(r.founder.sector).toBe("deep tech/hardware");
    expect(r.founder.tags).toEqual(["EEG", "consumer neurotech", "wearable"]);
    expect(r.founder.sectorWeights["deep tech/hardware"]).toBeCloseTo(0.667, 2);
    expect(r.founder.stage).toBe("pre-seed");
    expect(r.founder.raiseUsd).toBe(1_500_000);
    expect(r.founder.company).toBe("Lumen");
    expect(r.founder.confidence.stage).toBe(0.7);
    expect(r.extraction.tags).toEqual(r.founder.tags);
    const opts = (call as unknown as { mock: { calls: [{ strict: boolean; tool: { name: string } }][] } }).mock.calls[0][0];
    expect(opts.strict).toBe(true);
    expect(opts.tool.name).toBe(FOUNDER_TOOL.name);
  });

  it("adds the primary sector when the model left it out of sectors", async () => {
    const r = await analyzeFounder("defence drones", { call: stub({ primary_sector: "deep tech/hardware", tags: ["defence", "drones"], sectors: [] }) });
    expect(r.founder.sector).toBe("deep tech/hardware");
    expect(r.extraction.sectors.map((s) => s.label)).toContain("deep tech/hardware");
  });

  it("falls back to keywords, flagged, when the call throws or returns junk", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const thrown = await analyzeFounder("a fintech app for payments", { call: failing });
    expect(thrown.analysis).toBe("keyword_fallback");
    expect(thrown.fallbackReason).toBe("llm_error");
    expect(thrown.founder.sector).toBe("fintech");
    const junk = await analyzeFounder("a fintech app for payments", { call: stub({ nope: 1 }) });
    expect(junk.analysis).toBe("keyword_fallback");
    expect(junk.fallbackReason).toBe("invalid_output");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("strict schema closes every object", () => {
    const walk = (n: unknown): void => {
      if (!n || typeof n !== "object") return;
      const o = n as Record<string, unknown>;
      if (o.type === "object") expect(o.additionalProperties).toBe(false);
      Object.values(o).forEach(walk);
    };
    walk(FOUNDER_TOOL.input_schema);
  });
});

describe("analyzeVision", () => {
  const out = (o: Record<string, unknown>) => ({
    targetStage: "series-a",
    horizonYears: 5,
    targetValuationUsd: null,
    targetHeadcount: null,
    targetRevenueUsd: null,
    targetFundingUsd: null,
    goesPublic: false,
    profitable: false,
    sector: "other",
    interpretation: "",
    ...o,
  });

  it("unicorn is always $1B and Series B+, whatever the model says", async () => {
    const r = await analyzeVision("become a unicorn in 6 years", { call: stub(out({ horizonYears: 6, targetValuationUsd: 500_000_000 })) });
    expect(r.analysis).toBe("ai");
    expect(r.vision.targetValuationUsd).toBe(1e9);
    expect(r.vision.targetStage).toBe("series-b-plus");
    expect(r.vision.horizonYears).toBe(6);
    expect(r.vision.interpretation).toBe("Unicorn = valuation of $1B or more, within 6 years");
  });

  it("decacorn is $10B; IPO is Series B+ and public; keeps the model's line when consistent", async () => {
    const d = await analyzeVision("a decacorn", { call: stub(out({ targetValuationUsd: 1e10, interpretation: "Decacorn = $10B+ valuation" })) });
    expect(d.vision.targetValuationUsd).toBe(1e10);
    expect(d.vision.interpretation).toBe("Decacorn = $10B+ valuation");
    const ipo = await analyzeVision("IPO on Nasdaq", { call: stub(out({})) });
    expect(ipo.vision.goesPublic).toBe(true);
    expect(ipo.vision.targetStage).toBe("series-b-plus");
  });

  it("reads profitable / bootstrapped and revenue targets", async () => {
    const r = await analyzeVision("profitable and bootstrapped at $10M ARR", {
      call: stub(out({ targetStage: "seed", profitable: true, targetRevenueUsd: 1e7, interpretation: "Profitable at $10M ARR, no outside funding needed" })),
    });
    expect(r.vision.profitable).toBe(true);
    expect(r.vision.targetRevenueUsd).toBe(1e7);
    expect(r.vision.targetStage).toBe("seed");
  });

  it("falls back to keywords, flagged, and still applies the glossary", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await analyzeVision("a unicorn, bootstrapped first", { call: failing });
    expect(r.analysis).toBe("keyword_fallback");
    expect(r.vision.targetValuationUsd).toBe(1e9);
    expect(r.vision.profitable).toBe(true);
    expect(r.vision.interpretation).toMatch(/^Unicorn = valuation of \$1B or more/);
    warn.mockRestore();
  });
});

function memCache(): TagCache & { m: Map<string, CacheEntry> } {
  const m = new Map<string, CacheEntry>();
  return { m, get: async (id) => m.get(id), set: async (id, e) => void m.set(id, e) };
}

describe("tagAll", () => {
  const items = Array.from({ length: 60 }, (_, i) => ({ id: `c${i}`, name: `Co ${i}`, description: i === 0 ? "EEG headband" : "payments" }));
  const tagger: ToolCaller = vi.fn(async ({ user }) => ({
    companies: (JSON.parse(user) as { id: string; description: string }[]).map((c) => ({
      id: c.id,
      sector: c.description.includes("EEG") ? "medtech/devices" : "fintech",
      tags: c.description.includes("EEG") ? ["EEG", "neurotech"] : ["payments"],
    })),
  }));

  it("batches 25 per call, caches by id + text hash, and a re-run makes no call", async () => {
    const cache = memCache();
    const first = await tagAll(items, { call: tagger, cache });
    expect(first.calls).toBe(3);
    expect(first.tagged).toBe(60);
    expect(first.results.get("c0")).toEqual({ sector: "medtech/devices", tags: ["EEG", "neurotech"] });
    const again = await tagAll(items, { call: tagger, cache });
    expect(again.calls).toBe(0);
    expect(again.cached).toBe(60);
    const changed = await tagAll([{ ...items[1], description: "EEG sleep band" }, ...items.slice(2)], { call: tagger, cache });
    expect(changed.calls).toBe(1);
    expect(cache.m.get("c1")?.h).toBe(textHash({ ...items[1], description: "EEG sleep band" }));
  });

  it("stops at maxCalls and reports what is missing", async () => {
    const r = await tagAll(items, { call: tagger, cache: memCache(), maxCalls: 1 });
    expect(r.calls).toBe(1);
    expect(r.missing).toHaveLength(35);
  });
});

describe("similarity", () => {
  const co = (id: string, sector: Cohort["companies"][string]["sector"], description: string, tags?: string[]) => ({
    id,
    name: id,
    sector,
    description,
    tags,
    status: "active" as const,
    roundIds: [],
    sources: [],
  });
  const cohort: Cohort = {
    version: 1,
    asOf: "2026-11-14",
    rounds: {},
    investors: {},
    companies: {
      a: co("a", "medtech/devices", "Clinical EEG monitoring for epilepsy", ["EEG", "neurotech"]),
      b: co("b", "deep tech/hardware", "Wearable brain-computer interface headset", ["neurotech", "wearable"]),
      c: co("c", "fintech", "Payments and lending for SMEs", ["payments"]),
      d: co("d", "fintech", "Card issuing API", ["payments", "cards"]),
    },
  };

  it("ranks neurotech companies above fintech for an EEG wearable, across sector labels", () => {
    const like = companiesLike(cohort, { tags: ["EEG", "neurotech", "wearable"], text: "EEG headband for focus", sectorWeights: { "deep tech/hardware": 1 } });
    expect(like.slice(0, 2).map((x) => x.companyId).sort()).toEqual(["a", "b"]);
    expect(like[3].textSimilarity).toBe(0);
  });
});

describe("precedents use similarity", () => {
  it("with no sector, a drug-discovery founder's precedents lead with drug-discovery companies", () => {
    const model = fitModel(fixture);
    const vision: Vision = { text: "Series B", targetStage: "series-b-plus", horizonYears: 5 };
    const start: StartState = { sectors: {}, stage: "seed", tags: ["drug discovery"], description: "drug discovery platform" };
    const r = simulate(start, vision, model, { runs: 200, seed: 1 });
    expect(r.precedents.every((p) => typeof p.similarity === "number")).toBe(true);
    expect(r.precedents[0].sector).toBe("biotech/therapeutics");
    const plain = simulate({ sectors: {}, stage: "seed" }, vision, model, { runs: 200, seed: 1 });
    expect(plain.precedents.some((p) => p.similarity !== undefined)).toBe(false);
  });
});

describe("tags in profiles and deals", () => {
  it("mergeProfile unions tags case-insensitively", () => {
    const p = mergeProfile(mergeProfile(emptyProfile(), { sectors: [], tags: ["EEG", "wearable"] }), { sectors: [], tags: ["eeg", "neurotech"] });
    expect(p.tags).toEqual(["EEG", "wearable", "neurotech"]);
  });

  it("deal-tags overlay adds tags and replaces only an 'other' sector", () => {
    const inv = {
      id: "i",
      deals: [
        { company: "Neuro Co", round: "seed", sector: "other", sources: [] },
        { company: "Pay Co", companyCalaId: "cala-1", round: "seed", sector: "fintech", sources: [] },
      ],
    } as unknown as Investor;
    const out = withDealTags([inv], {
      [dealKey({ company: "Neuro Co" })]: { sector: "medtech/devices", tags: ["EEG"] },
      "cala-1": { sector: "crypto/web3", tags: ["payments"] },
    });
    expect(out[0].deals[0]).toMatchObject({ sector: "medtech/devices", tags: ["EEG"] });
    expect(out[0].deals[1]).toMatchObject({ sector: "fintech", tags: ["payments"] });
  });
});
