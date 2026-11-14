// Server-only cohort loader. data/cohort.json (Track A's ingest) is read from disk at runtime so the
// build does not depend on it existing. The synthetic fixture answers only under NODE_ENV=test or
// E2E_MOCK=1; a real server with no cohort throws NoCohortError so routes answer 503 instead of
// showing invented companies.
import { readFileSync } from "node:fs";
import path from "node:path";
import fixture from "@/data/cohort.fixture.json";
import { fitModel } from "@/lib/sim/fit";
import type { Cohort, CohortCompany, SimModel } from "@/lib/sim/types";
import { cohortTrust } from "@/lib/verify/load";
import type { Trust } from "@/lib/verify/types";

export class NoCohortError extends Error {
  constructor() {
    super("no_cohort");
  }
}

let cached: { cohort: Cohort; fixture: boolean } | undefined;
let model: SimModel | undefined;

function readReal(): Cohort | undefined {
  try {
    const raw = readFileSync(path.join(process.cwd(), "data", "cohort.json"), "utf8");
    const c = JSON.parse(raw) as Cohort;
    return c && c.companies && Object.keys(c.companies).length > 0 ? c : undefined;
  } catch {
    return undefined;
  }
}

function load() {
  if (cached) return cached;
  const real = readReal();
  if (real) {
    cached = { cohort: real, fixture: false };
    return cached;
  }
  if (process.env.NODE_ENV !== "test" && process.env.E2E_MOCK !== "1") throw new NoCohortError();
  cached = { cohort: fixture as unknown as Cohort, fixture: true };
  return cached;
}

export function loadCohort(): Cohort {
  return load().cohort;
}

export function usingCohortFixture(): boolean {
  return load().fixture;
}

// Fitted once per server process on the full cohort (asOf = the cohort's build date).
export function loadCohortModel(): SimModel {
  model ??= fitModel(loadCohort());
  return model;
}

const normName = (s: string) =>
  s
    .toLowerCase()
    .replace(/\(fixture\)/g, "")
    .replace(/\b(?:ltd|limited|inc|plc|gmbh|sl|s\.l\.|sas|bv|ai)\b\.?/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Exact normalised-name match first, then a unique prefix match ("Cala" -> "Cala AI").
export function findCompanyByName(cohort: Cohort, name: string): CohortCompany | undefined {
  const q = normName(name);
  if (!q) return undefined;
  const all = Object.values(cohort.companies);
  const exact = all.filter((c) => normName(c.name) === q);
  if (exact.length) return exact.sort((a, b) => b.roundIds.length - a.roundIds.length)[0];
  const prefix = all.filter((c) => normName(c.name).startsWith(`${q} `));
  return prefix.length === 1 ? prefix[0] : undefined;
}

let trust: Record<string, Trust> | undefined;

// Trust per round id (data/verify.json, else assessed from the round's own sources), so the
// simulator and UI can drop conflicts and mark unverified rounds. See lib/verify/rules.ts.
export function loadCohortTrust(): Record<string, Trust> {
  trust ??= cohortTrust(loadCohort());
  return trust;
}
