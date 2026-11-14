// Server-only Haiku helper for /api/simulate: grounded branch narration. Returns null on any
// failure (the route then reports narrative: "none"). Vision parsing lives in lib/ai/analyzeVision.ts.
import { haikuTool } from "@/lib/anthropic";
import type { DecisionNode, SimModel } from "./types";
import { fmtUsd } from "./util";

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
