import { describe, expect, it } from "vitest";
import type { ContextDoc } from "@/lib/context/types";
import { pickRoundDate } from "@/lib/rounds";
import type { Cohort } from "@/lib/sim/types";
import type { Investor } from "@/lib/types";
import { isBorderline, pageCheck, titleCheck } from "@/lib/verify/checks";
import { cohortRoundClaim, contextDocClaims, ctxInvestorId, dealClaim, dealClaimId, entityWarning } from "@/lib/verify/claims";
import { contextTrust } from "@/lib/verify/load";
import { amountPatterns, mentionsAmount, mentionsName, nameVariants } from "@/lib/verify/mention";
import {
  amountCheck,
  assessTrust,
  dateCheck,
  isInvestorProfileUrl,
  isSpecificUrl,
  leadConsistency,
  registrableDomain,
  roundLabelKey,
  sameRound,
  showAsFact,
  splitLeads,
} from "@/lib/verify/rules";
import type { Claim, SourceCheck, VerifyFile } from "@/lib/verify/types";

const AS_OF = "2026-11-14T05:31:21.300Z";

// Cala's own pre-seed, as recorded from Cala (FundingRound f13cba6a) and the pages checked.
const calaRound: Claim = {
  id: "ctx:cala:round:f13cba6a",
  kind: "round",
  subject: "Cala",
  investors: ["Lightspeed Venture Partners", "Kfund", "Kibo Ventures", "Masia VC"],
  leads: ["Lightspeed Venture Partners"],
  stage: "pre-seed",
  date: "2026-05-11",
  amountUsd: 7_560_000,
  amountText: "EUR 7,000,000",
  sources: [
    { name: "newsletter.dealflow.es", url: "https://newsletter.dealflow.es/p/dealflowes-513-embat-raised-30m-lightspeed", rank: "PRIMARY" },
    { name: "startup.eu", url: "https://www.startup.eu/investments/cala-7-m-pre-seed-05-2026" },
    { name: "dealroom.co", url: "https://dealroom.co/news/130391-barcelonas-cala-raises-7m-pre-seed", rank: "AGGREGATOR" },
  ],
};

const DEALFLOW_TEXT =
  "€1M to €10M: Cala, the new startup of Elisenda Bou and Issey Masuda (who formerly built Vilynx, acquired by Apple), announced a €7M pre-seed round led by Lightspeed, with participation from us at Kfund, as well as Kibo Ventures, and Masia. The startup built a verified knowledge graph that allows AI agents to query facts without scraping or parsing data. ".repeat(2);
const STARTUPEU_TEXT =
  "Spanish startup Cala has emerged from stealth with a €7 million pre-seed round led by Lightspeed Venture Partners, joining a growing wave of infrastructure startups building tools for AI agents and developer workflows. Founded in Barcelona by Elisenda Bou-Balust and Issey Masuda Mora.";
const EMBAT_ONLY =
  "Embat, the Madrid-based treasury management platform, raised €30M in Series B funding led by Cathay Innovation. Embat says it has 150 employees serving 400 clients across Europe. More from one of the founders here.";

const ok = (c: Claim, url: string, text: string) => pageCheck(c, url, { text });

describe("mention", () => {
  it("strips legal suffixes and shortens double-barrelled surnames", () => {
    expect(nameVariants("TOGL ENERGY LIMITED")).toEqual(["togl energy limited", "togl energy", "togl"]);
    expect(nameVariants("Elisenda Bou-Balust")).toContain("elisenda bou");
    expect(mentionsName("Founded by Elisenda Bou and Issey Masuda", "Elisenda Bou-Balust")).toBe(true);
  });

  it("matches whole words only, so a short name does not hit inside another word", () => {
    expect(mentionsName("The system items list", "Tem")).toBe(false);
    expect(mentionsName("Atomico backs Tem to help businesses", "Tem")).toBe(true);
  });

  it("finds an amount as press writes it, in the source currency", () => {
    expect(mentionsAmount("a €7M pre-seed round", [7_000_000])).toBe(true);
    expect(mentionsAmount("a €7 million pre-seed round", [7_000_000])).toBe(true);
    expect(mentionsAmount("raised 7,000,000 euros", [7_000_000])).toBe(true);
    expect(mentionsAmount("raised €30M in Series B", [7_000_000])).toBe(false);
    expect(mentionsAmount("raised $17M", [7_000_000])).toBe(false);
    expect(amountPatterns(2_250_000).some((re) => re.test("2.25 million"))).toBe(true);
  });
});

