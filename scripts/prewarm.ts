// Fills data/cala-cache with exactly the requests the investor panel makes, so demo clicks cost
// no credits. Usage: npm run prewarm [-- <investor-id> ...] [--dry-run]
// Spends at most MAX_CALLS live calls per run, and every call also counts against CALA_LIVE_BUDGET.
import { promises as fs } from "node:fs";
import path from "node:path";
import { CalaBudgetError, LIVE_USAGE_FILE, createRouteCala, fileBudget, liveBudgetLimit, sessionBudget } from "../lib/cala";
import type { Investor } from "../lib/types";

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_IDS = ["zinc", "4bio-capital", "syncona", "london-business-angels", "medicxi"];
const MAX_CALLS = 15;

try {
  process.loadEnvFile(path.join(ROOT, ".env.local"));
} catch {
  // no .env.local: the dry run still works
}

// Must match components/ProfilePanel.tsx, or the prewarmed entries are never looked up.
const panelQuery = (inv: Investor) => `What does ${inv.name} invest in?`;

async function main() {
  const args = process.argv.slice(2);
  const ids = args.filter((a) => !a.startsWith("--"));
  const wanted = ids.length ? ids : DEFAULT_IDS;
  const investors = JSON.parse(await fs.readFile(path.join(ROOT, "data/investors.json"), "utf8")) as Investor[];
  const picked = wanted.map((id) => {
    const inv = investors.find((i) => i.id === id);
    if (!inv) throw new Error(`unknown investor id: ${id}`);
    return inv;
  });

  if (args.includes("--dry-run")) {
    for (const inv of picked) console.log(`${inv.id}: entity ${inv.calaId || "(none)"} + search "${panelQuery(inv)}"`);
    return;
  }
  if (!process.env.CALA_API_KEY) throw new Error("CALA_API_KEY missing: add it to .env.local");
  if (path.resolve(process.cwd()) !== ROOT) throw new Error(`run from the repo root (${ROOT}) so the cache path matches the app`);

  const cala = createRouteCala({ budget: sessionBudget(MAX_CALLS), log: console.warn });
  const jobs = picked.flatMap((inv) => [
    ...(inv.calaId ? [{ label: `${inv.id} entity`, run: () => cala.retrieve(inv.calaId) }] : []),
    { label: `${inv.id} search`, run: () => cala.search(panelQuery(inv)) },
  ]);

  let failed = 0;
  let budgetHit = false;
  await Promise.all(
    jobs.map(async (job) => {
      const before = cala.stats.calls;
      try {
        await job.run();
        console.log(`${job.label}: ${cala.stats.calls > before ? "live" : "cache hit"}`);
      } catch (e) {
        failed++;
        if (e instanceof CalaBudgetError) budgetHit = true;
        console.error(`${job.label}: FAILED ${e instanceof Error ? e.message : e}`);
      }
    }),
  );

  const usage = await fileBudget(LIVE_USAGE_FILE, liveBudgetLimit()).usage();
  console.log(
    `\ncalls spent: ${cala.stats.calls} (ok ${cala.stats.ok}, retries ${cala.stats.retries}) | cache hits: ${cala.stats.cacheHits} | live budget used ${usage.used}/${usage.limit}`,
  );
  if (budgetHit) console.error(`stopped: per-run cap (${MAX_CALLS}) or CALA_LIVE_BUDGET reached`);
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
