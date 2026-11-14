// Server-only accessor for data/verify.json (written by `npm run verify-data`). Read from disk at
// runtime, like lib/cohort.ts, so the build never depends on it. A claim with no stored result is
// assessed on the spot from its own source titles, so every claim gets a trust level.
import { readFileSync } from "node:fs";
import path from "node:path";
import { DATA_AS_OF } from "@/lib/data";
import { titleCheck } from "./checks";
import { assessTrust } from "./rules";
import type { Claim, SourceCheck, Trust, VerifyFile } from "./types";

let cached: VerifyFile | null | undefined;

export function loadVerifyFile(): VerifyFile | null {
  if (cached !== undefined) return cached;
  try {
    const raw = readFileSync(path.join(/* turbopackIgnore: true */ process.cwd(), "data", "verify.json"), "utf8");
    const f = JSON.parse(raw) as VerifyFile;
    cached = f?.version === 1 ? f : null;
  } catch {
    cached = null;
  }
  return cached;
}

export function resetVerifyCache(): void {
  cached = undefined;
}

export function titleChecks(c: Claim): SourceCheck[] {
  return c.sources.map((s) => titleCheck(c, s)).filter((k): k is SourceCheck => !!k);
}

export function trustFor(c: Claim, file: VerifyFile | null = loadVerifyFile()): Trust {
  const stored = file?.trust[c.id];
  if (stored) return stored;
  const evidence = file?.evidence[c.id] ?? [];
  const asOf = file?.asOf ?? DATA_AS_OF.toISOString();
  return assessTrust(c, [...evidence, ...titleChecks(c)], asOf);
}
