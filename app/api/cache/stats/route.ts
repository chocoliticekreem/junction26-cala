// Cala cache hit/miss counts per tier: this server instance (with p50 latency) and, when Aiven
// Valkey answers, the shared totals across every instance. Counts only, no keys or values.
import { CACHE_TIERS, localStats, sharedStats, type CacheTier } from "@/lib/cacheStats";
import { valkeyConfigured } from "@/lib/valkey";

export const dynamic = "force-dynamic";

const CACHE_HIT_TIERS: CacheTier[] = ["memory", "snapshot", "valkey", "file"];

// A request is a hit when any cache tier answered it, a miss when it reached Cala (served or not).
function summary(t: Record<CacheTier, { hits: number; misses: number }>) {
  return {
    hits: CACHE_HIT_TIERS.reduce((n, k) => n + t[k].hits, 0),
    misses: t.live.hits + t.live.misses,
  };
}

export async function GET() {
  const local = localStats();
  const shared = valkeyConfigured() ? await sharedStats() : null;
  return Response.json({
    valkey: { configured: valkeyConfigured(), connected: shared !== null },
    tiers: CACHE_TIERS,
    instance: { summary: summary(local), byTier: local },
    shared: shared && { summary: summary(shared), byTier: shared },
  });
}
