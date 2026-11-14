import { describe, expect, it, vi } from "vitest";
import {
  MAX_EMAIL_WORDS,
  choosePrecedent,
  draftEmail,
  emailFacts,
  mailtoFor,
  templateDraft,
  ungroundedTokens,
  wordCount,
  type EmailFacts,
} from "@/lib/context/actions";
import type { CohortLite } from "@/lib/context/cohortRead";
import { assembleDoc } from "@/lib/context/doc";
import { buildFeed, cleanSectors, upsertWatch } from "@/lib/context/watch";
import { deal, investor } from "./helpers";

const NOW = new Date("2026-11-14T00:00:00Z");

const doc = assembleDoc({
  name: "Raise",
  pitchProfile: {
    company: "Raise",
    oneLiner: "Maps London investors by what they funded",
    stage: "pre-seed",
    sectors: { fintech: 1 },
    traction: { users: "40 founders onboarded" },
  },
  visionText: "the default fundraising layer for European founders",
  now: NOW,
});

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

describe("email draft guard", () => {
  const precedent = choosePrecedent(inv, null, "fintech", "pre-seed");
  const facts: EmailFacts = emailFacts(doc, inv, precedent);

  it("accepts a draft that only uses input facts and placeholders", async () => {
    const llm = vi.fn(async () => ({
      subject: "Raise: pre-seed intro",
      body: `Hi Zoë,\n\nI saw Investor acme backed fintech-seed-30. I'm building Raise: it maps London investors by what they funded. We have 40 founders onboarded.\n\n[Your name]`,
    }));
    const d = await draftEmail(facts, llm);
    expect(llm).toHaveBeenCalledOnce();
    expect(d.grounded).toBe("llm");
  });

  it("rejects an invented customer, number or name and falls back to the template", async () => {
    for (const body of [
      "Hi Zoë, Raise already works with Goldman Sachs. [Your name]",
      "Hi Zoë, Raise has 3,000 users. [Your name]",
      "Hi Zoë, our advisor Paul Graham likes Raise. [Your name]",
    ]) {
      const d = await draftEmail(facts, async () => ({ subject: "Raise", body }));
      expect(d.grounded).toBe("template");
    }
  });

  it("flags exactly the ungrounded tokens, ignoring [placeholders]", () => {
    expect(ungroundedTokens("We grew 300% with Stripe. [Revenue 2M]", facts).sort()).toEqual(["300", "Stripe"]);
    expect(ungroundedTokens("I'm building Raise in London. [traction]", facts)).toEqual([]);
  });

  it("falls back when the LLM fails, returns nothing, or runs long", async () => {
    expect((await draftEmail(facts, async () => null)).grounded).toBe("template");
    expect((await draftEmail(facts, async () => { throw new Error("429"); })).grounded).toBe("template");
    const long = Array.from({ length: MAX_EMAIL_WORDS + 5 }, () => "word").join(" ");
    expect((await draftEmail(facts, async () => ({ subject: "Raise", body: long }))).grounded).toBe("template");
  });

  it("template is grounded, short, and uses placeholders for gaps", () => {
    const t = templateDraft(facts);
    expect(ungroundedTokens(`${t.subject}\n${t.body}`, facts)).toEqual([]);
    expect(wordCount(t.body)).toBeLessThanOrEqual(MAX_EMAIL_WORDS);
    expect(t.body).toContain("backed fintech-seed-30");
    expect(t.body).toContain("[Your name]");
    const oneLiner = "AR layer; 8 signups at a club demo";
    const same = templateDraft({ company: "Tenkai", product: oneLiner, founderClaims: [oneLiner], investor: "Fund" });
    expect(same.body.split(oneLiner)).toHaveLength(2);
    const bare = templateDraft({ company: "Tenkai", founderClaims: [], investor: "Fund" });
    expect(bare.body).toContain("Hi [name]");
    expect(bare.body).toContain("[One line of traction]");
  });

  it("mailto has no recipient", () => {
    expect(mailtoFor({ subject: "a b", body: "c&d" })).toBe("mailto:?subject=a%20b&body=c%26d");
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