describe("source checks", () => {
  it("a page about another company does not mention the subject", () => {
    const chk = ok(calaRound, "https://example.com/embat-series-b", EMBAT_ONLY);
    expect(chk).toMatchObject({ status: "ok", mentionsSubject: false });
    expect(isBorderline(calaRound, chk)).toBe(true);
  });

  it("homepages and empty pages are not evidence", () => {
    expect(pageCheck(calaRound, "https://www.linkedin.com/", { text: DEALFLOW_TEXT }).status).toBe("not_specific");
    expect(pageCheck(calaRound, "https://example.com/a", undefined).status).toBe("unreachable");
    expect(isSpecificUrl("https://pitchbook.com/")).toBe(false);
    expect(isSpecificUrl("https://pitchbook.com/profiles/company/1")).toBe(true);
  });

  it("an informative title counts only when it names the company", () => {
    const named = titleCheck(calaRound, { name: "Barcelona's Cala raises €7M pre-seed to build a knowledge layer", url: "https://app.dealroom.co/" });
    expect(named).toMatchObject({ method: "title", mentionsSubject: true, mentionsAmount: true });
    expect(titleCheck(calaRound, { name: "Cala | LinkedIn", url: "https://www.linkedin.com/" })).toBeUndefined();
    expect(titleCheck(calaRound, { name: "Euro Seed 50 | Creandum and friends", url: "https://euroseed50.com/" })).toBeUndefined();
  });
});

