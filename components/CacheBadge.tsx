"use client";

import { useEffect, useState } from "react";

// Which cache tier answered the live Cala section, and how often the cache saves a Cala call.
// Reads `source` and `latencyMs` from a /api/cala/* response and the counts from /api/cache/stats.

const LABEL: Record<string, string> = {
  memory: "Served from server memory",
  snapshot: "Served from committed snapshot",
  valkey: "Served from Aiven Valkey",
  file: "Served from local file cache",
  live: "Live from Cala",
};

type Summary = { hits: number; misses: number };
type StatsBody = { instance?: { summary?: Summary }; shared?: { summary?: Summary } | null };

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return ms < 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 1000)} s`;
}

const line = { fontSize: 10.5, color: "var(--fg-3)", marginTop: 8, display: "flex", gap: 10, flexWrap: "wrap" } as const;

export default function CacheBadge({ result }: { result?: object }) {
  const r = (result ?? {}) as { source?: unknown; latencyMs?: unknown };
  const source = typeof r.source === "string" && r.source in LABEL ? r.source : undefined;
  const latency = typeof r.latencyMs === "number" ? r.latencyMs : undefined;
  const [stats, setStats] = useState<{ summary: Summary; shared: boolean } | null>(null);

  useEffect(() => {
    if (!source) return;
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
  }, [source, latency]);

  if (!source) return null;
  return (
    <div className="font-mono" style={line} data-testid="cache-badge">
      <span>
        {LABEL[source]}
        {latency !== undefined && ` · ${formatMs(latency)}`}
      </span>
      {stats && (
        <span
          data-testid="cache-stats"
          title={stats.shared ? "All server instances, counted in Aiven Valkey" : "This server instance"}
          style={{ border: "1px solid var(--line-2)", borderRadius: 4, padding: "0 6px" }}
        >
          Cache: {stats.summary.hits} hits / {stats.summary.misses} misses
        </span>
      )}
    </div>
  );
}
