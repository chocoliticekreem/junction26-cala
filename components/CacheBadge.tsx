"use client";

// Which cache tier answered the live Cala section. Reads `source` and `latencyMs` from a
// /api/cala/* response. The global hit/miss counter lives in components/CacheStats.tsx.

const LABEL: Record<string, string> = {
  memory: "Served from server memory",
  snapshot: "Served from committed snapshot",
  valkey: "Served from Aiven Valkey",
  file: "Served from local file cache",
  live: "Live from Cala",
};

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return ms < 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 1000)} s`;
}

export default function CacheBadge({ result }: { result?: object }) {
  const r = (result ?? {}) as { source?: unknown; latencyMs?: unknown };
  const source = typeof r.source === "string" && r.source in LABEL ? r.source : undefined;
  const latency = typeof r.latencyMs === "number" ? r.latencyMs : undefined;
  if (!source) return null;
  return (
    <div className="font-mono cache-badge" data-testid="cache-badge">
      {LABEL[source]}
      {latency !== undefined && ` · ${formatMs(latency)}`}
    </div>
  );
}
