// POST /api/simulate: founder profile + vision text -> Monte Carlo of funding paths over the cohort.
// Results are cached in Aiven Valkey by a hash of the request (and cohort build); without Valkey the
// route simply computes every time.
import { createHash } from "node:crypto";
import { aiUnavailableReason, analyzeFounder, type FounderResult } from "@/lib/ai/analyzeFounder";
import { analyzeVision, type VisionResult } from "@/lib/ai/analyzeVision";
import { cleanTags, type Analysis } from "@/lib/ai/strict";
import { NoCohortError, findCompanyByName, loadCohort, loadCohortModel, usingCohortFixture } from "@/lib/cohort";
import { narrate } from "@/lib/sim/llm";
import { simulate } from "@/lib/sim/simulate";
import type { Decision, StartState, Vision } from "@/lib/sim/types";
import { parseVision } from "@/lib/sim/vision";
import { isSector, isStage } from "@/lib/taxonomy";
import type { FounderProfile } from "@/lib/types";
import { ROUTE_PREFIX } from "@/lib/routeCache";
import { valkeyGetJson, valkeySetJson } from "@/lib/valkey";

export const dynamic = "force-dynamic";

const RUNS = 5000;
const SEED = 20261114;
const MAX_VISION = 1500;
const MAX_PITCH = 4000;
const CACHE_VERSION = 5;

function parseDecision(x: unknown): Decision | undefined {
  if (!x || typeof x !== "object") return undefined;
  const d = x as Record<string, unknown>;
  if (d.kind === "first_cheque" && (d.option === "angel" || d.option === "accelerator" || d.option === "fund")) return { kind: "first_cheque", option: d.option };
  if (d.kind === "timing" && (d.option === "now" || d.option === "later_6m")) return { kind: "timing", option: d.option };
  if (d.kind === "lead" && typeof d.investorId === "string" && d.investorId.length < 200) return { kind: "lead", investorId: d.investorId };
  return undefined;
}

function cleanProfile(p: unknown): Pick<FounderProfile, "sectors" | "stage" | "raise" | "tags" | "oneLiner"> {
  const f = (p && typeof p === "object" ? p : {}) as Partial<FounderProfile>;
  const sectors = Object.fromEntries(
    Object.entries(f.sectors && typeof f.sectors === "object" ? f.sectors : {}).filter(([k, v]) => isSector(k) && typeof v === "number" && v > 0),
  );
  return {
    sectors,
    stage: typeof f.stage === "string" && isStage(f.stage) ? f.stage : undefined,
    raise: typeof f.raise === "number" && f.raise > 0 ? f.raise : undefined,
    tags: cleanTags(f.tags, 12),
    oneLiner: typeof f.oneLiner === "string" ? f.oneLiner.slice(0, 200) : undefined,
  };
}

export async function POST(req: Request) {
  const t0 = performance.now();
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body || typeof body !== "object") return Response.json({ error: "invalid_body" }, { status: 400 });
  const visionText = typeof body.visionText === "string" ? body.visionText.slice(0, MAX_VISION) : "";
  const pitchText = typeof body.pitchText === "string" ? body.pitchText.slice(0, MAX_PITCH) : "";
  const profile = cleanProfile(body.profile);
  const decision = parseDecision(body.decision);
  const companyName = typeof body.companyName === "string" ? body.companyName.slice(0, 200) : "";

  let cohort;
  try {
    cohort = loadCohort();
  } catch (e) {
    if (e instanceof NoCohortError) return Response.json({ error: "no_cohort" }, { status: 503 });
    throw e;
  }
  const fixture = usingCohortFixture();
  const company = companyName ? findCompanyByName(cohort, companyName) : undefined;
  const useLlm = !aiUnavailableReason();

  const key =
    `${ROUTE_PREFIX}simulate:v${CACHE_VERSION}:` +
    createHash("sha1")
      .update(JSON.stringify({ a: cohort.asOf, n: Object.keys(cohort.rounds).length, fixture, profile, visionText, pitchText, decision, c: company?.id ?? null, llm: useLlm }))
      .digest("hex");
  const hit = await valkeyGetJson(key);
  if (hit && typeof hit === "object") {
    return Response.json({ ...(hit as object), cached: true, latencyMs: Math.round(performance.now() - t0) });
  }

  // Haiku reads the vision and (when sent) the pitch; the keyword parsers answer only on failure,
  // and the response says which one did.
  const [visionR, founderR]: [VisionResult | undefined, FounderResult | undefined] = await Promise.all([
    visionText.trim() ? analyzeVision(visionText) : undefined,
    pitchText.trim() ? analyzeFounder(pitchText) : undefined,
  ]);
  const vision: Vision = visionR?.vision ?? parseVision(visionText);
  const founder = founderR?.founder;

  const model = loadCohortModel();
  const sectors = Object.keys(profile.sectors).length ? profile.sectors : (founder?.sectorWeights ?? {});
  const tags = cleanTags([...(profile.tags ?? []), ...(founder?.tags ?? [])], 12);
  const description = [founder?.oneLiner ?? profile.oneLiner, pitchText].filter(Boolean).join(". ");
  const start: StartState = {
    sectors,
    stage: profile.stage ?? founder?.stage ?? "pre-seed",
    raiseUsd: profile.raise ?? founder?.raiseUsd,
    companyId: company?.id,
    ...(tags.length ? { tags } : {}),
    ...(description ? { description } : {}),
  };
  const tSim = performance.now();
  const result = simulate(start, vision, model, { runs: RUNS, seed: SEED, decision });
  const simMs = Math.round(performance.now() - tSim);
  result.fixture = fixture;
  let narrative: "ai" | "none" = "none";
  if (useLlm) {
    const lines = await narrate(result.tree.children, model);
    if (lines) {
      result.explanation = lines;
      narrative = "ai";
    }
  }

  const analysisDetail: { vision?: Analysis; founder?: Analysis; fallbackReasons?: string[] } = {};
  if (visionR) analysisDetail.vision = visionR.analysis;
  if (founderR) analysisDetail.founder = founderR.analysis;
  const reasons = [visionR?.fallbackReason, founderR?.fallbackReason].filter((r): r is string => !!r);
  if (reasons.length) analysisDetail.fallbackReasons = reasons;
  const ran = [visionR, founderR].filter((r) => !!r);
  const analysis: Analysis | undefined = ran.length ? (ran.some((r) => r.analysis === "keyword_fallback") ? "keyword_fallback" : "ai") : undefined;

  const payload = {
    ...result,
    vision,
    visionSource: visionR?.analysis === "ai" ? "llm" : "keyword",
    ...(analysis ? { analysis, analysisDetail } : {}),
    ...(founder ? { founder } : {}),
    narrative,
    simMs,
  };
  // A keyword answer standing in for a failed LLM call is not cached, so the LLM gets another try.
  if (!useLlm || analysis !== "keyword_fallback") void valkeySetJson(key, payload);
  return Response.json({ ...payload, cached: false, latencyMs: Math.round(performance.now() - t0) });
}
