import { getRouteCala, searchSources } from "@/lib/cala";

const MAX_QUERY = 400;

function mock(query: string) {
  return {
    answer: `Mock answer for "${query}" (no Cala key or E2E_MOCK=1). Live answers come from Cala knowledge search with citations.`,
    sources: [{ name: "mock", url: "https://cala.ai" }],
    cached: false,
    mock: true,
  };
}

export async function POST(req: Request) {
  let query = "";
  try {
    const body = (await req.json()) as { query?: unknown };
    query = typeof body.query === "string" ? body.query.trim() : "";
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!query) return Response.json({ error: "missing_query" }, { status: 400 });
  if (query.length > MAX_QUERY) return Response.json({ error: "query_too_long" }, { status: 400 });

  const cala = getRouteCala();
  if (!cala) return Response.json(mock(query));

  const hitsBefore = cala.stats.cacheHits;
  try {
    const r = await cala.search(query);
    return Response.json({
      answer: r.content,
      sources: searchSources(r),
      entities: (r.entities ?? []).map((e) => ({ id: e.id, name: e.name, entity_type: e.entity_type })),
      cached: cala.stats.cacheHits > hitsBefore,
    });
  } catch (err) {
    console.warn("cala search:", err instanceof Error ? err.message : err);
    return Response.json({ error: "upstream_error" }, { status: 502 });
  }
}
