// POST /api/simulate: founder profile + vision text -> Monte Carlo of funding paths over the cohort.
// Results are cached in Aiven Valkey by a hash of the request (and cohort build); without Valkey the
// route simply computes every time.
import { createHash } from "node:crypto";
import { getAnthropic } from "@/lib/anthropic";
import { findCompanyByName, loadCohort, loadCohortModel, usingCohortFixture } from "@/lib/cohort";
import { narrate, parseVisionLlm } from "@/lib/sim/llm";
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
const CACHE_VERSION = 2;

function parseDecision(x: unknown): Decision | undefined {
  if (!x || typeof x !== "object") return undefined;
  const d = x as Record<string, unknown>;
  if (d.kind === "first_cheque" && (d.option === "angel" || d.option === "accelerator" || d.option === "fund")) return { kind: "first_cheque", option: d.option };
  if (d.kind === "timing" && (d.option === "now" || d.option === "later_6m")) return { kind: "timing", option: d.option };
  if (d.kind === "lead" && typeof d.investorId === "string" && d.investorId.length < 200) return { kind: "lead", investorId: d.investorId };
  return undefined;
}

function cleanProfile(p: unknown): Pick<FounderProfile, "sectors" | "stage" | "raise"> {
  const f = (p && typeof p === "object" ? p : {}) as Partial<FounderProfile>;
  const sectors = Object.fromEntries(
    Object.entries(f.sectors && typeof f.sectors === "object" ? f.sectors : {}).filter(([k, v]) => isSector(k) && typeof v === "number" && v > 0),
  );
  return {
    sectors,
    stage: typeof f.stage === "string" && isStage(f.stage) ? f.stage : undefined,
    raise: typeof f.raise === "number" && f.raise > 0 ? f.raise : undefined,
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
  const profile = cleanProfile(body.profile);
  const decision = parseDecision(body.decision);
  const companyName = typeof body.companyName === "string" ? body.companyName.slice(0, 200) : "";

  const cohort = loadCohort();
  const fixture = usingCohortFixture();
  const company = companyName ? findCompanyByName(cohort, companyName) : undefined;
  const useLlm = process.env.E2E_MOCK !== "1" && !!getAnthropic();

  const key =
    `${ROUTE_PREFIX}simulate:v${CACHE_VERSION}:` +
    createHash("sha1")
      .update(JSON.stringify({ a: cohort.asOf, n: Object.keys(cohort.rounds).length, fixture, profile, visionText, decision, c: company?.id ?? null, llm: useLlm }))
      .digest("hex");
  const hit = await valkeyGetJson(key);
  if (hit && typeof hit === "object") {
    return Response.json({ ...(hit as object), cached: true, latencyMs: Math.round(performance.now() - t0) });
  }

  const keywordVision = parseVision(visionText);
  let vision: Vision = keywordVision;
  let visionSource: "llm" | "keyword" = "keyword";
  if (useLlm && visionText.trim()) {
    const v = await parseVisionLlm(visionText, keywordVision);
    if (v) {
      vision = v;
      visionSource = "llm";
    }
  }

  const model = loadCohortModel();
  const start: StartState = {
    sectors: profile.sectors,
    stage: profile.stage ?? "pre-seed",
    raiseUsd: profile.raise,
    companyId: company?.id,
  };
  const tSim = performance.now();
  const result = simulate(start, vision, model, { runs: RUNS, seed: SEED, decision });
  const simMs = Math.round(performance.now() - tSim);
  result.fixture = fixture;
  if (useLlm) {
    const lines = await narrate(result.tree.children, model);
    if (lines) result.explanation = lines;
  }

  const payload = { ...result, vision, visionSource, simMs };
  // A keyword answer standing in for a failed LLM call is not cached, so the LLM gets another try.
  if (!useLlm || visionSource === "llm") void valkeySetJson(key, payload);
  return Response.json({ ...payload, cached: false, latencyMs: Math.round(performance.now() - t0) });
}
