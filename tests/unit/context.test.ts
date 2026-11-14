import { describe, expect, it } from "vitest";
import type { CalaEntity, CalaEntityMention } from "@/lib/cala";
import {
  assembleCalaFacts,
  candidateFromEntity,
  domainOf,
  groupSiblings,
  issuerRoundIds,
  pickCandidate,
  roundFromEntity,
  roundsFromQuery,
  scoreCandidate,
} from "@/lib/context/calaFacts";
import { assembleDoc, docToMarkdown } from "@/lib/context/doc";
import { parseClaims, sentenceClaims } from "@/lib/context/founderClaims";
import type { CompanyCandidate } from "@/lib/context/types";
import { parseWebsiteFacts } from "@/lib/context/website";
import fixture from "./context-cala.fixture.json";

const primary = fixture.primary as unknown as CalaEntity;
const sibling = fixture.sibling as unknown as CalaEntity;
const round = fixture.round as unknown as CalaEntity;
const NOW = new Date("2026-11-14T00:00:00Z");

const cand = (over: Partial<CompanyCandidate>): CompanyCandidate => ({
  calaId: "x",
  name: "X",
  confidence: "name",
  score: 0.3,
  ...over,
});

describe("resolve confidence", () => {
  it("normalises domains", () => {
    expect(domainOf("https://www.Cala.ai/jobs")).toBe("cala.ai");
    expect(domainOf("cala.ai")).toBe("cala.ai");
    expect(domainOf("")).toBeUndefined();
  });

  it("ranks website match over name+HQ over name only", () => {
    const input = { name: "Cala", website: "https://cala.ai", hq: "Barcelona" };
    expect(scoreCandidate(input, { name: "Cala AI", website: "www.cala.ai" }).confidence).toBe("website");
    expect(scoreCandidate(input, { name: "Cala", website: "cala.co.uk", hq: "Barcelona, Spain" }).confidence).toBe("name_hq");
    expect(scoreCandidate(input, { name: "Cala", hq: "Edinburgh" })).toEqual({ confidence: "name", score: 0.5 });
    expect(scoreCandidate(input, { name: "CALA CALA LIMITED" })).toEqual({ confidence: "name", score: 0.3 });
  });

  it("never auto-picks on name alone when several candidates exist", () => {
    expect(pickCandidate([cand({ calaId: "a", score: 0.5 }), cand({ calaId: "b", score: 0.5 })])).toBeUndefined();
    expect(pickCandidate([cand({ calaId: "a", score: 0.7, confidence: "name_hq" }), cand({ calaId: "b" })])).toBeUndefined();
    expect(pickCandidate([cand({ calaId: "a", score: 0.5 })])).toBe("a");
    expect(pickCandidate([cand({ calaId: "a", score: 0.3 })])).toBeUndefined();
    expect(pickCandidate([cand({ calaId: "a" }), cand({ calaId: "b", confidence: "website", score: 1 })])).toBe("b");
  });

  it("builds candidates from recorded entities and links same-website siblings", () => {
    const input = { name: "Cala", website: "cala.ai" };
    const m = (e: CalaEntity): CalaEntityMention => ({ id: e.id, name: e.name, entity_type: "Company" });
    const cands = groupSiblings([candidateFromEntity(input, primary, m(primary)), candidateFromEntity(input, sibling, m(sibling))]);
    expect(cands[0]).toMatchObject({ calaId: primary.id, confidence: "website", hq: "Barcelona, Spain", foundingDate: "2025" });
    expect(cands[0].siblingIds).toEqual([sibling.id]);
    expect(cands[1].siblingIds).toEqual([primary.id]);
  });

  it("falls back to the search description when retrieval failed", () => {
    const c = candidateFromEntity({ name: "Acme" }, undefined, { id: "1", name: "Acme", entity_type: "Company", description: "Widgets." });
    expect(c).toEqual({ calaId: "1", name: "Acme", confidence: "name", score: 0.5, description: "Widgets." });
  });
});