describe("assessTrust", () => {
  it("Cala's round: investor-run newsletter plus independent press -> verified", () => {
    const checks = [
      ok(calaRound, calaRound.sources[0].url!, DEALFLOW_TEXT),
      ok(calaRound, calaRound.sources[1].url!, STARTUPEU_TEXT),
    ];
    const t = assessTrust(calaRound, checks, AS_OF);
    expect(t.level).toBe("verified");
    expect(t.checks).toMatchObject({ sourceMentionsSubject: true, corroborations: 2, sourceRank: "PRIMARY", dateSane: true, amountSane: true });
    expect(showAsFact(t)).toBe(true);
  });

  it("a cited page that does not mention the company, with nothing confirming -> conflict", () => {
    const t = assessTrust(calaRound, [ok(calaRound, "https://example.com/embat", EMBAT_ONLY)], AS_OF);
    expect(t.level).toBe("conflict");
    expect(t.reasons[0]).toMatch(/does not mention Cala/);
    expect(showAsFact(t)).toBe(false);
  });

  it("two independent press sites -> corroborated; one -> single_source", () => {
    const press: Claim = { ...calaRound, sources: [{ name: "a", url: "https://a.com/x" }, { name: "b", url: "https://b.com/y" }] };
    expect(assessTrust(press, [ok(press, "https://a.com/x", STARTUPEU_TEXT), ok(press, "https://b.com/y", DEALFLOW_TEXT)], AS_OF).level).toBe("corroborated");
    expect(assessTrust(press, [ok(press, "https://a.com/x", STARTUPEU_TEXT)], AS_OF).level).toBe("single_source");
  });

  it("two pages on one registrable domain count once", () => {
    expect(registrableDomain("https://newsletter.dealflow.es/p/1")).toBe(registrableDomain("https://dealflow.es/issue/513"));
    expect(registrableDomain("https://www.startupmag.co.uk/x")).toBe("startupmag.co.uk");
    const twin: Claim = { ...calaRound, sources: [{ name: "a", url: "https://newsletter.dealflow.es/p/1" }, { name: "b", url: "https://dealflow.es/issue/513" }] };
    const t = assessTrust(twin, [ok(twin, "https://newsletter.dealflow.es/p/1", DEALFLOW_TEXT), ok(twin, "https://dealflow.es/issue/513", DEALFLOW_TEXT)], AS_OF);
    expect(t.checks.corroborations).toBe(1);
  });

  it("a filing verifies a deal only when it names the investor (Form D never does)", () => {
    const deal: Claim = { id: "d", kind: "deal", subject: "Lovable", investors: ["20VC"], stage: "series-b-plus", date: "2025-12-11", amountUsd: 425_615_008, sources: [{ name: "sec.gov", url: "https://www.sec.gov/Archives/x/primary_doc.xml", rank: "FILING" }] };
    const formD: SourceCheck = { url: deal.sources[0].url!, method: "page", status: "ok", mentionsSubject: true, mentionsAmount: true, mentionsInvestor: false };
    expect(assessTrust(deal, [formD], AS_OF).level).toBe("single_source");
    expect(assessTrust(deal, [{ ...formD, mentionsInvestor: true }], AS_OF).level).toBe("verified");
  });

  it("an investor's profile page lists a company but never corroborates a round", () => {
    const deal: Claim = { id: "d", kind: "deal", subject: "Fractile", investors: ["Lightspeed"], stage: "series-b-plus", date: "2026-11-01", amountUsd: 720e6, sources: [{ name: "venture codex", url: "https://theventurecodex.com/funds/lightspeed-venture-partners" }, { name: "x", url: "https://cbinsights.com/investor/lightspeed" }] };
    expect(isInvestorProfileUrl(deal.sources[0].url)).toBe(true);
    const hit = (url: string): SourceCheck => ({ url, method: "page", status: "ok", mentionsSubject: true, mentionsInvestor: true });
    const t = assessTrust(deal, deal.sources.map((s) => hit(s.url!)), AS_OF);
    expect(t.level).toBe("single_source");
    expect(t.checks.corroborations).toBe(0);
    expect(t.reasons[0]).toMatch(/profile page/);
    expect(assessTrust(deal, [], AS_OF).reasons).toContain("only cites investor profile pages, not a report of this round");
  });

  it("query rows without sources, homepage-only and LinkedIn-only citations are unverified", () => {
    const base: Claim = { id: "q", kind: "deal", subject: "Acme", stage: "seed", date: "2025-01-15", sources: [], fromQuery: true };
    expect(assessTrust(base, [], AS_OF)).toMatchObject({ level: "unverified", reasons: ["Cala knowledge query row: no per-row source", "no source"] });
    expect(assessTrust({ ...base, fromQuery: false, sources: [{ name: "pitchbook.com", url: "https://pitchbook.com/" }] }, [], AS_OF).reasons).toContain("no checkable source (no URL, or only a site homepage)");
    expect(assessTrust({ ...base, fromQuery: false, sources: [{ name: "post", url: "https://www.linkedin.com/posts/abc" }] }, [], AS_OF).reasons).toContain("only LinkedIn sources (linked, never fetched)");
  });

  it("synthetic fixture data is never more than unverified", () => {
    const t = assessTrust({ ...calaRound, fixture: true }, [ok(calaRound, calaRound.sources[0].url!, DEALFLOW_TEXT)], AS_OF);
    expect(t.level).toBe("unverified");
  });

  it("date and amount problems cap the level at single_source", () => {
    const pinned: Claim = { ...calaRound, date: "2025-01-01", announcementDate: "2026-05-11" };
    const checks = [ok(pinned, pinned.sources[0].url!, DEALFLOW_TEXT), ok(pinned, pinned.sources[1].url!, STARTUPEU_TEXT)];
    const t = assessTrust(pinned, checks, AS_OF);
    expect(t.level).toBe("single_source");
    expect(t.checks.dateSane).toBe(false);
    expect(t.reasons.join(" ")).toMatch(/year-only pin; the round was announced 2026-05-11/);
  });
});

