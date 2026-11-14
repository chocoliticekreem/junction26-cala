// Tags the investors' deals whose sector is "other" with Haiku, into the overlay data/deal-tags.json
// keyed by company id (Cala id, else "name:<lowercased name>"). lib/data.ts applies the overlay at
// load time; data/investors.json itself is never edited. Cached in data/ai-cache/ and Valkey.
// Usage: npx tsx scripts/tag-deals.ts [--max-calls 10] [--dry-run]
import { promises as fs } from "node:fs";
import path from "node:path";
import { haikuTool } from "../lib/anthropic";
import { fileValkeyTagCache } from "../lib/ai/tagCache";
import { BATCH_SIZE, tagAll, type TagItem, type Tagged } from "../lib/ai/tagCompanies";
import { dealKey } from "../lib/data";
import type { Investor } from "../lib/types";
import { closeValkey } from "../lib/valkey";

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "data", "deal-tags.json");
try {
  process.loadEnvFile(path.join(ROOT, ".env.local"));
} catch {
  // no .env.local: ANTHROPIC_API_KEY may come from the shell
}

async function main() {
  const i = process.argv.indexOf("--max-calls");
  const maxCalls = i >= 0 ? Number(process.argv[i + 1]) : 10;
  const investors = JSON.parse(await fs.readFile(path.join(ROOT, "data", "investors.json"), "utf8")) as Investor[];
  const items = new Map<string, TagItem>();
  for (const inv of investors) {
    for (const d of inv.deals) if (d.sector === "other") items.set(dealKey(d), { id: dealKey(d), name: d.company });
  }
  const cache = await fileValkeyTagCache("deal-tags");
  if (process.argv.includes("--dry-run")) {
    console.log(`${items.size} "other"-sector deal companies, up to ${Math.ceil(items.size / BATCH_SIZE)} calls`);
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY missing: add it to .env.local");
  const run = await tagAll([...items.values()], { call: haikuTool, cache, maxCalls, log: (m) => console.log(m) });
  await cache.flush();
  const out: Record<string, Tagged> = {};
  // Deals carry only a company name, so Haiku often (rightly) declines; those stay in the cache only.
  for (const id of [...run.results.keys()].sort()) {
    const t = run.results.get(id)!;
    if (t.sector !== "other" || t.tags.length) out[id] = t;
  }
  await fs.writeFile(OUT, JSON.stringify(out, null, 1) + "\n");
  const moved = Object.values(out).filter((t) => t.sector !== "other").length;
  console.log(
    `${items.size} companies: ${run.cached} from cache, ${run.tagged} newly tagged in ${run.calls} Haiku calls, ` +
      `${run.missing.length} missing; ${moved} get a taxonomy sector -> data/deal-tags.json`,
  );
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => closeValkey());
