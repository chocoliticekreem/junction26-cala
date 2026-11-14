// Hit/miss/latency per Cala cache tier: in-process counters plus shared counts in Valkey, so
// /api/cache/stats can show both this instance and every instance together. No secrets here.
import { VALKEY_PREFIX, valkeyConfigured, valkeyHgetall, valkeyHincrby } from "./valkey";

export const CACHE_TIERS = ["memory", "snapshot", "valkey", "file", "live"] as const;
export type CacheTier = (typeof CACHE_TIERS)[number];

export const STATS_KEY = `${VALKEY_PREFIX}stats`;
const SAMPLES = 200;

type TierCounters = { hits: number; misses: number; samples: number[] };
export type TierStats = { hits: number; misses: number; p50Ms: number | null };
export type SharedTierStats = { hits: number; misses: number };

const g = globalThis as typeof globalThis & { __roomCacheStats?: Record<CacheTier, TierCounters> };
const emptyCounters = (): TierCounters => ({ hits: 0, misses: 0, samples: [] });
const local: Record<CacheTier, TierCounters> = (g.__roomCacheStats ??= {
  memory: emptyCounters(),
  snapshot: emptyCounters(),
  valkey: emptyCounters(),
  file: emptyCounters(),
  live: emptyCounters(),
});

// A hit records its latency; a miss only counts (it passes on to the next tier).
export function recordTier(tier: CacheTier, hit: boolean, ms: number): void {
  const c = local[tier];
  if (hit) {
    c.hits++;
    c.samples.push(ms);
    if (c.samples.length > SAMPLES) c.samples.shift();
  } else {
    c.misses++;
  }
  if (valkeyConfigured()) void valkeyHincrby(STATS_KEY, `${tier}:${hit ? "hits" : "misses"}`, 1);
}

function p50(samples: number[]): number | null {
  if (!samples.length) return null;
  const s = [...samples].sort((a, b) => a - b);
  return Math.round(s[Math.floor((s.length - 1) / 2)]);
}

export function localStats(): Record<CacheTier, TierStats> {
  return Object.fromEntries(
    CACHE_TIERS.map((t) => [t, { hits: local[t].hits, misses: local[t].misses, p50Ms: p50(local[t].samples) }]),
  ) as Record<CacheTier, TierStats>;
}

export async function sharedStats(): Promise<Record<CacheTier, SharedTierStats> | null> {
  const raw = await valkeyHgetall(STATS_KEY);
  if (!raw) return null;
  const n = (f: string) => Number(raw[f] ?? 0) || 0;
  return Object.fromEntries(
    CACHE_TIERS.map((t) => [t, { hits: n(`${t}:hits`), misses: n(`${t}:misses`) }]),
  ) as Record<CacheTier, SharedTierStats>;
}

export function resetLocalStats(): void {
  for (const t of CACHE_TIERS) local[t] = emptyCounters();
}