describe("date and amount sanity", () => {
  it("flags missing, future and pinned dates; allows a month pin a few days ahead", () => {
    expect(dateCheck({}, AS_OF)).toEqual(["no date"]);
    expect(dateCheck({ date: "2027-03-01" }, AS_OF)[0]).toMatch(/after the data date/);
    expect(dateCheck({ date: "2026-11-15", datePrecision: "month" }, AS_OF)).toEqual([]);
    expect(dateCheck({ date: "2024-09-05", announcementDate: "2025-06-18" }, AS_OF)[0]).toMatch(/more than 6 months before/);
  });

  it("flags stage-implausible amounts and skipped currency conversion", () => {
    expect(amountCheck({ stage: "pre-seed", amountUsd: 36_000_000 })[0]).toMatch(/outside the plausible range for pre-seed/);
    expect(amountCheck({ stage: "seed", amountUsd: 3_000_000 })).toEqual([]);
    expect(amountCheck({ stage: "seed", amountUsd: 2_000_000, amountText: "€2M" })[0]).toMatch(/not converted/);
    expect(amountCheck({ stage: "seed", amountUsd: 2_000_000, amountText: "~$2M (€2M)" })).toEqual([]);
  });
});

describe("pickRoundDate (Cala's own round)", () => {
  it("prefers the announcement over a Jan-1 year pin months earlier", () => {
    expect(pickRoundDate("2025-01-01", "2026-05-11", undefined)).toEqual({ date: "2026-05-11", precision: "day" });
  });
  it("keeps a real event date, and a day-precision Jan 1", () => {
    expect(pickRoundDate("2024-09-05", "2025-06-18")).toEqual({ date: "2024-09-05" });
    expect(pickRoundDate("2025-01-01", "2026-05-11", "day")).toEqual({ date: "2025-01-01", precision: "day" });
    expect(pickRoundDate(undefined, "2026-05-11")).toEqual({ date: "2026-05-11" });
  });
});

describe("cross-query lead consistency", () => {
  it("splits free-text lead fields without breaking parentheticals", () => {
    expect(splitLeads("Heartfelt Capital (German fund backed by Axel Springer, Porsche)")).toEqual(["Heartfelt Capital"]);
    expect(splitLeads("CubeVentures & others")).toEqual(["CubeVentures"]);
    expect(splitLeads("Insight Partners, Georgian (co-leads)")).toEqual(["Insight Partners", "Georgian"]);
    expect(splitLeads(null)).toEqual([]);
  });

  it("matches answers to the same round by date, stage and label, not by year", () => {
    expect(roundLabelKey("Series D Extension")).toBe("series-d-ext");
    expect(roundLabelKey("Series E-2")).toBe("series-e-2");
    expect(sameRound({ stage: "series-b-plus", label: "Series B", date: "2021-04-15" }, { stage: "series-b-plus", label: "Series C", date: "2021-05-01" })).toBe(false);
    expect(sameRound({ label: "Crowdfunding", date: "2017-12-15" }, { label: "Series D", date: "2017-11-15" })).toBe(false);
    expect(sameRound({ stage: "series-a", label: "Series A", date: "2017-02-13" }, { stage: "series-a", date: "2017-01-15" })).toBe(true);
  });

  it("Tractable's Series A: a second answer naming another lead -> lead conflict, round still assessed", () => {
    const tractable: Claim = { id: "round:q:t", kind: "round", subject: "Tractable", stage: "series-a", label: "Series A", date: "2017-02-13", leads: ["Entrepreneurs First"], leadFrom: "query", leadAnswers: [["Ignition Partners"]], sources: [], fromQuery: true };
    const t = assessTrust(tractable, [], AS_OF);
    expect(t.fields?.lead).toBe("conflict");
    expect(t.level).toBe("unverified");
    expect(t.reasons.join(" ")).toMatch(/lead disputed: other Cala answers name Ignition Partners/);
  });

  it("agreement corroborates the lead and lifts a sourceless row one step", () => {
    const r: Claim = { id: "round:q:w", kind: "round", subject: "Worldsensing", stage: "series-b-plus", date: "2015-07-15", leads: ["Kibo Ventures", "Mitsui & Co."], leadFrom: "query", leadAnswers: [["Kibo Ventures"]], sources: [], fromQuery: true };
    const t = assessTrust(r, [], AS_OF);
    expect(t.fields?.lead).toBe("corroborated");
    expect(t.level).toBe("single_source");
  });

  it("without another answer: FundingRound is_lead is single_source, query text unverified", () => {
    expect(leadConsistency(["Accel"], [], "graph").level).toBe("single_source");
    expect(leadConsistency(["Accel"], undefined, "query").level).toBe("unverified");
    expect(leadConsistency([], [["Accel"]], "query").level).toBeUndefined();
  });
});

