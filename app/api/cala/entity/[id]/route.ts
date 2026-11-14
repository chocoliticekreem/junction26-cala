import { SNAPSHOT } from "@/lib/calaSnapshotData";
import { CalaBudgetError, CalaError, UUID_RE, entitySources, getRouteCala } from "@/lib/cala";
import { recordTier } from "@/lib/cacheStats";
import { snapshotEntity } from "@/lib/calaSnapshot";
import { entityRouteKey, routeCacheGet, routeCacheSet } from "@/lib/routeCache";

function mock(id: string) {
  return {
    entity: {
      id,
      name: "Mock entity (no Cala key)",
      entity_type: "Company",
      description: "Placeholder returned because CALA_API_KEY is unset or E2E_MOCK=1.",
      properties: {},
    },
    sources: [{ name: "mock", url: "https://cala.ai" }],
    cached: false,
    mock: true,
  };
}

function budgetExhausted(id: string) {
  return {
    entity: {
      id,
      name: "Live Cala lookup paused",
      entity_type: "Company",
      description: "The live Cala credit budget for this demo is used up. Deals above come from the cached ingest.",
      properties: {},
    },
    sources: [],
    cached: false,
    mock: true,
    budgetExhausted: true,
  };
}

export async function GET(_req: Request, ctx: RouteContext<"/api/cala/entity/[id]">) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return Response.json({ error: "invalid_id" }, { status: 400 });

  const t0 = performance.now();
  const key = entityRouteKey(id);
  const shared = await routeCacheGet(key);
  if (shared) {
    return Response.json({ ...shared, cached: true, source: "valkey", latencyMs: Math.round(performance.now() - t0) });
  }

  const tSnap = performance.now();
  const snap = snapshotEntity(SNAPSHOT, id);
  recordTier("snapshot", Boolean(snap), performance.now() - tSnap);
  if (snap) {
    const { sources, ...entity } = snap;
    const body = { entity: { ...entity, properties: {} }, sources, cached: true };
    routeCacheSet(key, body);
    return Response.json({ ...body, source: "snapshot", latencyMs: Math.round(performance.now() - t0) });
  }

  const cala = getRouteCala();
  if (!cala) return Response.json(mock(id));

  try {
    const { value: e, source } = await cala.withMeta.retrieve(id);
    const body = {
      entity: {
        id: e.id,
        name: e.name,
        entity_type: e.entity_type,
        description: e.description ?? undefined,
        properties: Object.fromEntries(Object.entries(e.properties ?? {}).map(([k, v]) => [k, v.value])),
      },
      sources: entitySources(e),
      cached: source !== "live",
    };
    routeCacheSet(key, body);
    return Response.json({ ...body, source, latencyMs: Math.round(performance.now() - t0) });
  } catch (err) {
    if (err instanceof CalaBudgetError) return Response.json(budgetExhausted(id));
    const status = err instanceof CalaError && err.status === 404 ? 404 : 502;
    console.warn("cala entity:", err instanceof Error ? err.message : err);
    return Response.json({ error: status === 404 ? "not_found" : "upstream_error" }, { status });
  }
}
