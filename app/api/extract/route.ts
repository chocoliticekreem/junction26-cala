import { getAnthropic, haikuTool } from "@/lib/anthropic";
import { EXTRACTION_TOOL, parseExtraction } from "@/lib/extractSchema";
import { fallbackExtract } from "@/lib/fallbackExtract";
import { SECTORS, STAGES } from "@/lib/taxonomy";
import type { Extraction, FounderProfile } from "@/lib/types";

const MAX_CHUNK = 2000;

const SYSTEM = `You extract startup features from a live, speech-to-text pitch transcript.
Sectors (use these labels only, else "other"): ${SECTORS.join("; ")}.
Stages: ${STAGES.join(", ")}.
Transcripts contain misspellings ("crisper"=CRISPR, "fin tech"=fintech, "sass"=SaaS): read for meaning.
Only report what the newest chunk says or clearly implies; the running profile is context, do not repeat it.
Raise amounts in USD (GBP x1.27, EUR x1.08). Be terse.
Fill company, one_liner and founder_name only when the founder states them; never guess. one_liner is what the startup does in the founder's own words, at most 80 characters.`;

const TRIGGER_KEYS = ["sectors", "stage", "raise_amount", "traction", "team_signals", "geography", "business_model"];

// Strict tool use needs every object closed. EXTRACTION_TOOL's free-form `triggers` map becomes
// a fixed-key object; parseExtraction reads both shapes the same way.
function strictSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strictSchema);
  if (!node || typeof node !== "object") return node;
  const o = { ...(node as Record<string, unknown>) };
  delete o.minimum;
  delete o.maximum;
  if (o.type === "object") {
    if (o.additionalProperties && typeof o.additionalProperties === "object") {
      o.properties = Object.fromEntries(TRIGGER_KEYS.map((k) => [k, { type: "string" }]));
    }
    o.additionalProperties = false;
  }
  for (const k of ["properties", "items"]) {
    if (k === "properties" && o.properties) {
      o.properties = Object.fromEntries(
        Object.entries(o.properties as Record<string, unknown>).map(([pk, pv]) => [pk, strictSchema(pv)]),
      );
    } else if (o[k]) o[k] = strictSchema(o[k]);
  }
  return o;
}

const STRICT_TOOL = { ...EXTRACTION_TOOL, input_schema: strictSchema(EXTRACTION_TOOL.input_schema) as object };

type Body ={ chunk?: unknown; profile?: unknown };

function compactProfile(p: unknown): string {
  if (!p || typeof p !== "object") return "{}";
  const f = p as Partial<FounderProfile>;
  return JSON.stringify({ sectors: f.sectors, stage: f.stage, raise: f.raise, traction: f.traction });
}

function respond(extraction: Extraction, source: "llm" | "fallback") {
  return Response.json({ extraction, source });
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body || typeof body !== "object") return Response.json({ error: "invalid_body" }, { status: 400 });
  const chunk = typeof body.chunk === "string" ? body.chunk.slice(-MAX_CHUNK) : "";
  if (!chunk.trim()) return respond(fallbackExtract(""), "fallback");

  if (process.env.E2E_MOCK === "1" || !getAnthropic()) return respond(fallbackExtract(chunk), "fallback");

  try {
    const input = await haikuTool({
      system: SYSTEM,
      user: `Running profile: ${compactProfile(body.profile)}\nNewest chunk: """${chunk}"""`,
      tool: STRICT_TOOL,
      maxTokens: 300,
      strict: true,
      timeoutMs: 6000,
      // A retry would hold the client's single in-flight slot past the latency budget; the
      // keyword fallback answers instead.
      maxRetries: 0,
    });
    const extraction = parseExtraction(input);
    if (extraction) return respond(extraction, "llm");
  } catch (e) {
    console.warn("extract: LLM failed, using fallback:", e instanceof Error ? e.message : e);
  }
  return respond(fallbackExtract(chunk), "fallback");
}