describe("claims and load-time trust", () => {
  const inv = { id: "kfund", name: "Kfund", calaId: "x", deals: [] } as unknown as Investor;

  it("deal claims have stable ids and carry the investor; query rows are flagged", () => {
    const d = { company: "Cala", round: "pre-seed" as const, date: "2026-05-11", sector: "other" as const, sources: [{ name: "Cala knowledge query" }] };
    expect(dealClaimId("kfund", d)).toBe("deal:kfund:cala:pre-seed:2026-05-11");
    expect(dealClaim(inv, d)).toMatchObject({ subject: "Cala", investors: ["Kfund"], fromQuery: true, sources: [] });
    expect(dealClaim(inv, { ...d, roundId: "r1", isLead: true })).toMatchObject({ leads: ["Kfund"], leadFrom: "graph" });
  });

  it("cohort rounds from the fixture are marked fixture; unresolved companies get a warning", () => {
    const cohort = {
      version: 1,
      asOf: "2026-11-14",
      companies: {
        "fx-co-cala": { id: "fx-co-cala", name: "Cala (fixture)", sector: "other", status: "active", roundIds: ["r"], sources: [{ name: "Synthetic fixture (not real data)" }] },
        "name:acme": { id: "name:acme", name: "Acme", sector: "other", status: "active", roundIds: ["q"], sources: [] },
      },
      rounds: {
        r: { id: "r", companyId: "fx-co-cala", stage: "seed", label: "Seed", date: "2025-11-01", participants: [], sources: [{ name: "Synthetic fixture (not real data)" }] },
        q: { id: "q:1", companyId: "name:acme", stage: "seed", label: "Seed", date: "2025-11-01", participants: [], sources: [] },
      },
      investors: {},
    } as unknown as Cohort;
    expect(cohortRoundClaim(cohort, cohort.rounds.r)).toMatchObject({ subject: "Cala", fixture: true });
    expect(cohortRoundClaim(cohort, cohort.rounds.q)).toMatchObject({ fromQuery: true, entityWarnings: ["company not resolved to a Cala entity (name only)"] });
    expect(entityWarning("UK-based transportation and logistics company founded in 2018", "investor")).toMatch(/transportation and logistics/);
    expect(entityWarning("All-in-one hotel management platform for independent hoteliers", "company")).toBeUndefined();
  });

  it("the demo company file shows only verified/corroborated facts and lists the rest", () => {
    const doc: ContextDoc = {
      id: "2bdea5e8",
      calaIds: ["2bdea5e8"],
      company: { name: "Cala" },
      founders: [{ name: "Issey Masuda Mora" }],
      investors: [
        { name: "Lightspeed Venture Partners", round: "Pre-Seed", lead: true },
        { name: "Creandum Kommanditbolag", source: { name: "Bilbostack", url: "https://bilbostack.com/" } },
      ],
      rounds: [],
      claims: [],
      coverage: { cala: true, website: false, founder: false },
      updatedAt: AS_OF,
    };
    const ids = contextDocClaims(doc).map((c) => c.id);
    expect(ids).toEqual(["ctx:cala:investor:lightspeed", "ctx:cala:investor:creandumkommanditbolag", "ctx:cala:founder:isseymasudamora"]);
    const verified = { level: "verified" as const, reasons: ["checked"], checks: { corroborations: 3, dateSane: true, amountSane: true } };
    const file: VerifyFile = { version: 1, generatedAt: AS_OF, asOf: AS_OF, summary: {}, evidence: {}, trust: { [ctxInvestorId("Cala", "Lightspeed Venture Partners")]: verified } };
    const out = contextTrust(doc, file);
    expect(out.facts.investors.map((i) => i.name)).toEqual(["Lightspeed Venture Partners"]);
    expect(out.unconfirmed.map((u) => [u.text, u.level])).toEqual([
      ["Investor: Creandum Kommanditbolag", "unverified"],
      ["Founder: Issey Masuda Mora", "unverified"],
    ]);
  });
});