describe("doc assembly from recorded Cala fixtures", () => {
  it("reads issuer rounds only from the entity that has them", () => {
    expect(issuerRoundIds(primary)).toEqual([]);
    expect(issuerRoundIds(sibling)).toEqual([round.id]);
  });

  it("parses the round: label, stage, date (announcement over the 2025-01-01 event_date year pin), amount, lead", () => {
    const r = roundFromEntity(round);
    expect(r).toMatchObject({ label: "Pre-Seed", stage: "pre-seed", date: "2026-05-11", amountText: "EUR 7,000,000", amountUsd: 7_560_000 });
    expect(r.leads).toEqual(["Lightspeed Venture Partners"]);
    expect(r.investors).not.toContain("Cala AI");
    expect(r.sources[0].url).toMatch(/^https:/);
  });

  it("merges the legal entity and the brand sibling, citing both", () => {
    const facts = assembleCalaFacts(primary, [sibling], [roundFromEntity(round)]);
    expect(facts.calaIds).toEqual([primary.id, sibling.id]);
    expect(facts.founders.map((f) => f.name)).toContain("Elisenda Bou-Balust");
    const ls = facts.investors.find((i) => i.name === "Lightspeed Venture Partners");
    expect(ls).toMatchObject({ lead: true, round: "Pre-Seed" });
    expect(facts.website).toBe("cala.ai");
  });

  it("assembles a doc whose claims are tagged by basis and exports short markdown", () => {
    const cala = assembleCalaFacts(primary, [sibling], [roundFromEntity(round)]);
    const site = parseWebsiteFacts(
      { product: "Verified knowledge graph for AI agents.", customers: ["Acme"], pricing: "", team: [] },
      "https://cala.ai",
      "Cala",
    );
    const doc = assembleDoc({
      cala,
      site,
      visionText: "The default knowledge layer for agents.",
      founderClaims: [{ text: "3 design partners live.", basis: "founder" }],
      now: NOW,
    });
    expect(doc.id).toBe(primary.id);
    expect(doc.company).toMatchObject({ name: "Cala", website: "cala.ai", stage: "pre-seed" });
    expect(doc.coverage).toEqual({ cala: true, website: true, founder: true });
    expect(doc.claims.find((c) => c.text.startsWith("Raised Pre-Seed"))?.basis).toBe("cala");
    expect(doc.claims.find((c) => c.text.includes("Acme"))?.basis).toBe("website");
    expect(doc.claims.find((c) => c.text.startsWith("Vision:"))?.basis).toBe("founder");
    expect(doc.claims.find((c) => c.text === "3 design partners live.")?.basis).toBe("founder");
    expect(doc.pricing).toBeUndefined();
    const md = docToMarkdown(doc);
    expect(md).toMatch(/^# Cala\n/);
    expect(md).toContain("## Funding");
    expect(md).toContain("led by Lightspeed Venture Partners");
    expect(md.split("\n").length).toBeLessThan(60);
  });

  it("builds an early-idea doc with no Cala entity, keyed by slug", () => {
    const doc = assembleDoc({
      name: "Tenkai",
      visionText: "the default AI layer for AR glasses",
      founderClaims: sentenceClaims([{ name: "pitch", text: "AR operating layer. 8 signups at a club demo." }]),
      now: NOW,
    });
    expect(doc.id).toBe("tenkai");
    expect(doc.calaIds).toEqual([]);
    expect(doc.coverage).toEqual({ cala: false, website: false, founder: true });
    expect(doc.claims.every((c) => c.basis === "founder")).toBe(true);
    expect(docToMarkdown(doc)).toContain("_No Cala, website data yet._");
  });

  it("reads knowledge-query rows as rounds cited to the query", () => {
    const rs = roundsFromQuery([
      { round_type: "Seed", date: "2024-03-01", amount: "$2M", lead_investors: ["A Ventures"], investors: "A Ventures, B Capital" },
      { nothing: true },
    ]);
    expect(rs).toHaveLength(1);
    expect(rs[0]).toMatchObject({ label: "Seed", stage: "seed", date: "2024-03-01", leads: ["A Ventures"], investors: ["A Ventures", "B Capital"] });
    expect(rs[0].sources).toEqual([{ name: "Cala knowledge query" }]);
  });
});

describe("founder claim tagging", () => {
  const uploads = [{ name: "deck.md", text: "We have 40 paying customers." }];

  it("tags parsed claims founder and attributes the upload", () => {
    const claims = parseClaims({ claims: [{ text: "40 paying customers", upload: "deck.md" }, { text: "", upload: "x" }] }, uploads);
    expect(claims).toEqual([{ text: "40 paying customers", basis: "founder", source: { name: "Founder upload: deck.md" } }]);
  });

  it("ignores malformed LLM output", () => {
    expect(parseClaims(null, uploads)).toEqual([]);
    expect(parseClaims({ claims: "nope" }, uploads)).toEqual([]);
  });

  it("falls back to sentences when no LLM is available", () => {
    const c = sentenceClaims([{ name: "notes", text: "- Short.\n- We sell to 12 banks in the UK.\n" }]);
    expect(c).toEqual([{ text: "We sell to 12 banks in the UK.", basis: "founder", source: { name: "Founder upload: notes" } }]);
  });

  it("keeps website facts to what the tool returned", () => {
    const f = parseWebsiteFacts({ product: " X ", customers: ["A", "A", 3], team: "bad" }, "https://x.io");
    expect(f).toEqual({ url: "https://x.io", product: "X", customers: ["A"], team: [], source: { name: "x.io", url: "https://x.io", rank: "PRIMARY" } });
  });
});
