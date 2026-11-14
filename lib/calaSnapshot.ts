// Committed snapshot of the Cala answers the investor panel shows, built from the local cache by
// scripts/build-snapshot.ts. The /api/cala/* routes serve it before any cache or live call, so a
// deploy with a read-only filesystem and no cache still answers every investor at zero credits.
import type { Source } from "./types";

export type SnapshotEntity = {
  id: string;
  name: string;
  entity_type: string;
  description?: string;
  sources: Source[];
};

export type SnapshotSearch = {
  investorId: string;
  query: string;
  answer: string;
  sources: Source[];
};

export type CalaSnapshot = {
  version: 1;
  entities: Record<string, SnapshotEntity>;
  searches: Record<string, SnapshotSearch>;
};

export function snapshotNameKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// The panel asks "What does <investor name> invest in?"; the snapshot answers by investor name.
const PANEL_QUERY = /^what does (.+?) invest in\??$/i;

export function snapshotEntity(snap: CalaSnapshot, id: string): SnapshotEntity | undefined {
  return Object.hasOwn(snap.entities, id) ? snap.entities[id] : undefined;
}

export function snapshotSearch(snap: CalaSnapshot, query: string): SnapshotSearch | undefined {
  const m = query.trim().match(PANEL_QUERY);
  if (!m) return undefined;
  const key = snapshotNameKey(m[1]);
  return Object.hasOwn(snap.searches, key) ? snap.searches[key] : undefined;
}
