// Bulk-loads every cached Cala response in data/cala-cache into Aiven Valkey, so any deploy that
// points at the same Valkey starts warm and answers those requests with zero Cala calls.
// Idempotent: re-running overwrites the same keys and refreshes their TTL. Makes no Cala calls.
// Usage: npm run seed-valkey
import { promises as fs } from "node:fs";
import path from "node:path";
import { CALA_CACHE_DIR, cacheKeyHash } from "../lib/cala";
import { VALKEY_PREFIX, VALKEY_TTL_SECONDS, closeValkey, getValkey } from "../lib/valkey";
import { SNAPSHOT } from "../lib/calaSnapshotData";
import { entityRouteKey, searchRouteKeyForName } from "../lib/routeCache";

const ROOT = path.resolve(__dirname, "..");
const BATCH = 100;

try {
  process.loadEnvFile(path.join(ROOT, ".env.local"));
} catch {
  // no .env.local: AIVEN_VALKEY_URI may come from the shell
}

type Entry = { key: string; value: unknown };

async function readEntries(dir: string): Promise<{ entries: [string, string][]; skipped: string[] }> {
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
  const entries: [string, string][] = [];
  const skipped: string[] = [];
  for (const f of files) {
    try {
      const { key, value } = JSON.parse(await fs.readFile(path.join(dir, f), "utf8")) as Entry;
      // The file name is the hash of the request key; a mismatch means a hand-edited file.
      if (typeof key !== "string" || value === undefined || cacheKeyHash(key) + ".json" !== f) {
        skipped.push(f);
        continue;
      }
      entries.push([VALKEY_PREFIX + cacheKeyHash(key), JSON.stringify(value)]);
    } catch {
      skipped.push(f);
    }
  }
  return { entries, skipped };
}

// The panel's own responses, keyed as the routes look them up, so every panel open is a Valkey hit.
function snapshotRouteEntries(): [string, string][] {
  const out: [string, string][] = [];
  for (const [id, e] of Object.entries(SNAPSHOT.entities)) {
    const { sources, ...entity } = e;
    out.push([entityRouteKey(id), JSON.stringify({ entity: { ...entity, properties: {} }, sources, cached: true })]);
  }
  for (const [nameKey, sch] of Object.entries(SNAPSHOT.searches)) {
    out.push([searchRouteKeyForName(nameKey), JSON.stringify({ answer: sch.answer, sources: sch.sources, cached: true })]);
  }
  return out;
}

async function countKeys(prefix: string): Promise<number> {
  const c = await getValkey();
  if (!c) return 0;
  let cursor = "0";
  let n = 0;
  do {
    const [next, keys] = await c.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 1000);
    cursor = next;
    n += keys.length;
  } while (cursor !== "0");
  return n;
}

async function main() {
  if (path.resolve(process.cwd()) !== ROOT) throw new Error(`run from the repo root (${ROOT}) so the cache path matches the app`);
  if (!process.env.AIVEN_VALKEY_URI) throw new Error("AIVEN_VALKEY_URI missing: add it to .env.local");
  const { entries: cacheEntries, skipped } = await readEntries(CALA_CACHE_DIR);
  const routeEntries = snapshotRouteEntries();
  const entries = [...cacheEntries, ...routeEntries];
  const c = await getValkey();
  if (!c) throw new Error("Valkey unreachable: check AIVEN_VALKEY_URI and the Aiven service status");

  const t0 = performance.now();
  let created = 0;
  let refreshed = 0;
  let bytes = 0;
  for (let i = 0; i < entries.length; i += BATCH) {
    const batch = entries.slice(i, i + BATCH);
    const pipe = c.pipeline();
    for (const [k, v] of batch) {
      pipe.exists(k);
      pipe.set(k, v, "EX", VALKEY_TTL_SECONDS);
      bytes += v.length;
    }
    const results = (await pipe.exec()) ?? [];
    for (let j = 0; j < results.length; j += 2) {
      const [existsErr, existed] = results[j];
      const [setErr] = results[j + 1];
      if (existsErr || setErr) throw existsErr ?? setErr;
      if (existed === 1) refreshed++;
      else created++;
    }
  }
  const ms = Math.round(performance.now() - t0);
  const total = await countKeys(VALKEY_PREFIX);
  console.log(
    `files: ${entries.length + skipped.length} | loaded: ${entries.length} (${created} new, ${refreshed} refreshed, ${(bytes / 1e6).toFixed(1)} MB) | skipped: ${skipped.length} | ${ms} ms`,
  );
  console.log(`of which panel responses from the snapshot: ${routeEntries.length}`);
  console.log(`valkey keys under ${VALKEY_PREFIX}*: ${total} (includes the stats and live-usage keys) | cala calls: 0`);
  if (skipped.length) console.log(`skipped files: ${skipped.slice(0, 10).join(", ")}${skipped.length > 10 ? " ..." : ""}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => closeValkey());
