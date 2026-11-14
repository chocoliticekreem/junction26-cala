"use client";

import { useEffect, useState } from "react";

// Global cache hit/miss counter from /api/cache/stats. Debug-grade: lives in the results
// footer, not in any investor panel.

type Summary = { hits: number; misses: number };
type StatsBody = { instance?: { summary?: Summary }; shared?: { summary?: Summary } | null };

export default function CacheStats() {
  const [stats, setStats] = useState<{ summary: Summary; shared: boolean } | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/cache/stats")
      .then((res) => (res.ok ? (res.json() as Promise<StatsBody>) : null))
      .then((body) => {
        const summary = body?.shared?.summary ?? body?.instance?.summary;
        if (live && summary) setStats({ summary, shared: Boolean(body?.shared?.summary) });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  if (!stats) return null;
  return (
    <span className="cache-stats" data-testid="cache-stats" title={stats.shared ? "All server instances, counted in Aiven Valkey" : "This server instance"}>
      cache {stats.summary.hits} hits / {stats.summary.misses} misses
    </span>
  );
}
