import { describe, expect, it } from "vitest";
import { pickCandidate } from "@/lib/context/calaFacts";
import type { CompanyCandidate } from "@/lib/context/types";

const cand = (calaId: string, name: string, extra: Partial<CompanyCandidate> = {}): CompanyCandidate =>
  ({ calaId, name, confidence: "name", score: 0.4, ...extra }) as CompanyCandidate;

describe("pickCandidate by name", () => {
  const cands = [cand("a", "Cala"), cand("b", "Cala AI"), cand("c", "CALA CALA LIMITED")];

  it("picks the one exact-name candidate whose funding history we hold", () => {
    expect(pickCandidate(cands, { name: "Cala", fundedIds: new Set(["a"]) })).toBe("a");
  });

  it("counts a sibling entity's rounds as the candidate's", () => {
    const withSibling = [cand("a", "Cala", { siblingIds: ["x"] }), cand("c", "CALA CALA LIMITED")];
    expect(pickCandidate(withSibling, { name: "Cala", fundedIds: new Set(["x"]) })).toBe("a");
  });

  it("does not guess when no exact-name candidate is funded, or several are", () => {
    expect(pickCandidate(cands, { name: "Cala", fundedIds: new Set(["c"]) })).toBeUndefined();
    const twin = [cand("a", "Cala"), cand("d", "Cala")];
    expect(pickCandidate(twin, { name: "Cala", fundedIds: new Set(["a", "d"]) })).toBeUndefined();
  });
});
