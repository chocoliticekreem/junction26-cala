import { analyzeFounder } from "@/lib/ai/analyzeFounder";
import type { FounderProfile } from "@/lib/types";

const MAX_CHUNK = 2000;

type Body = { chunk?: unknown; profile?: unknown };

function compactProfile(p: unknown): string {
  if (!p || typeof p !== "object") return "{}";
  const f = p as Partial<FounderProfile>;
  return JSON.stringify({ sectors: f.sectors, tags: f.tags, stage: f.stage, raise: f.raise, traction: f.traction });
}

// analysis: "ai" when Haiku read the chunk, "keyword_fallback" when the keyword parser stood in
// (fallbackReason says why). source is the older field the pitch hook reads ("llm" | "fallback").
export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body || typeof body !== "object") return Response.json({ error: "invalid_body" }, { status: 400 });
  const chunk = typeof body.chunk === "string" ? body.chunk.slice(-MAX_CHUNK) : "";

  const r = await analyzeFounder(chunk, {
    context:
      "Running profile (context only; report what the newest chunk says or clearly implies, do not repeat it): " +
      compactProfile(body.profile),
    timeoutMs: 6000,
    // A retry would hold the client's single in-flight slot past the latency budget; the keyword
    // fallback answers instead, flagged as such.
    maxRetries: 0,
  });
  return Response.json({
    extraction: r.extraction,
    founder: r.founder,
    analysis: r.analysis,
    ...(r.fallbackReason ? { fallbackReason: r.fallbackReason } : {}),
    source: r.analysis === "ai" ? "llm" : "fallback",
  });
}
