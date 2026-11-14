import { SNAPSHOT } from "@/lib/calaSnapshotData";
import { CalaBudgetError, getRouteCala, searchSources } from "@/lib/cala";
import { recordTier } from "@/lib/cacheStats";
import { snapshotSearch } from "@/lib/calaSnapshot";
import { routeCacheGet, routeCacheSet, searchRouteKey } from "@/lib/routeCache";

const MAX_QUERY = 400;

function mock(query: string) {
  return {
    answer: `Mock answer for "${query}" (no Cala key or E2E_MOCK=1). Live answers come from Cala knowledge search with citations.`,
    sources: [{ name: "mock", url: "https://cala.ai" }],
    cached: false,
    mock: true,
  };
}

function budgetExhausted() {
  return {
    answer: "Live Cala lookup paused: the credit budget for this demo is used up. Deals above come from the cached ingest.",
    sources: [],
    cached: false,
    mock: true,
    budgetExhausted: true,
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

  const t0 = performance.now();
  const key = searchRouteKey(query);
  const shared = await routeCacheGet(key);
  if (shared) {
    return Response.json({ ...shared, cached: true, source: "valkey", latencyMs: Math.round(performance.now() - t0) });
  }

  const tSnap = performance.now();
  const snap = snapshotSearch(SNAPSHOT, query);
  recordTier("snapshot", Boolean(snap), performance.now() - tSnap);
  if (snap) {
    const body = { answer: snap.answer, sources: snap.sources, cached: true };
    routeCacheSet(key, body);
    return Response.json({ ...body, source: "snapshot", latencyMs: Math.round(performance.now() - t0) });
  }

  const cala = getRouteCala();
  if (!cala) return Response.json(mock(query));

  try {
    const { value: r, source } = await cala.withMeta.search(query);
    const body = {
      answer: r.content,
      sources: searchSources(r),
      entities: (r.entities ?? []).map((e) => ({ id: e.id, name: e.name, entity_type: e.entity_type })),
      cached: source !== "live",
    };
    routeCacheSet(key, body);
    return Response.json({ ...body, source, latencyMs: Math.round(performance.now() - t0) });
  } catch (err) {
    if (err instanceof CalaBudgetError) return Response.json(budgetExhausted());
    console.warn("cala search:", err instanceof Error ? err.message : err);
    return Response.json({ error: "upstream_error" }, { status: 502 });
  }
}
