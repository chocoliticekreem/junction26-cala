// Account-memory persistence: Aiven Valkey first, a local JSON file when Valkey is unset or down.
// Both are written, so a doc built while Valkey was down is still readable on this machine.
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { isReadOnlyFsError } from "@/lib/cala";
import { valkeyGetJson, valkeySetJson } from "@/lib/valkey";

export const CTX_PREFIX = "room:ctx:v1:";
export const WATCH_PREFIX = "room:watch:v1:";
export const CTX_TTL_SECONDS = 90 * 24 * 3600;

export const CONTEXT_STORE_DIR = path.join(/* turbopackIgnore: true */ process.cwd(), "data", ".context-store");

const ID_RE = /^[a-z0-9][a-z0-9-]{0,79}$/i;

export function validStoreId(id: string): boolean {
  return ID_RE.test(id);
}

function file(key: string): string {
  return path.join(CONTEXT_STORE_DIR, createHash("sha1").update(key).digest("hex") + ".json");
}

export async function storeGet<T>(key: string): Promise<T | undefined> {
  const v = await valkeyGetJson(key);
  if (v !== undefined && v !== null) return v as T;
  try {
    return JSON.parse(await fs.readFile(file(key), "utf8")).value as T;
  } catch {
    return undefined;
  }
}

export async function storeSet(key: string, value: unknown, ttlSeconds = CTX_TTL_SECONDS): Promise<{ valkey: boolean; local: boolean }> {
  const [valkey, local] = await Promise.all([
    valkeySetJson(key, value, ttlSeconds).then(
      async () => (await valkeyGetJson(key)) !== undefined,
      () => false,
    ),
    fs
      .mkdir(CONTEXT_STORE_DIR, { recursive: true })
      .then(() => fs.writeFile(file(key), JSON.stringify({ key, at: new Date().toISOString(), value })))
      .then(
        () => true,
        (e) => {
          if (!isReadOnlyFsError(e)) console.warn("context store:", e instanceof Error ? e.message : e);
          return false;
        },
      ),
  ]);
  return { valkey, local };
}
