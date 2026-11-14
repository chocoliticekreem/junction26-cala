// data/cala-cache (gitignored) -> data/cala-snapshot.json (committed). No network.
//
//   npx tsx scripts/build-snapshot.ts
//
// Per investor: the entity the panel fetches (plain retrieve from the routes or prewarm, else the
// ingest's projected retrieve of the same id) and an answer to "What does X invest in?" (the
// panel's exact query if cached, else the ingest's stated-thesis search for X). Portfolio
// companies are added only when already cached. Keeps only the fields the panel displays.
import { promises as fs } from "node:fs";
import path from "node:path";
import { entitySources, searchSources, type CalaEntity, type CalaSearchResponse } from "../lib/cala";
import { snapshotNameKey, type CalaSnapshot, type SnapshotEntity, type SnapshotSearch } from "../lib/calaSnapshot";
import type { Investor } from "../lib/types";

const ROOT = path.resolve(__dirname, "..");
const CACHE = path.join(ROOT, "data/cala-cache");
const OUT = path.join(ROOT, "data/cala-snapshot.json");

const panelQuery = (name: string) => `What does ${name} invest in?`;
const thesisQuery = (name: string) =>
  `What does ${name} (London investor) say it invests in: which sectors, stages and cheque sizes? Who are its partners, and which startups has it backed since 2025?`;

type Entry = { key: string; value: unknown };

async function readCache() {
  const files = (await fs.readdir(CACHE)).filter((f) => f.endsWith(".json")).sort();
  const plain = new Map<string, CalaEntity>();
  const projected = new Map<string, CalaEntity>();
  const searches = new Map<string, CalaSearchResponse>();
  for (const f of files) {
    const { key, value } = JSON.parse(await fs.readFile(path.join(CACHE, f), "utf8")) as Entry;
    const ent = key.match(/^POST \/v1\/entities\/([0-9a-f-]{36}) (.*)$/i);
    if (ent) {
      const e = value as CalaEntity;
      if (e?.id !== ent[1]) continue;
      (ent[2] ? projected : plain).set(ent[1], e);
      continue;
    }
    const s = key.match(/^POST \/v1\/knowledge\/search (.*)$/);
    if (s) searches.set((JSON.parse(s[1]) as { input: string }).input, value as CalaSearchResponse);
  }
  return { plain, projected, searches };
}

function toEntity(e: CalaEntity): SnapshotEntity {
  const description = typeof e.description === "string" && e.description.trim() ? e.description.trim() : undefined;
  return {
    id: e.id,
    name: e.name,
    entity_type: e.entity_type,
    ...(description ? { description } : {}),
    sources: entitySources(e),
  };
}

function sortedObject<T>(entries: [string, T][]): Record<string, T> {
  return Object.fromEntries(entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

async function main() {
  const investors = JSON.parse(await fs.readFile(path.join(ROOT, "data/investors.json"), "utf8")) as Investor[];
  const cache = await readCache();
  const entities = new Map<string, SnapshotEntity>();
  const searches = new Map<string, SnapshotSearch>();
  const missingEntity: string[] = [];
  const missingSearch: string[] = [];

  for (const inv of investors) {
    if (inv.calaId) {
      const e = cache.plain.get(inv.calaId) ?? cache.projected.get(inv.calaId);
      if (e) entities.set(inv.calaId, toEntity(e));
      else missingEntity.push(inv.id);
    }
    const query = cache.searches.has(panelQuery(inv.name)) ? panelQuery(inv.name) : thesisQuery(inv.name);
    const r = cache.searches.get(query);
    if (!r) {
      missingSearch.push(inv.id);
      continue;
    }
    const key = snapshotNameKey(inv.name);
    const prev = searches.get(key);
    if (prev) throw new Error(`two investors share the name key "${key}": ${prev.investorId}, ${inv.id}`);
    searches.set(key, { investorId: inv.id, query, answer: r.content ?? "", sources: searchSources(r) });
  }

  let companies = 0;
  for (const id of new Set(investors.flatMap((i) => i.deals.map((d) => d.companyCalaId ?? "")))) {
    if (!id || entities.has(id)) continue;
    const e = cache.plain.get(id) ?? cache.projected.get(id);
    if (!e) continue;
    entities.set(id, toEntity(e));
    companies++;
  }

  const snap: CalaSnapshot = {
    version: 1,
    entities: sortedObject([...entities]),
    searches: sortedObject([...searches]),
  };
  const json = JSON.stringify(snap) + "\n";
  await fs.writeFile(OUT, json);

  const withId = investors.filter((i) => i.calaId).length;
  console.log(
    `investors ${investors.length} (${withId} with calaId): entities ${withId - missingEntity.length}/${withId}, ` +
      `searches ${searches.size}/${investors.length}, companies ${companies} | ${(json.length / 1024).toFixed(0)} KB -> ${path.relative(ROOT, OUT)}`,
  );
  if (missingEntity.length) console.log(`no cached entity: ${missingEntity.join(", ")}`);
  if (missingSearch.length) console.log(`no cached search: ${missingSearch.join(", ")}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
