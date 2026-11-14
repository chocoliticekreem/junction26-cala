// Founder analysis: one strict Haiku tool call reads a pitch (or a pitch chunk) for meaning and
// returns the broad sector, the precise domain as free-text tags, and the founder facts. The
// keyword parser (lib/fallbackExtract.ts) answers only when the call cannot be made or fails, and
// the result says so (analysis: "keyword_fallback") so the UI can tell the founder.
// Server-only: the default caller reads ANTHROPIC_API_KEY.
import { getAnthropic, haikuTool } from "@/lib/anthropic";
import { EXTRACTION_TOOL, parseExtraction } from "@/lib/extractSchema";
import { fallbackExtract } from "@/lib/fallbackExtract";
import { ALL_SECTORS, SECTORS, STAGES, isSector, type Sector, type Stage } from "@/lib/taxonomy";
import type { Extraction, Traction } from "@/lib/types";
import { cleanTags, strictSchema, type Analysis, type ToolCaller } from "./strict";

export type FounderAnalysis = {
  sector: Sector;
  sectorWeights: Partial<Record<Sector, number>>;
  tags: string[];
  stage?: Stage;
  raiseUsd?: number;
  traction?: Traction;
  teamSignals: string[];
  businessModel?: string;
  geography?: string;
  company?: string;
  oneLiner?: string;
  confidence: Record<string, number>;
};

export type FounderResult = {
  founder: FounderAnalysis;
  extraction: Extraction;
  analysis: Analysis;
  // Why the keyword fallback answered: no_api_key, e2e_mock, empty, llm_error, invalid_output.
  fallbackReason?: string;
};

const TRIGGER_KEYS = ["sectors", "stage", "raise_amount", "traction", "team_signals", "geography", "business_model"];

const baseSchema = EXTRACTION_TOOL.input_schema as { properties: Record<string, unknown> };

// Haiku skips optional fields it was not pushed to consider, so every field is required and the
// optional ones accept null ("not stated"); parseExtraction reads null as absent.
function requireAllNullable(schema: { properties: Record<string, unknown>; required: string[] }) {
  const req = new Set(schema.required);
  return {
    ...schema,
    properties: Object.fromEntries(
      Object.entries(schema.properties).map(([k, v]) => [k, req.has(k) ? v : { anyOf: [v, { type: "null" }] }]),
    ),
    required: Object.keys(schema.properties),
  };
}

export const FOUNDER_TOOL = {
  name: "record_founder_analysis",
  description:
    "Record what the founder's startup is: the nearest broad sector from the fixed list, the precise domain as short tags, and every stated fact with a confidence from 0 to 1 (null when not stated).",
  input_schema: requireAllNullable(strictSchema(
    {
      type: "object",
      properties: {
        primary_sector: {
          type: "string",
          enum: [...ALL_SECTORS],
          description: "The single nearest broad sector. Use other only when nothing on the list is close.",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description:
            "2 to 6 short, specific domain tags in the founder's field, e.g. EEG, consumer neurotech, wearables. Not the sector name itself.",
        },
        ...baseSchema.properties,
      },
      required: ["primary_sector", "tags", "sectors"],
    },
    TRIGGER_KEYS,
  ) as { properties: Record<string, unknown>; required: string[] }) as object,
};

export const FOUNDER_SYSTEM = `You read a startup founder's pitch, often a live speech-to-text transcript, and say what the company is.
Interpret meaning, not keywords. Transcripts contain misspellings ("crisper"=CRISPR, "fin tech"=fintech, "sass"=SaaS, "e e g"=EEG): read for meaning.
Broad sectors (use these labels only): ${SECTORS.join("; ")}; else "other".
Map a niche domain to the nearest broad sector by what the product is and who pays, and keep the precise domain in tags:
- an EEG headband for focus or sleep sold to consumers -> primary_sector "medtech/devices" if clinical, "deep tech/hardware" if a consumer device; tags ["EEG","neurotech","wearable"]
- a defence drone -> "deep tech/hardware", tags ["defence","drones","autonomy"]
- an AI agent for law firms -> "applied AI/vertical SaaS", tags ["legal","AI agents"]
- a knowledge graph of companies, people and funding rounds sold to AI agents through an API -> "AI infrastructure", sectors also "developer tools"; tags ["knowledge graph","company data","AI agents","API"]
- an observability and evaluation SDK for teams building LLM apps -> "developer tools", sectors also "AI infrastructure"; tags ["LLM observability","evals","SDK"]
AI infrastructure vs applied AI: a company that sells data, APIs, models, compute, infrastructure or tooling to AI agents or developers is "AI infrastructure" (or "developer tools"), even when its data is about one industry. "applied AI/vertical SaaS" is AI applied to one industry's own work and sold to that industry (legal AI, healthcare AI, insurance claims AI).
List every plausible sector in sectors with a confidence; primary_sector must be the strongest.
Stages: ${STAGES.join(", ")}. Raise amounts in USD (GBP x1.27, EUR x1.08).
Fill company, one_liner and founder_name only when the founder states them; never guess. one_liner is at most 80 characters.
Always fill every other field the pitch states or clearly implies: stage ("pre-seed", "raising a seed round" = seed), raise_amount, traction (revenue, users, waitlist, growth), team_signals, business_model (who pays and how).
geography only when the founder names where the company is based; never infer it from context or from where the pitch is being given.
Never invent traction, team or money the founder did not say.`;

