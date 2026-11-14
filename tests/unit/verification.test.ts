import { describe, expect, it } from "vitest";
import { verifyFounder, verifyInvestor } from "@/lib/verification";
import { founder, investor } from "./helpers";

const inv = investor("acme", []); // partner "Zoë Brontë-Smith", website https://acme.example

describe("verifyInvestor", () => {
  it("passes on a case/diacritic-insensitive partner match and fund-domain email", () => {
    const v = verifyInvestor({ name: "  zoe bronte smith ", email: "zoe@acme.example" }, inv);
    expect(v.subjectId).toBe("acme");
    expect(v.side).toBe("investor");
    expect(v.checks.map((c) => c.passed)).toEqual([true, true]);
  });

  it("fails on an unknown name or a different domain", () => {
    const v = verifyInvestor({ name: "Someone Else", email: "zoe@gmail.com" }, inv);
    expect(v.checks.map((c) => c.passed)).toEqual([false, false]);
    expect(verifyInvestor({ name: "Zoe Bronte-Smith", email: "not-an-email" }, inv).checks[1].passed).toBe(false);
  });

  it("accepts subdomains and checks format only when the fund has no website", () => {
    expect(verifyInvestor({ name: "x", email: "z@mail.acme.example" }, inv).checks[1].passed).toBe(true);
    const noSite = { ...inv, website: undefined };
    expect(verifyInvestor({ name: "x", email: "z@fund.co.uk" }, noSite).checks[1].passed).toBe(true);
    expect(verifyInvestor({ name: "x", email: "z@gmail.com" }, noSite).checks[1].passed).toBe(false);
  });
});

describe("verifyFounder", () => {
  it("passes with a website and a company email", () => {
    const v = verifyFounder(founder({ website: "https://helixa.bio", email: "ana@helixa.bio" }));
    expect(v).toMatchObject({ subjectId: "f1", side: "founder" });
    expect(v.checks.every((c) => c.passed)).toBe(true);
  });

  it("accepts a LinkedIn URL and rejects personal mailboxes", () => {
    const v = verifyFounder(founder({ website: "https://www.linkedin.com/in/ana", email: "ana@gmail.com" }));
    expect(v.checks.map((c) => c.passed)).toEqual([true, false]);
  });

  it("fails when nothing is provided, and adds the Cala check only when found", () => {
    const v = verifyFounder(founder());
    expect(v.checks.map((c) => c.passed)).toEqual([false, false]);
    const found = verifyFounder(founder({ website: "https://a.io", email: "a@a.io" }), { calaFound: true });
    expect(found.checks).toHaveLength(3);
    expect(found.checks[2]).toMatchObject({ name: "Found on Cala", passed: true });
  });
});
