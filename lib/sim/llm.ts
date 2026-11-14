// Server-only Haiku helpers for /api/simulate: vision parsing and grounded branch narration.
// Both return null on any failure; callers fall back (keyword parser / no narrative).
import { haikuTool } from "@/lib/anthropic";
import { ALL_SECTORS, STAGES, isSector, isStage } from "@/lib/taxonomy";
import type { DecisionNode, SimModel, Vision } from "./types";
import { fmtUsd } from "./util";

const VISION_TOOL = {
  name: "record_vision",
  description: "Record the founder's 5-year vision as structured targets.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["targetStage", "horizonYears", "targetValuationUsd", "targetHeadcount", "targetFundingUsd", "sector"],
    properties: {
      targetStage: { type: "string", enum: [...STAGES], description: "Funding stage the vision implies; IPO/unicorn/growth = series-b-plus." },
      horizonYears: { type: "integer", description: "Years until the vision; 5 when unstated." },
      targetValuationUsd: { type: ["number", "null"], description: "USD valuation target. unicorn / billion-dollar = 1000000000. null if none." },
      targetHeadcount: { type: ["integer", "null"], description: "Employees, if stated." },
      targetFundingUsd: { type: ["number", "null"], description: "Total funding raised, if stated, USD." },
      sector: { type: "string", enum: [...ALL_SECTORS], description: "Sector of the company; other if unclear." },
    },
  },
};

export async function parseVisionLlm(text: string, fallback: Vision): Promise<Vision | null> {
  try {
    const out = (await haikuTool({
      system:
        "Extract a startup founder's 5-year vision into targets. Stages: pre-idea, pre-seed, seed, series-a, series-b-plus (B and later, IPO, unicorn). " +
        "Money in USD (GBP x1.27, EUR x1.08). Never invent targets the founder did not state or clearly imply.",
      user: `Vision: """${text.slice(0, 1500)}"""`,
      tool: VISION_TOOL,
      maxTokens: 200,
      strict: true,
      timeoutMs: 4000,
      maxRetries: 0,
    })) as Record<string, unknown> | null;
    if (!out || typeof out.targetStage !== "string" || !isStage(out.targetStage)) return null;
    const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x > 0 ? x : undefined);
    const v: Vision = {
      text,
      targetStage: out.targetStage,
      horizonYears: Math.min(10, Math.max(1, Math.round(num(out.horizonYears) ?? fallback.horizonYears))),
      targetValuationUsd: num(out.targetValuationUsd) ?? fallback.targetValuationUsd,
      targetHeadcount: num(out.targetHeadcount) ?? fallback.targetHeadcount,
      targetFundingUsd: num(out.targetFundingUsd) ?? fallback.targetFundingUsd,
      sector: typeof out.sector === "string" && isSector(out.sector) && out.sector !== "other" ? out.sector : fallback.sector,
    };
    if (v.targetValuationUsd) v.targetStage = "series-b-plus";
    return v;
  } catch (e) {
    console.warn("simulate: vision LLM failed, using keywords:", e instanceof Error ? e.message : e);
    return null;
  }
}

const NARRATE_TOOL = {
  name: "record_explanation",
  description: "One short line per branch explaining its numbers.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["lines"],
    properties: { lines: { type: "array", items: { type: "string" } } },
  },
};

// The facts Haiku may use: branch counts/rates and, for lead branches, that investor's real stats.
export function branchFacts(nodes: DecisionNode[], model: SimModel) {
  return nodes.slice(0, 3).map((n) => {
    const leadId = n.decision?.kind === "lead" ? n.decision.investorId : undefined;
    const a = leadId ? model.agents[model.agentIndex[leadId]] : undefined;
    return {
      branch: n.label,
      simulatedRuns: n.runs,
      reachVisionShare: n.reachVisionShare,
      medianMonthsToNextRound: n.medianMonthsToNextRound ?? null,
      realTransitionsBehindBranch: n.sampleSize,
      lowConfidence: n.lowConfidence,
      investor: a
        ? {
            name: a.name,
            roundsInCohort: a.rounds,
            roundsLed: a.led,
            companiesObservedAfterItsRound: a.followOn.observed,
            raisedNextWithin24Months: a.followOn.raisedWithin24m,
            medianMonthsToNextRound: a.followOn.medianMonthsToNext ?? null,
            reinvestsInNextRoundShare: Math.round(a.followOn.reUpRate * 100) / 100,
            typicalCheque: a.chequeMedian ? fmtUsd(a.chequeMedian) : null,
          }
        : null,
    };
  });
}

export async function narrate(nodes: DecisionNode[], model: SimModel): Promise<string[] | null> {
  const facts = branchFacts(nodes, model);
  if (!facts.length) return null;
  try {
    const out = (await haikuTool({
      system:
        "You explain a Monte Carlo of startup funding paths built from past funding rounds. Write one line (max 25 words) per branch, in order. " +
        "Use ONLY numbers present in the JSON. Never add facts, names or numbers that are not in it. Past rounds are evidence, not a forecast. " +
        "If lowConfidence is true, say the sample is small.",
      user: JSON.stringify(facts),
      tool: NARRATE_TOOL,
      maxTokens: 300,
      strict: true,
      timeoutMs: 4000,
      maxRetries: 0,
    })) as { lines?: unknown } | null;
    const lines = Array.isArray(out?.lines) ? out.lines.filter((l): l is string => typeof l === "string").slice(0, 3) : [];
    return lines.length ? lines : null;
  } catch (e) {
    console.warn("simulate: narrative LLM failed, skipping:", e instanceof Error ? e.message : e);
    return null;
  }
}
