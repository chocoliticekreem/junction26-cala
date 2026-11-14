// Discovers which Cala relationships link a London investor to its rounds and companies.
// Usage: npx tsx scripts/introspect.ts [--dry-run]
// Writes data/raw/introspect.json and prints a markdown summary for docs/CALA.md.
import { promises as fs } from "node:fs";
import path from "node:path";
import { createCalaClient, diskCache, investorKey, type CalaEntityMention } from "../lib/cala";

const FUNDS = ["Seedcamp", "LocalGlobe", "Balderton Capital", "Index Ventures", "Kindred Capital"];
const ROOT = path.resolve(__dirname, "..");

try {
  process.loadEnvFile(path.join(ROOT, ".env.local"));
} catch {
  // no .env.local: the dry run still works
}

function pickEntity(name: string, candidates: CalaEntityMention[]): CalaEntityMention | undefined {
  const key = investorKey(name);
  const same = candidates.filter((c) => investorKey(c.name) === key);
  const london = same.filter((c) => /london|united kingdom|\buk\b/i.test(c.description ?? ""));
  const pool = london.length ? london : same.length ? same : candidates;
  return pool.find((c) => c.entity_type === "Organization") ?? pool[0];
}

async function main() {
  if (process.argv.includes("--dry-run")) {
    console.log(`dry run: would entity-search + introspect + sample-retrieve ${FUNDS.join(", ")} (~${FUNDS.length * 3} calls)`);
    return;
  }
  const cala = createCalaClient({ cache: diskCache(path.join(ROOT, "data/cala-cache")), log: console.warn });
  const out: Record<string, unknown>[] = [];
  for (const fund of FUNDS) {
    const { entities } = await cala.searchEntities(fund, ["Organization", "Company"]);
    const ent = pickEntity(fund, entities);
    if (!ent) {
      out.push({ fund, error: "no entity" });
      continue;
    }
    const intro = await cala.introspect(ent.id);
    const outgoing = Object.fromEntries(intro.relationships.outgoing.map((r) => [r, { limit: 3 }]));
    const incoming = Object.fromEntries(intro.relationships.incoming.map((r) => [r, { limit: 3 }]));
    const sample = await cala.retrieve(ent.id, { properties: intro.properties, relationships: { outgoing, incoming } });
    out.push({
      fund,
      variants: entities.filter((e) => investorKey(e.name) === investorKey(fund)).map((e) => `${e.name} (${e.entity_type})`),
      entity: { id: ent.id, name: ent.name, type: ent.entity_type, description: ent.description },
      properties: intro.properties,
      relationships: intro.relationships,
      sample: Object.fromEntries(
        Object.entries({ ...sample.relationships.outgoing, ...sample.relationships.incoming }).map(([rel, edges]) => [
          rel,
          edges.map((e) => `${e.name} (${e.entity_type})${e.properties?.event_date ? " " + e.properties.event_date : ""}`),
        ]),
      ),
    });
  }
  await fs.mkdir(path.join(ROOT, "data/raw"), { recursive: true });
  await fs.writeFile(path.join(ROOT, "data/raw/introspect.json"), JSON.stringify(out, null, 2));

  console.log("| Fund | Entity used | Variants | Properties | Outgoing | Incoming |\n|---|---|---|---|---|---|");
  for (const r of out as Record<string, never>[]) {
    if (r.error) {
      console.log(`| ${r.fund} | none | | | | |`);
      continue;
    }
    const e = r.entity as { id: string; name: string; type: string };
    const rel = r.relationships as { outgoing: string[]; incoming: string[] };
    console.log(
      `| ${r.fund} | ${e.name} (${e.type}, \`${e.id}\`) | ${(r.variants as string[]).length} | ${(r.properties as string[]).join(", ")} | ${rel.outgoing.join(", ") || "none"} | ${rel.incoming.join(", ") || "none"} |`,
    );
  }
  console.log("\nSamples:", JSON.stringify(out.map((r) => ({ fund: r.fund, sample: r.sample })), null, 1));
  console.log(`\nCala calls: ${cala.stats.ok} ok, ${cala.stats.calls} requests (cache hits ${cala.stats.cacheHits})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
