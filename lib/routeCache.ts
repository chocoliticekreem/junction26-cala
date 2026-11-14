// Aiven Valkey cache of the /api/cala/* responses themselves, shared by every server instance.
// Routes check it first, so every panel open is a Valkey read; the committed snapshot answers only
// when Valkey is unset or down, and a snapshot or live answer is written back here.
import { recordTier } from "./cacheStats";
import { snapshotNameKey } from "./calaSnapshot";
import { VALKEY_PREFIX, valkeyGetJson, valkeySetJson } from "./valkey";

export const ROUTE_PREFIX = `${VALKEY_PREFIX}route:`;

const PANEL_QUERY = /^what does (.+?) invest in\??$/i;

export function entityRouteKey(id: string): string {
  return `${ROUTE_PREFIX}entity:${id.toLowerCase()}`;
}

// Keyed like the snapshot (by investor name) so the seed script can fill it from the snapshot.
export function searchRouteKey(query: string): string {
  const m = query.trim().match(PANEL_QUERY);
  return m
    ? `${ROUTE_PREFIX}search:name:${snapshotNameKey(m[1])}`
    : `${ROUTE_PREFIX}search:q:${snapshotNameKey(query)}`;
}

export function searchRouteKeyForName(name: string): string {
  return `${ROUTE_PREFIX}search:name:${snapshotNameKey(name)}`;
}

export async function routeCacheGet(key: string): Promise<Record<string, unknown> | undefined> {
  const t0 = performance.now();
  const v = await valkeyGetJson(key);
  const hit = v !== null && typeof v === "object";
  recordTier("valkey", hit, performance.now() - t0);
  return hit ? (v as Record<string, unknown>) : undefined;
}

// Not awaited by callers' responses: a slow Valkey never delays an answer already in hand.
export function routeCacheSet(key: string, body: Record<string, unknown>): void {
  const rest = { ...body };
  delete rest.source;
  delete rest.latencyMs;
  void valkeySetJson(key, rest);
}
