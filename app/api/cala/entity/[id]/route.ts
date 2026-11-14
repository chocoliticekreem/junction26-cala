import { CalaError, UUID_RE, entitySources, getRouteCala } from "@/lib/cala";

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

export async function GET(_req: Request, ctx: RouteContext<"/api/cala/entity/[id]">) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return Response.json({ error: "invalid_id" }, { status: 400 });

  const cala = getRouteCala();
  if (!cala) return Response.json(mock(id));

  const hitsBefore = cala.stats.cacheHits;
  try {
    const e = await cala.retrieve(id);
    return Response.json({
      entity: {
        id: e.id,
        name: e.name,
        entity_type: e.entity_type,
        description: e.description ?? undefined,
        properties: Object.fromEntries(Object.entries(e.properties ?? {}).map(([k, v]) => [k, v.value])),
      },
      sources: entitySources(e),
      cached: cala.stats.cacheHits > hitsBefore,
    });
  } catch (err) {
    const status = err instanceof CalaError && err.status === 404 ? 404 : 502;
    console.warn("cala entity:", err instanceof Error ? err.message : err);
    return Response.json({ error: status === 404 ? "not_found" : "upstream_error" }, { status });
  }
}
