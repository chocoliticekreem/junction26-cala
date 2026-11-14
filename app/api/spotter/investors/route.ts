import { loadCohort, usingCohortFixture } from "@/lib/cohort";
import { spotterInvestorOptions, type SpotterInvestorOption } from "@/lib/sim/spotter/investors";

const MOCK: SpotterInvestorOption[] = [
  { id: "seedcamp", name: "Seedcamp", kind: "accelerator", rounds: 11 },
  { id: "entrepreneur-first", name: "Entrepreneur First", kind: "accelerator", rounds: 7 },
  { id: "lightspeed-venture-partners", name: "Lightspeed Venture Partners", kind: "fund", rounds: 98 },
  { id: "index-ventures", name: "Index Ventures", kind: "fund", rounds: 23 },
];

export async function GET() {
  if (process.env.E2E_MOCK === "1") return Response.json({ investors: MOCK, asOf: "2026-11-14", mock: true });
  if (usingCohortFixture()) return Response.json({ error: "no_cohort" }, { status: 503 });
  const cohort = loadCohort();
  return Response.json({ investors: spotterInvestorOptions(cohort), asOf: cohort.asOf });
}
