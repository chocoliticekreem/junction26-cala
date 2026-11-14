// Tag cache for the tagging scripts: a JSON file under data/ai-cache/ (gitignored) in front of
// Aiven Valkey, so a fresh checkout with Valkey configured re-tags nothing. Valkey is best-effort
// (lib/valkey.ts): unreachable means file-only.
import { promises as fs } from "node:fs";
import path from "node:path";
import { VALKEY_PREFIX, valkeyGetJson, valkeySetJson } from "@/lib/valkey";
import type { CacheEntry, TagCache } from "./tagCompanies";

export const AI_CACHE_DIR = path.join(process.cwd(), "data", "ai-cache");

export async function fileValkeyTagCache(name: string): Promise<TagCache & { flush(): Promise<void> }> {
  const file = path.join(AI_CACHE_DIR, `${name}.json`);
  let entries: Record<string, CacheEntry> = {};
  try {
    entries = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, CacheEntry>;
  } catch {
    // first run
  }
  const vkey = (id: string) => `${VALKEY_PREFIX}ai:tags:v1:${name}:${id}`;
  return {
    async get(id) {
      if (entries[id]) return entries[id];
      const v = (await valkeyGetJson(vkey(id))) as CacheEntry | undefined;
      if (v && typeof v.h === "string" && Array.isArray(v.tags)) entries[id] = v;
      return entries[id];
    },
    async set(id, entry) {
      entries[id] = entry;
      await valkeySetJson(vkey(id), entry);
    },
    async flush() {
      await fs.mkdir(AI_CACHE_DIR, { recursive: true });
      await fs.writeFile(file, JSON.stringify(entries, null, 1) + "\n");
    },
  };
}
