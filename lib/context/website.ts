// Website side of the account memory: Context.dev scrapes the company site to markdown, Haiku pulls
// product, customers, pricing and team out of it. Server-only: reads CONTEXT_DEV_API_KEY.
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { haikuTool } from "@/lib/anthropic";
import { isReadOnlyFsError } from "@/lib/cala";
import { valkeyGetJson, valkeySetJson } from "@/lib/valkey";
import { domainOf } from "./calaFacts";
import type { WebsiteFacts } from "./types";

const CONTEXT_DEV_BASE = "https://api.context.dev/v1";
const CACHE_PREFIX = "room:ctxdev:v1:";
const CACHE_TTL_SECONDS = 30 * 24 * 3600;
const MAX_MARKDOWN = 12_000;
// Hard cap on live Context.dev calls per checkout (credits). Cached pages do not count.
const LIVE_LIMIT = 40;

export const CONTEXT_CACHE_DIR = path.join(/* turbopackIgnore: true */ process.cwd(), "data", "context-cache");
const USAGE_FILE = path.join(CONTEXT_CACHE_DIR, ".usage.json");

export type ScrapedPage = { url: string; title?: string; description?: string; markdown: string };

export const contextDevStats = { live: 0, cached: 0 };

function cacheFile(key: string) {
  return path.join(CONTEXT_CACHE_DIR, createHash("sha1").update(key).digest("hex") + ".json");
}

async function cacheGet(key: string): Promise<ScrapedPage | undefined> {
  const hash = createHash("sha1").update(key).digest("hex");
  const v = (await valkeyGetJson(CACHE_PREFIX + hash)) as ScrapedPage | undefined;
  if (v?.markdown !== undefined) return v;
  try {
    const page = JSON.parse(await fs.readFile(cacheFile(key), "utf8")).value as ScrapedPage;
    void valkeySetJson(CACHE_PREFIX + hash, page, CACHE_TTL_SECONDS);
    return page;
  } catch {
    return undefined;
  }
}

async function cacheSet(key: string, page: ScrapedPage) {
  const hash = createHash("sha1").update(key).digest("hex");
  void valkeySetJson(CACHE_PREFIX + hash, page, CACHE_TTL_SECONDS);
  try {
    await fs.mkdir(CONTEXT_CACHE_DIR, { recursive: true });
    await fs.writeFile(cacheFile(key), JSON.stringify({ key, at: new Date().toISOString(), value: page }));
  } catch (e) {
    if (!isReadOnlyFsError(e)) throw e;
  }
}

async function consumeLive(): Promise<boolean> {
  let used = 0;
  try {
    used = Number(JSON.parse(await fs.readFile(USAGE_FILE, "utf8")).used) || 0;
  } catch {}
  if (used >= LIVE_LIMIT) return false;
  try {
    await fs.mkdir(CONTEXT_CACHE_DIR, { recursive: true });
    await fs.writeFile(USAGE_FILE, JSON.stringify({ used: used + 1, limit: LIVE_LIMIT }));
  } catch (e) {
    if (!isReadOnlyFsError(e)) throw e;
  }
  return true;
}

export function normaliseSiteUrl(website: string): string | undefined {
  const d = domainOf(website);
  return d ? `https://${d}` : undefined;
}

// undefined when the key is missing, the budget is spent or the scrape fails: the doc is built
// without website facts rather than failing.
export async function scrapePage(url: string): Promise<ScrapedPage | undefined> {
  const key = `scrape ${url}`;
  const hit = await cacheGet(key);
  if (hit) {
    contextDevStats.cached++;
    return hit;
  }
  const apiKey = process.env.CONTEXT_DEV_API_KEY;
  if (!apiKey || process.env.E2E_MOCK === "1") return undefined;
  if (!(await consumeLive())) {
    console.warn("context.dev: live budget spent; skipping website facts");
    return undefined;
  }
  contextDevStats.live++;
  try {
    const res = await fetch(`${CONTEXT_DEV_BASE}/web/scrape`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ url, formats: { markdown: true }, sharedParams: { mainContentOnly: true } }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) {
      console.warn(`context.dev ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return undefined;
    }
    const json = (await res.json()) as {
      markdown?: { data?: string | null };
      metadata?: { title?: string; description?: string };
    };
    const markdown = json.markdown?.data ?? "";
    if (!markdown.trim()) return undefined;
    const page: ScrapedPage = { url, markdown: markdown.slice(0, MAX_MARKDOWN) };
    if (json.metadata?.title) page.title = json.metadata.title;
    if (json.metadata?.description) page.description = json.metadata.description;
    await cacheSet(key, page);
    return page;
  } catch (e) {
    console.warn("context.dev:", e instanceof Error ? e.message : e);
    return undefined;
  }
}

export const WEBSITE_TOOL = {
  name: "record_website_facts",
  description: "Record facts the company website states. Leave a field empty when the page does not state it.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      product: { type: "string", description: "What the product is and does, one or two sentences, from the page. Empty if unclear." },
      customers: { type: "array", items: { type: "string" }, description: "Named customers or logos on the page. Never infer." },
      pricing: { type: "string", description: "Pricing model or plans as stated. Empty if the page has none." },
      team: { type: "array", items: { type: "string" }, description: "Named team members with role, e.g. 'Jane Doe, CEO'." },
    },
    required: ["product", "customers", "pricing", "team"],
  },
};

const SYSTEM = `You read a company's website (as markdown) and record only what it states.
Never guess customers, prices or people; leave fields empty instead. Be terse.`;

export function parseWebsiteFacts(raw: unknown, url: string, title?: string): WebsiteFacts {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 400) : undefined);
  const list = (v: unknown) =>
    Array.isArray(v) ? [...new Set(v.map(str).filter((s): s is string => !!s))].slice(0, 12) : [];
  const facts: WebsiteFacts = {
    url,
    customers: list(o.customers),
    team: list(o.team),
    source: { name: title?.trim() || (domainOf(url) ?? url), url, rank: "PRIMARY" },
  };
  const product = str(o.product);
  if (product) facts.product = product;
  const pricing = str(o.pricing);
  if (pricing) facts.pricing = pricing;
  return facts;
}

export async function fetchWebsiteFacts(website: string): Promise<WebsiteFacts | undefined> {
  const url = normaliseSiteUrl(website);
  if (!url) return undefined;
  const page = await scrapePage(url);
  if (!page) return undefined;
  let raw: unknown = null;
  try {
    raw = await haikuTool({
      system: SYSTEM,
      user: `Website ${url}\nTitle: ${page.title ?? ""}\nDescription: ${page.description ?? ""}\n\n${page.markdown}`,
      tool: WEBSITE_TOOL,
      maxTokens: 700,
      strict: true,
    });
  } catch (e) {
    console.warn("website facts:", e instanceof Error ? e.message : e);
  }
  if (!raw && page.description) raw = { product: page.description };
  return parseWebsiteFacts(raw, url, page.title);
}
