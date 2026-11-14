// Vision analysis: Haiku reads the founder's vision ("a unicorn in 5 years", "IPO", "profitable
// and bootstrapped") into targets plus one human line saying how it was read. Startup terms with a
// fixed meaning are enforced after the call (GLOSSARY), so "unicorn" is always $1B whatever the
// model returns. The keyword parser (parseVision) answers only when the call fails, flagged as
// analysis: "keyword_fallback".
import { haikuTool } from "@/lib/anthropic";
import { interpretVision, parseVision, UNICORN_USD } from "@/lib/sim/vision";
import type { Vision } from "@/lib/sim/types";
import { ALL_SECTORS, STAGES, isSector, isStage } from "@/lib/taxonomy";
import { aiUnavailableReason } from "./analyzeFounder";
import type { Analysis, ToolCaller } from "./strict";

export type VisionResult = { vision: Vision; analysis: Analysis; fallbackReason?: string };

const nullable = (type: string, description: string) => ({ type: [type, "null"], description });

export const VISION_TOOL = {
  name: "record_vision",
  description: "Record the founder's vision as structured targets and one plain line saying how it was read.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "targetStage",
      "horizonYears",
      "targetValuationUsd",
      "targetHeadcount",
      "targetRevenueUsd",
      "targetFundingUsd",
      "goesPublic",
      "profitable",
      "sector",
      "interpretation",
    ],
    properties: {
      targetStage: { type: "string", enum: [...STAGES], description: "Funding stage the vision implies. IPO, unicorn, growth = series-b-plus." },
      horizonYears: { type: "integer", description: "Years until the vision; 5 when unstated." },
      targetValuationUsd: nullable("number", "USD valuation. unicorn = 1000000000, decacorn = 10000000000. null if none."),
      targetHeadcount: nullable("integer", "Employees, if stated."),
      targetRevenueUsd: nullable("number", "Annual revenue or ARR target in USD, if stated."),
      targetFundingUsd: nullable("number", "Total funding raised, if stated, USD."),
      goesPublic: { type: "boolean", description: "True for IPO, listing, going public." },
      profitable: { type: "boolean", description: "True for profitable, bootstrapped, self-funded, default alive." },
      sector: { type: "string", enum: [...ALL_SECTORS], description: "Sector of the company; other if unclear." },
      interpretation: {
        type: "string",
        description: 'At most 14 words, e.g. "Unicorn = valuation of $1B or more, within 5 years". Define any startup term used.',
      },
    },
  },
};

const SYSTEM =
  "You read a startup founder's vision and turn it into concrete targets a funding simulator can check. " +
  "Interpret startup language: unicorn = a $1B+ valuation; decacorn = $10B+; IPO / going public = Series B+ then a listing; " +
  "profitable / bootstrapped = revenue covers costs, outside funding optional. " +
  "Stages: pre-idea, pre-seed, seed, series-a, series-b-plus (B and later). Money in USD (GBP x1.27, EUR x1.08). " +
  "A year like 2029 means horizonYears = that year minus the current year. " +
  "Tolerate speech-to-text misspellings. Never invent targets the founder did not state or clearly imply.";

// Fixed meanings, applied after the model so a definitional term can never drift.
function applyGlossary(v: Vision): Vision {
  if (/\bdecacorns?\b/i.test(v.text)) v.targetValuationUsd = 10 * UNICORN_USD;
  else if (/\bunicorns?\b/i.test(v.text)) v.targetValuationUsd = Math.max(v.targetValuationUsd ?? 0, UNICORN_USD);
  if (/\b(?:ipo|go(?:ing)? public|public listing)\b/i.test(v.text)) v.goesPublic = true;
  if (v.targetValuationUsd || v.goesPublic) v.targetStage = "series-b-plus";
  return v;
}

const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x > 0 ? x : undefined);

export function parseVisionTool(out: unknown, text: string): Vision | null {
  if (!out || typeof out !== "object") return null;
  const o = out as Record<string, unknown>;
  if (typeof o.targetStage !== "string" || !isStage(o.targetStage)) return null;
  const v: Vision = {
    text,
    targetStage: o.targetStage,
    horizonYears: Math.min(10, Math.max(1, Math.round(num(o.horizonYears) ?? 5))),
  };
  const set = <K extends keyof Vision>(k: K, x: Vision[K] | undefined) => {
    if (x !== undefined) v[k] = x;
  };
  set("targetValuationUsd", num(o.targetValuationUsd));
  set("targetHeadcount", num(o.targetHeadcount) && Math.round(num(o.targetHeadcount)!));
  set("targetRevenueUsd", num(o.targetRevenueUsd));
  set("targetFundingUsd", num(o.targetFundingUsd));
  if (o.goesPublic === true) v.goesPublic = true;
  if (o.profitable === true) v.profitable = true;
  if (typeof o.sector === "string" && isSector(o.sector) && o.sector !== "other") v.sector = o.sector;
  applyGlossary(v);
  const line = typeof o.interpretation === "string" ? o.interpretation.trim().slice(0, 160) : "";
  // A glossary override makes the model's own line stale, so the deterministic one is used then.
  const glossaryChanged = v.targetValuationUsd !== num(o.targetValuationUsd);
  v.interpretation = line && !glossaryChanged ? line : interpretVision(v);
  return v;
}

function fallback(text: string, reason: string): VisionResult {
  if (reason !== "empty") console.warn(`analyzeVision: keyword fallback (${reason})`);
  return { vision: applyGlossary(parseVision(text)), analysis: "keyword_fallback", fallbackReason: reason };
}

export async function analyzeVision(text: string, opts: { call?: ToolCaller; timeoutMs?: number } = {}): Promise<VisionResult> {
  const t = (text ?? "").slice(0, 1500);
  if (!t.trim()) return fallback("", "empty");
  if (!opts.call) {
    const why = aiUnavailableReason();
    if (why) return fallback(t, why);
  }
  const call = opts.call ?? haikuTool;
  try {
    const out = await call({
      system: SYSTEM,
      user: `Today is ${new Date().toISOString().slice(0, 10)}. Vision: """${t}"""`,
      tool: VISION_TOOL,
      maxTokens: 300,
      strict: true,
      timeoutMs: opts.timeoutMs ?? 6000,
      maxRetries: 1,
    });
    const v = parseVisionTool(out, t);
    return v ? { vision: v, analysis: "ai" } : fallback(t, "invalid_output");
  } catch (e) {
    console.warn("analyzeVision: Haiku failed:", e instanceof Error ? e.message : e);
    return fallback(t, "llm_error");
  }
}
