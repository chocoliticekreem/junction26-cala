// Tags every cohort company with Haiku: the nearest taxonomy sector and 2-6 fine-grained domain
// tags ("EEG", "neurotech"), written back into the cohort file as `tags` (and `sector`, only where
// the ingest left it as "other"). Cached by company id in data/ai-cache/ and Valkey, so re-runs
// (including after a fresh ingest) only pay for new or changed descriptions.
// Usage: npx tsx scripts/tag-cohort.ts [--file data/cohort.json] [--max-calls 40] [--dry-run]
import { promises as fs } from "node:fs";
import path from "node:path";
import { haikuTool } from "../lib/anthropic";
import { fileValkeyTagCache } from "../lib/ai/tagCache";
import { BATCH_SIZE, tagAll, type TagItem } from "../lib/ai/tagCompanies";
import type { Cohort } from "../lib/sim/types";
import { closeValkey } from "../lib/valkey";

const ROOT = path.resolve(__dirname, "..");
try {
  process.loadEnvFile(path.join(ROOT, ".env.local"));
} catch {
  // no .env.local: ANTHROPIC_API_KEY may come from the shell
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const file = path.resolve(ROOT, arg("--file") ?? "data/cohort.json");
  const maxCalls = Number(arg("--max-calls") ?? 40);
  const dry = process.argv.includes("--dry-run");
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch {
    throw new Error(`${path.relative(ROOT, file)} not found: run the cohort ingest first, or pass --file data/cohort.fixture.json`);
  }
  const cohort = JSON.parse(raw) as Cohort;
  const indent = raw.match(/\n( +)"/)?.[1].length ?? 2;
  const items: TagItem[] = Object.values(cohort.companies).map((c) => ({ id: c.id, name: c.name, description: c.description }));
  const cache = await fileValkeyTagCache(path.basename(file, ".json"));
  if (dry) {
    let hits = 0;
    for (const it of items) if (await cache.get(it.id)) hits++;
    console.log(`${items.length} companies, ~${hits} cached, ~${Math.ceil((items.length - hits) / BATCH_SIZE)} calls needed`);
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY missing: add it to .env.local");

  const run = await tagAll(items, { call: haikuTool, cache, maxCalls, log: (m) => console.log(m) });
  await cache.flush();
  let tagged = 0;
  let resectored = 0;
  for (const co of Object.values(cohort.companies)) {
    const t = run.results.get(co.id);
    if (!t) continue;
    co.tags = t.tags;
    tagged++;
    if (co.sector === "other" && t.sector !== "other") {
      co.sector = t.sector;
      resectored++;
    }
  }
  await fs.writeFile(file, JSON.stringify(cohort, null, indent) + "\n");
  console.log(
    `${items.length} companies: ${run.cached} from cache, ${run.tagged} newly tagged in ${run.calls} Haiku calls, ` +
      `${run.missing.length} missing; ${tagged} written with tags, ${resectored} moved off "other" -> ${path.relative(ROOT, file)}`,
  );
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => closeValkey());
