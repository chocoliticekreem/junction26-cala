// GET /api/network: investor nodes and co-invest / follow-on edges from the cohort, for the map.
// Built from the in-process fitted model (a few ms), cached in Valkey per cohort build so every
// instance serves the same graph; works without Valkey.
import { loadCohort, loadCohortModel, usingCohortFixture } from "@/lib/cohort";
import { ROUTE_PREFIX } from "@/lib/routeCache";
import { buildNetwork } from "@/lib/sim/network";
import { valkeyGetJson, valkeySetJson } from "@/lib/valkey";

export const dynamic = "force-dynamic";

export async function GET() {
  const cohort = loadCohort();
  const fixture = usingCohortFixture();
  const key = `${ROUTE_PREFIX}network:v1:${cohort.asOf}:${Object.keys(cohort.rounds).length}:${fixture ? "fx" : "real"}`;
  const hit = await valkeyGetJson(key);
  if (hit && typeof hit === "object") return Response.json({ ...(hit as object), cached: true });
  const net = { ...buildNetwork(loadCohortModel()), fixture };
  void valkeySetJson(key, net);
  return Response.json({ ...net, cached: false });
}
