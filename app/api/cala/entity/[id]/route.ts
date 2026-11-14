import { SNAPSHOT } from "@/lib/calaSnapshotData";
import { CalaBudgetError, CalaError, UUID_RE, entitySources, getRouteCala } from "@/lib/cala";
import { snapshotEntity } from "@/lib/calaSnapshot";

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

  const snap = snapshotEntity(SNAPSHOT, id);
  if (snap) {
    const { sources, ...entity } = snap;
    return Response.json({ entity: { ...entity, properties: {} }, sources, cached: true, source: "snapshot" });
  }

  const cala = getRouteCala();
  if (!cala) return Response.json(mock(id));

  const hitsBefore = cala.stats.cacheHits;
  try {
    const e = await cala.retrieve(id);
    const cached = cala.stats.cacheHits > hitsBefore;
    return Response.json({
      entity: {
        id: e.id,
        name: e.name,
        entity_type: e.entity_type,
        description: e.description ?? undefined,
        properties: Object.fromEntries(Object.entries(e.properties ?? {}).map(([k, v]) => [k, v.value])),
      },
      sources: entitySources(e),
      cached,
      source: cached ? "cache" : "live",
    });
  } catch (err) {
    if (err instanceof CalaBudgetError) return Response.json(budgetExhausted(id));
    const status = err instanceof CalaError && err.status === 404 ? 404 : 502;
    console.warn("cala entity:", err instanceof Error ? err.message : err);
    return Response.json({ error: status === 404 ? "not_found" : "upstream_error" }, { status });
  }
}
