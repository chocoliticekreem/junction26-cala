import { describe, expect, it } from "vitest";
import { SECTOR_SHRINK_K, fitModel } from "@/lib/sim/fit";
import { makeCohort } from "./simHelpers";

const base = () =>
  makeCohort(
    "2024-06-01",
    [
      { id: "a", rounds: [{ stage: "pre-seed", date: "2020-01-01", lead: "x", others: ["ang"], amount: 1e6 }, { stage: "seed", date: "2021-01-01", lead: "y", others: ["ang"], amount: 3e6 }] },
      { id: "b", rounds: [{ stage: "pre-seed", date: "2020-06-01", lead: "x" }] },
      { id: "c", rounds: [{ stage: "pre-seed", date: "2023-12-01", lead: "z" }] },
    ],
    { ang: "angel" },
  );

describe("fitModel", () => {
  it("counts raised, stalled and censored transitions with Laplace smoothing", () => {
    const m = fitModel(base());
    const ps = m.byStage["pre-seed"]!;
    expect(ps).toMatchObject({ n: 2, raised: 1, stalled: 1 });
    expect(ps.pRaise).toBeCloseTo((1 + 1) / (2 + 2));
    expect(ps.months[0]).toBeCloseTo(12, 0);
    expect(m.transitions.find((t) => t.companyId === "c")?.outcome).toBe("censored");
  });

  it("builds investor agents: stage/sector mix, leads, follow-on, ties and re-ups", () => {
    const m = fitModel(base());
    const x = m.agents[m.agentIndex.x];
    expect(x).toMatchObject({ rounds: 2, led: 2, kind: "fund" });
    expect(x.stageDist["pre-seed"]).toBeCloseTo(1);
    expect(x.followOn).toMatchObject({ observed: 2, raisedWithin24m: 1 });
    expect(x.followOn.pNextWithin24m).toBeCloseTo(0.5);
    expect(x.followOn.medianStepUp).toBeCloseTo(3);
    expect(m.ties.x.y).toBe(1);
    expect(m.ties.ang.y).toBe(0.5);
    const ang = m.agents[m.agentIndex.ang];
    expect(ang.followOn.reUpRate).toBe(1);
    expect(ang.coInvestors).toMatchObject({ x: 1, y: 1 });
    expect(m.agents[m.agentIndex.y].leadStageCounts.seed).toBe(1);
  });

  it("infers the lead as the most institutional participant when Cala has no is_lead", () => {
    const c = makeCohort("2024-06-01", [{ id: "a", rounds: [{ stage: "seed", date: "2020-01-01", lead: "ang", others: ["f"], noLeadFlag: true }] }], { ang: "angel" });
    const m = fitModel(c);
    expect(m.transitions[0].leadId).toBe("f");
  });

  it("shrinks a sector's raise rate toward its stage (backoff)", () => {
    const c = makeCohort("2024-06-01", [
      { id: "a", sector: "fintech", rounds: [{ stage: "seed", date: "2018-01-01", lead: "x" }, { stage: "series-a", date: "2019-06-01", lead: "y" }] },
      { id: "b", sector: "fintech", rounds: [{ stage: "seed", date: "2018-01-01", lead: "x" }, { stage: "series-a", date: "2019-06-01", lead: "y" }] },
      { id: "c", sector: "healthtech", rounds: [{ stage: "seed", date: "2018-01-01", lead: "x" }] },
      { id: "d", sector: "healthtech", rounds: [{ stage: "seed", date: "2018-01-01", lead: "x" }] },
    ]);
    const m = fitModel(c);
    const pStage = m.byStage.seed!.pRaise;
    expect(pStage).toBeCloseTo((2 + 1) / (4 + 2));
    expect(m.bySectorStage["fintech|seed"].pRaise).toBeCloseTo((2 + SECTOR_SHRINK_K * pStage) / (2 + SECTOR_SHRINK_K));
    expect(m.bySectorStage["healthtech|seed"].pRaise).toBeCloseTo((0 + SECTOR_SHRINK_K * pStage) / (2 + SECTOR_SHRINK_K));
    expect(m.bySectorStage["fintech|seed"].pRaise).toBeGreaterThan(pStage);
    expect(m.bySectorStage["climate/energy|seed"]).toBeUndefined();
    // Investor x led two raisers and two stallers: lift stays near 1, shrunk toward its kind.
    expect(m.agents[m.agentIndex.x].raiseLift).toBeGreaterThan(0.8);
    expect(m.agents[m.agentIndex.x].raiseLift).toBeLessThan(1.2);
  });

  it("survivorship: closed companies stall even when recent, but only when status can be trusted", () => {
    const c = makeCohort("2024-06-01", [{ id: "a", status: "closed", rounds: [{ stage: "seed", date: "2024-01-01", lead: "x" }] }]);
    expect(fitModel(c).transitions[0].outcome).toBe("stalled");
    const c2 = makeCohort("2024-06-01", [{ id: "a", status: "closed", rounds: [{ stage: "seed", date: "2021-01-01", lead: "x" }, { stage: "series-a", date: "2023-01-01", lead: "y" }] }]);
    // In a backtest at 2022, the company's present-day "closed" status must not leak in.
    expect(fitModel(c2, "2022-06-01").transitions[0].outcome).toBe("censored");
  });

  it("asOf: never uses rounds on or after asOf", () => {
    const m = fitModel(base(), "2020-12-31");
    expect(m.agentIndex.y).toBeUndefined();
    expect(m.transitions.every((t) => t.outcome !== "raised")).toBe(true);
    const mutated = base();
    mutated.rounds["a-r1"].participants[0].investorId = "someone-else";
    mutated.rounds["a-r1"].amountUsd = 99e6;
    const a = fitModel(base(), "2020-12-31");
    const b = fitModel(mutated, "2020-12-31");
    expect(JSON.stringify({ t: b.transitions, s: b.byStage, ag: b.agents })).toBe(JSON.stringify({ t: a.transitions, s: a.byStage, ag: a.agents }));
  });

  it("treats every Series B+ round as its own step so B+ follow-ons are transitions", () => {
    const c = makeCohort("2024-06-01", [
      { id: "a", rounds: [{ stage: "series-b-plus", date: "2019-01-01", lead: "x" }, { stage: "series-b-plus", date: "2020-06-01", lead: "y" }] },
    ]);
    const m = fitModel(c);
    expect(m.byStage["series-b-plus"]).toMatchObject({ n: 2, raised: 1, stalled: 1 });
  });
});