function normaliseWeights(sectors: Extraction["sectors"]): Partial<Record<Sector, number>> {
  const total = sectors.reduce((a, s) => a + s.confidence, 0);
  if (!total) return {};
  return Object.fromEntries(sectors.map((s) => [s.label, Math.round((s.confidence / total) * 1000) / 1000]));
}

export function founderFromExtraction(e: Extraction, tags: string[], primary?: Sector): FounderAnalysis {
  const sectors = [...e.sectors].sort((a, b) => b.confidence - a.confidence);
  if (primary && primary !== "other" && !sectors.some((s) => s.label === primary)) {
    sectors.unshift({ label: primary, confidence: Math.max(0.5, sectors[0]?.confidence ?? 0) });
  }
  const weights = normaliseWeights(sectors);
  const top = sectors[0]?.label;
  const sector: Sector = primary && (primary !== "other" || !top) ? primary : (top ?? "other");
  const confidence: Record<string, number> = {};
  if (sectors.length) confidence.sectors = Math.max(...sectors.map((s) => s.confidence));
  if (tags.length) confidence.tags = confidence.sectors ?? 0.5;
  const out: FounderAnalysis = { sector, sectorWeights: weights, tags, teamSignals: [], confidence };
  if (e.stage) [out.stage, confidence.stage] = [e.stage.value, e.stage.confidence];
  if (e.raise_amount) [out.raiseUsd, confidence.raise] = [e.raise_amount.value, e.raise_amount.confidence];
  if (e.traction) {
    const { confidence: c, ...t } = e.traction;
    out.traction = t;
    confidence.traction = c;
  }
  if (e.team_signals?.length) {
    out.teamSignals = e.team_signals.map((t) => t.value);
    confidence.teamSignals = Math.max(...e.team_signals.map((t) => t.confidence));
  }
  if (e.business_model) [out.businessModel, confidence.businessModel] = [e.business_model.value, e.business_model.confidence];
  if (e.geography) [out.geography, confidence.geography] = [e.geography.value, e.geography.confidence];
  if (e.company) [out.company, confidence.company] = [e.company.value, e.company.confidence];
  if (e.one_liner) [out.oneLiner, confidence.oneLiner] = [e.one_liner.value, e.one_liner.confidence];
  return out;
}

export function parseFounder(input: unknown): { founder: FounderAnalysis; extraction: Extraction } | null {
  const extraction = parseExtraction(input);
  if (!extraction) return null;
  const raw = input as Record<string, unknown>;
  const primary = typeof raw.primary_sector === "string" && isSector(raw.primary_sector) ? raw.primary_sector : undefined;
  const tags = cleanTags(raw.tags);
  if (!primary && !extraction.sectors.length && !tags.length) return null;
  if (tags.length) extraction.tags = tags;
  if (primary && primary !== "other" && !extraction.sectors.some((s) => s.label === primary)) {
    extraction.sectors.unshift({ label: primary, confidence: 0.5 });
  }
  return { founder: founderFromExtraction(extraction, tags, primary), extraction };
}

function keywordResult(text: string, reason: string): FounderResult {
  const extraction = fallbackExtract(text);
  const tags = cleanTags(Object.entries(extraction.triggers ?? {}).filter(([k]) => k !== "sectors" && isSector(k)).map(([, v]) => v));
  if (reason !== "empty") console.warn(`analyzeFounder: keyword fallback (${reason})`);
  return { founder: founderFromExtraction(extraction, tags), extraction, analysis: "keyword_fallback", fallbackReason: reason };
}

export function aiUnavailableReason(): string | undefined {
  if (process.env.E2E_MOCK === "1") return "e2e_mock";
  if (!getAnthropic()) return "no_api_key";
  return undefined;
}

export async function analyzeFounder(
  text: string,
  opts: { context?: string; call?: ToolCaller; timeoutMs?: number; maxRetries?: number } = {},
): Promise<FounderResult> {
  const t = (text ?? "").slice(-4000);
  if (!t.trim()) return keywordResult("", "empty");
  if (!opts.call) {
    const why = aiUnavailableReason();
    if (why) return keywordResult(t, why);
  }
  const call = opts.call ?? haikuTool;
  try {
    const input = await call({
      system: FOUNDER_SYSTEM,
      user: `${opts.context ? `${opts.context}\n` : ""}Pitch: """${t}"""`,
      tool: FOUNDER_TOOL,
      maxTokens: 450,
      strict: true,
      timeoutMs: opts.timeoutMs ?? 15000,
      maxRetries: opts.maxRetries ?? 1,
    });
    const parsed = parseFounder(input);
    if (parsed) {
      // Currency conversion is deterministic in the keyword parser; the model's arithmetic is not.
      const kw = fallbackExtract(t).raise_amount;
      if (kw && parsed.founder.raiseUsd !== undefined) parsed.founder.raiseUsd = kw.value;
      return { ...parsed, analysis: "ai" };
    }
    return keywordResult(t, "invalid_output");
  } catch (e) {
    console.warn("analyzeFounder: Haiku failed:", e instanceof Error ? e.message : e);
    return keywordResult(t, "llm_error");
  }
}
