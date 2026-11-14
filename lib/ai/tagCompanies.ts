// Batch company tagging for scripts/tag-cohort.ts and scripts/tag-deals.ts: Haiku reads up to
// BATCH_SIZE company descriptions per call and returns the nearest taxonomy sector plus 2-6
// fine-grained domain tags each. Results are cached per company id with a hash of the text they were
// read from (a changed description is re-tagged), so a re-run with nothing new makes no call.
import { createHash } from "node:crypto";
import { ALL_SECTORS, SECTORS, isSector, type Sector } from "@/lib/taxonomy";
import { cleanTags, type ToolCaller } from "./strict";

export const BATCH_SIZE = 25;

export type TagItem = { id: string; name: string; description?: string };
export type Tagged = { sector: Sector; tags: string[] };
export type CacheEntry = Tagged & { h: string };

export interface TagCache {
  get(id: string): Promise<CacheEntry | undefined>;
  set(id: string, entry: CacheEntry): Promise<void>;
}

export const TAG_TOOL = {
  name: "record_company_tags",
  description: "Record the nearest broad sector and fine-grained domain tags for every company given.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["companies"],
    properties: {
      companies: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "sector", "tags"],
          properties: {
            id: { type: "string", description: "The id exactly as given." },
            sector: { type: "string", enum: [...ALL_SECTORS] },
            tags: { type: "array", items: { type: "string" }, description: "2 to 6 short domain tags, e.g. EEG, neurotech, wearable." },
          },
        },
      },
    },
  },
};

const SYSTEM = `For each startup, read its name and description for meaning and return:
- sector: the nearest of ${SECTORS.join("; ")}; "other" only when nothing is close. Map a niche domain by what the product is and who pays (an EEG headband -> medtech/devices or deep tech/hardware; a defence drone -> deep tech/hardware).
- tags: 2 to 6 short, specific domain tags (e.g. "EEG", "neurotech", "wearable", "defence", "drones"). Not the sector name. [] when the description says nothing.
When there is no description, use only what you reliably know about that exact company; if unsure, "other" and []. Never invent facts. Return every id exactly once.`;

export const textHash = (it: TagItem) => createHash("sha1").update(`${it.name}\n${it.description ?? ""}`).digest("hex").slice(0, 12);

export async function tagBatch(items: TagItem[], call: ToolCaller): Promise<Map<string, Tagged>> {
  const user = JSON.stringify(items.map((i) => ({ id: i.id, name: i.name, description: (i.description ?? "").slice(0, 400) })));
  const out = (await call({ system: SYSTEM, user, tool: TAG_TOOL, maxTokens: 120 * items.length + 200, strict: true, timeoutMs: 60_000 })) as {
    companies?: unknown;
  } | null;
  const want = new Set(items.map((i) => i.id));
  const res = new Map<string, Tagged>();
  for (const c of Array.isArray(out?.companies) ? out.companies : []) {
    if (!c || typeof c !== "object") continue;
    const { id, sector, tags } = c as Record<string, unknown>;
    if (typeof id !== "string" || !want.has(id) || typeof sector !== "string" || !isSector(sector)) continue;
    res.set(id, { sector, tags: cleanTags(tags, 6) });
  }
  return res;
}

export type TagRun = { results: Map<string, Tagged>; cached: number; tagged: number; missing: string[]; calls: number };

// Cache first; the rest in batches. maxCalls bounds spend; ids left over are reported as missing.
export async function tagAll(
  items: TagItem[],
  opts: { call: ToolCaller; cache: TagCache; batchSize?: number; maxCalls?: number; log?: (m: string) => void },
): Promise<TagRun> {
  const results = new Map<string, Tagged>();
  const todo: TagItem[] = [];
  let cached = 0;
  for (const it of items) {
    const hit = await opts.cache.get(it.id);
    if (hit && hit.h === textHash(it)) {
      results.set(it.id, { sector: hit.sector, tags: hit.tags });
      cached++;
    } else todo.push(it);
  }
  const size = opts.batchSize ?? BATCH_SIZE;
  let calls = 0;
  let tagged = 0;
  const missing: string[] = [];
  for (let i = 0; i < todo.length; i += size) {
    const batch = todo.slice(i, i + size);
    if (opts.maxCalls !== undefined && calls >= opts.maxCalls) {
      missing.push(...batch.map((b) => b.id));
      continue;
    }
    calls++;
    let got = new Map<string, Tagged>();
    try {
      got = await tagBatch(batch, opts.call);
    } catch (e) {
      opts.log?.(`batch ${calls} failed: ${e instanceof Error ? e.message : e}`);
    }
    for (const it of batch) {
      const t = got.get(it.id);
      if (!t) {
        missing.push(it.id);
        continue;
      }
      results.set(it.id, t);
      await opts.cache.set(it.id, { ...t, h: textHash(it) });
      tagged++;
    }
    opts.log?.(`batch ${calls}: ${got.size}/${batch.length} tagged`);
  }
  return { results, cached, tagged, missing, calls };
}
