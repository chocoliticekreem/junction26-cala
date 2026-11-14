// Read-only view of data/cohort.json (written by the cohort ingest) for lead flags on precedents and
// the watch feed. Read at runtime so this module works before the file exists.
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Sector, Source, Stage } from "@/lib/types";

export type CohortLite = {
  companies: Record<string, { id: string; name: string; sector: Sector }>;
  rounds: Record<
    string,
    {
      id: string;
      companyId: string;
      stage: Stage | "unknown";
      label: string;
      date?: string;
      amountUsd?: number;
      participants: { investorId: string; name: string; isLead?: boolean }[];
      sources: Source[];
    }
  >;
  investors: Record<string, { id: string; name: string; investorsJsonId?: string }>;
};

let cached: CohortLite | null | undefined;

export function loadCohortLite(): CohortLite | null {
  if (cached !== undefined) return cached;
  try {
    const file = path.join(/* turbopackIgnore: true */ process.cwd(), "data", "cohort.json");
    const c = JSON.parse(readFileSync(file, "utf8")) as CohortLite;
    cached = c && c.rounds && Object.keys(c.rounds).length ? c : null;
  } catch {
    cached = null;
  }
  return cached;
}
