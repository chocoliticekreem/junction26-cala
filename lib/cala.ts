// Server-only Cala client. Never import from a client component: it reads CALA_API_KEY.
// (No `server-only` import because scripts/ingest.ts also runs this under tsx.)
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { recordTier, type CacheTier } from "./cacheStats";
import type { Deal, Source, Stage } from "./types";
import { VALKEY_PREFIX, valkeyDecr, valkeyGetJson, valkeyGetNumber, valkeyIncr, valkeySetJson } from "./valkey";

export const CALA_BASE = "https://api.cala.ai";

export type CalaRawSource = {
  name?: string;
  document?: unknown;
  date?: string;
  url?: string;
  date_precision?: string;
  source_rank?: string;
};

export type CalaEntityMention = {
  id: string;
  name: string;
  entity_type: string;
  mentions?: string[];
  description?: string | null;
};

export type CalaQueryResponse = {
  results: Record<string, unknown>[];
  entities: CalaEntityMention[] | null;
};

export type CalaOrigin = {
  source?: { name?: string; url?: string };
  document?: { name?: string; url?: string };
};

export type CalaKnowBit = { id: string; content: string; origins: CalaOrigin[] };

export type CalaSearchResponse = {
  content: string;
  explainability?: { content: string; references: string[] }[] | null;
  context: CalaKnowBit[];
  entities: CalaEntityMention[] | null;
};

export type CalaEdge = {
  id: string;
  name: string;
  entity_type: string;
  properties?: { sources?: CalaRawSource[]; [k: string]: unknown };
};

export type CalaEntity = {
  id: string;
  name: string;
  entity_type: string;
  description?: string | null;
  properties: Record<string, { value: unknown; sources?: CalaRawSource[] }>;
  relationships: { outgoing?: Record<string, CalaEdge[]>; incoming?: Record<string, CalaEdge[]> };
};

export type CalaIntrospection = {
  properties: string[];
  relationships: { outgoing: string[]; incoming: string[] };
  numerical_observations: Record<string, unknown>;
};

export type CalaProjection = {
  properties?: string[];
  relationships?: {
    outgoing?: Record<string, { limit?: number; offset?: number }>;
    incoming?: Record<string, { limit?: number; offset?: number }>;
  };
};

export class CalaError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

// Thrown instead of calling Cala when the live-call budget is spent. No request was sent.
export class CalaBudgetError extends CalaError {
  constructor() {
    super("Cala live budget exhausted", 402);
  }
}

// ---------- caches ----------

export interface CalaCache {
  // Which tier answered, for the route's `source` field and the per-tier stats.
  readonly tier?: CacheTier;
  get(key: string): Promise<unknown | undefined>;
  set(key: string, value: unknown): Promise<void>;
  lookup?(key: string): Promise<{ value: unknown; tier: CacheTier } | undefined>;
}

// One request key -> one hash, shared by the file cache (file name) and Valkey (key suffix), so
// scripts/seed-valkey.ts can load the file cache without re-deriving any request.
export function cacheKeyHash(key: string): string {
  return createHash("sha1").update(key).digest("hex");
}

export class MemoryLRU implements CalaCache {
  readonly tier = "memory" as const;
  private map = new Map<string, unknown>();
  constructor(private readonly max = 500) {}
  async get(key: string) {
    if (!this.map.has(key)) return undefined;
    const v = this.map.get(key);
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }
  async set(key: string, value: unknown) {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value as string;
      this.map.delete(oldest);
    }
  }
}

// A deploy (e.g. Vercel) has a read-only filesystem: writes fail with EROFS, EACCES/EPERM, or
// ENOENT when the cache folder was never shipped and cannot be created.
export function isReadOnlyFsError(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  return code === "EROFS" || code === "EACCES" || code === "EPERM" || code === "ENOENT";
}

// On a read-only filesystem the cache stops writing and acts as read-only (usually empty).
export function diskCache(dir: string): CalaCache {
  let readOnly = false;
  const file = (key: string) => path.join(dir, cacheKeyHash(key) + ".json");
  return {
    tier: "file",
    async get(key) {
      try {
        return JSON.parse(await fs.readFile(file(key), "utf8")).value;
      } catch {
        return undefined;
      }
    },
    async set(key, value) {
      if (readOnly) return;
      try {
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(file(key), JSON.stringify({ key, at: new Date().toISOString(), value }));
      } catch (e) {
        if (!isReadOnlyFsError(e)) throw e;
        readOnly = true;
      }
    },
  };
}

// Aiven Valkey, shared by every server instance and script run. Values are the raw Cala JSON.
// Writes are not awaited, so a slow Valkey never delays a response that is already in hand.
export function valkeyCache(ttlSeconds?: number): CalaCache {
  return {
    tier: "valkey",
    get: (key) => valkeyGetJson(VALKEY_PREFIX + cacheKeyHash(key)),
    async set(key, value) {
      void valkeySetJson(VALKEY_PREFIX + cacheKeyHash(key), value, ttlSeconds);
    },
  };
}

// Read-through in order; a hit in a later layer is copied into the earlier ones (a file-cache hit
// back-fills Valkey and memory). Records a miss for each tier passed and a hit for the one that
// answered.
export function tieredCache(...layers: CalaCache[]): CalaCache {
  async function lookup(key: string) {
    for (let i = 0; i < layers.length; i++) {
      const t0 = performance.now();
      const v = await layers[i].get(key);
      const tier = layers[i].tier;
      if (tier) recordTier(tier, v !== undefined, performance.now() - t0);
      if (v === undefined) continue;
      await Promise.all(layers.slice(0, i).map((l) => l.set(key, v)));
      return { value: v, tier: tier ?? ("memory" as const) };
    }
    return undefined;
  }
  return {
    lookup,
    async get(key) {
      return (await lookup(key))?.value;
    },
    async set(key, value) {
      await Promise.all(layers.map((l) => l.set(key, value)));
    },
  };
}

// ---------- live-call budget ----------

export interface CalaBudget {
  // Reserves one live call. false = budget spent, do not send the request.
  tryConsume(): Promise<boolean>;
}

export type BudgetUsage = { used: number; limit: number };

// Counts live calls in a JSON file so the cap survives restarts. Consumes are serialised within
// the process so concurrent route calls cannot overshoot. Delete the file to reset the count.
// If the file cannot be written (read-only deploy), counting continues in memory with the same
// cap, so the limit then holds per server instance only.
export function fileBudget(file: string, limit: number): CalaBudget & { usage(): Promise<BudgetUsage> } {
  let chain: Promise<unknown> = Promise.resolve();
  let memoryUsed: number | undefined;
  const read = async (): Promise<number> => {
    if (memoryUsed !== undefined) return memoryUsed;
    try {
      const used = Number(JSON.parse(await fs.readFile(file, "utf8")).used);
      return Number.isFinite(used) && used > 0 ? used : 0;
    } catch {
      return 0;
    }
  };
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => undefined);
    return next;
  };
  return {
    usage: () => serial(async () => ({ used: await read(), limit })),
    tryConsume: () =>
      serial(async () => {
        const used = await read();
        if (used >= limit) return false;
        if (memoryUsed !== undefined) {
          memoryUsed = used + 1;
          return true;
        }
        try {
          await fs.mkdir(path.dirname(file), { recursive: true });
          await fs.writeFile(file, JSON.stringify({ used: used + 1, updatedAt: new Date().toISOString() }));
        } catch (e) {
          if (!isReadOnlyFsError(e)) throw e;
          memoryUsed = used + 1;
        }
        return true;
      }),
  };
}

export const LIVE_USAGE_KEY = `${VALKEY_PREFIX}live-usage`;

// The live-call cap shared by every instance: an atomic INCR on LIVE_USAGE_KEY in Valkey, so it
// holds across serverless instances and cold starts. A refused call is DECRemented back, so the
// count is calls actually allowed. Falls back to the per-checkout file counter whenever Valkey is
// not configured or does not answer.
export function sharedBudget(
  file: string,
  limit: number,
): CalaBudget & { usage(): Promise<BudgetUsage & { shared: boolean }> } {
  const fallback = fileBudget(file, limit);
  return {
    async tryConsume() {
      const n = await valkeyIncr(LIVE_USAGE_KEY);
      if (n === undefined) return fallback.tryConsume();
      if (n <= limit) return true;
      await valkeyDecr(LIVE_USAGE_KEY);
      return false;
    },
    async usage() {
      const used = await valkeyGetNumber(LIVE_USAGE_KEY);
      if (used === undefined) return { ...(await fallback.usage()), shared: false };
      return { used, limit, shared: true };
    },
  };
}

// In-memory cap for one script run.
export function sessionBudget(limit: number): CalaBudget {
  let used = 0;
  return {
    async tryConsume() {
      if (used >= limit) return false;
      used++;
      return true;
    },
  };
}

export function allBudgets(...budgets: CalaBudget[]): CalaBudget {
  return {
    async tryConsume() {
      for (const b of budgets) if (!(await b.tryConsume())) return false;
      return true;
    },
  };
}

export const DEFAULT_LIVE_BUDGET = 150;

export function liveBudgetLimit(raw = process.env.CALA_LIVE_BUDGET): number {
  const n = raw === undefined || raw.trim() === "" ? NaN : Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_LIVE_BUDGET;
}

// ---------- client ----------

function semaphore(n: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= n) await new Promise<void>((r) => queue.push(r));
    active++;
    try {
      return await fn();
    } finally {
      active--;
      queue.shift()?.();
    }
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type CalaClientOptions = {
  apiKey?: string;
  cache?: CalaCache;
  concurrency?: number;
  maxRetries?: number;
  // false: a timeout or network error fails at once. The request may have reached Cala and been
  // billed, so retrying could pay twice.
  retryNetworkErrors?: boolean;
  budget?: CalaBudget;
  timeoutMs?: number;
  log?: (msg: string) => void;
};

export type CalaMeta<T> = { value: T; source: CacheTier; latencyMs: number };

// calls = HTTP requests sent (incl. 429 retries); ok = successful responses (what uses credits).
export type CalaStats = { calls: number; ok: number; cacheHits: number; retries: number; byEndpoint: Record<string, number> };

export function createCalaClient(opts: CalaClientOptions = {}) {
  const apiKey = opts.apiKey ?? process.env.CALA_API_KEY;
  const limit = semaphore(opts.concurrency ?? 4);
  const maxRetries = opts.maxRetries ?? 8;
  const retryNetworkErrors = opts.retryNetworkErrors ?? true;
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const stats: CalaStats = { calls: 0, ok: 0, cacheHits: 0, retries: 0, byEndpoint: {} };

  async function lookup(key: string): Promise<{ value: unknown; tier: CacheTier } | undefined> {
    const cache = opts.cache;
    if (!cache) return undefined;
    if (cache.lookup) return cache.lookup(key);
    const value = await cache.get(key);
    return value === undefined ? undefined : { value, tier: cache.tier ?? "memory" };
  }

  async function request<T>(method: "GET" | "POST", p: string, body?: unknown, endpoint = p): Promise<CalaMeta<T>> {
    if (!apiKey) throw new CalaError("CALA_API_KEY not set", 401);
    const t0 = performance.now();
    const key = `${method} ${p} ${body === undefined ? "" : JSON.stringify(body)}`;
    const hit = await lookup(key);
    if (hit !== undefined) {
      stats.cacheHits++;
      return { value: hit.value as T, source: hit.tier, latencyMs: Math.round(performance.now() - t0) };
    }
    const value = await limit(async () => {
      for (let attempt = 0; ; attempt++) {
        let status = 0;
        let retryAfter = 0;
        if (opts.budget && !(await opts.budget.tryConsume())) {
          recordTier("live", false, 0);
          throw new CalaBudgetError();
        }
        const tLive = performance.now();
        try {
          stats.calls++;
          const res = await fetch(CALA_BASE + p, {
            method,
            headers: { "X-API-KEY": apiKey, "content-type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(timeoutMs),
          });
          status = res.status;
          if (res.ok) {
            const json = (await res.json()) as T;
            recordTier("live", true, performance.now() - tLive);
            stats.ok++;
            stats.byEndpoint[endpoint] = (stats.byEndpoint[endpoint] ?? 0) + 1;
            return json;
          }
          recordTier("live", false, 0);
          retryAfter = Number(res.headers.get("retry-after")) || 0;
          const text = (await res.text()).slice(0, 300);
          if (status !== 429 && status < 500) throw new CalaError(`Cala ${status}: ${text}`, status);
        } catch (e) {
          if (e instanceof CalaError) throw e;
          recordTier("live", false, 0);
          if (!retryNetworkErrors) throw new CalaError(`Cala request failed: ${e instanceof Error ? e.name : e}`, status || 599);
          status = status || 599;
        }
        if (attempt >= maxRetries) throw new CalaError(`Cala ${status} after ${attempt + 1} attempts`, status);
        stats.retries++;
        const wait = Math.min(60_000, Math.max(retryAfter * 1000, 1000 * 2 ** attempt)) + Math.random() * 1000;
        opts.log?.(`cala ${status} on ${endpoint}, retry ${attempt + 1} in ${Math.round(wait)}ms`);
        await sleep(wait);
      }
    });
    await opts.cache?.set(key, value);
    return { value, source: "live", latencyMs: Math.round(performance.now() - t0) };
  }

  const searchMeta = (input: string, explainability = false) =>
    request<CalaSearchResponse>("POST", "/v1/knowledge/search", { input, explainability }, "knowledge/search");
  const retrieveMeta = (id: string, projection?: CalaProjection) =>
    request<CalaEntity>("POST", `/v1/entities/${encodeURIComponent(id)}`, projection, "entities/retrieve");
  const unwrap = async <T,>(p: Promise<CalaMeta<T>>): Promise<T> => (await p).value;

  return {
    stats,
    configured: Boolean(apiKey),
    query: (input: string) =>
      unwrap(request<CalaQueryResponse>("POST", "/v1/knowledge/query", { input }, "knowledge/query")),
    search: (input: string, explainability = false) => unwrap(searchMeta(input, explainability)),
    searchEntities: (name: string, types: string[] = []) => {
      const qs = new URLSearchParams({ name: name.slice(0, 100) });
      for (const t of types) qs.append("entity_types", t);
      return unwrap(request<{ entities: CalaEntityMention[] }>("GET", `/v1/entities?${qs}`, undefined, "entities/search"));
    },
    introspect: (id: string) =>
      unwrap(
        request<CalaIntrospection>("GET", `/v1/entities/${encodeURIComponent(id)}/introspection`, undefined, "entities/introspection"),
      ),
    retrieve: (id: string, projection?: CalaProjection) => unwrap(retrieveMeta(id, projection)),
    // The same requests, plus which tier answered and how long it took (for the routes).
    withMeta: { search: searchMeta, retrieve: retrieveMeta },
  };
}

export type CalaClient = ReturnType<typeof createCalaClient>;

// ---------- source helpers ----------

export function toSource(s: CalaRawSource): Source | undefined {
  const name = typeof s.name === "string" && s.name.trim() ? s.name.trim() : undefined;
  const url =
    typeof s.url === "string" && /^https?:\/\//.test(s.url)
      ? s.url
      : typeof s.document === "string" && /^https?:\/\//.test(s.document)
        ? s.document
        : undefined;
  if (!name && !url) return undefined;
  const out: Source = { name: name ?? new URL(url!).hostname };
  if (url) out.url = url;
  if (typeof s.date === "string" && s.date) out.date = s.date;
  return out;
}

export function originToSource(o: CalaOrigin): Source | undefined {
  const url = o.document?.url || o.source?.url;
  const name = o.document?.name || o.source?.name;
  return toSource({ name, url });
}

export function dedupeSources(sources: (Source | undefined)[], max = 8): Source[] {
  const seen = new Set<string>();
  const out: Source[] = [];
  for (const s of sources) {
    if (!s) continue;
    const k = s.url ?? s.name;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

export function searchSources(r: CalaSearchResponse, max = 8): Source[] {
  return dedupeSources(r.context.flatMap((k) => k.origins.map(originToSource)), max);
}

export function entitySources(e: CalaEntity, max = 12): Source[] {
  const all: (Source | undefined)[] = [];
  for (const p of Object.values(e.properties ?? {})) for (const s of p.sources ?? []) all.push(toSource(s));
  for (const dir of [e.relationships?.outgoing, e.relationships?.incoming])
    for (const edges of Object.values(dir ?? {}))
      for (const edge of edges) for (const s of edge.properties?.sources ?? []) all.push(toSource(s));
  return dedupeSources(all, max);
}

// ---------- normalisation (pure) ----------


const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

function monthOf(word: string): number | undefined {
  if (word.length < 3) return undefined;
  const i = MONTH_NAMES.findIndex((m) => m.startsWith(word));
  if (i >= 0) return i + 1;
  return word === "sept" ? 9 : undefined;
}

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

export type NormalisedDate = { date?: string; approximate: boolean };

// Cala returns free-text dates ("1 Oct 2025", "Late 2025", "Q3 2025", "2025"). Anything
// coarser than a day is pinned to a representative day and flagged approximate.
export function normaliseDate(raw: unknown): NormalisedDate {
  if (typeof raw !== "string") return { approximate: false };
  const s = raw.trim().toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ");
  if (!s) return { approximate: false };
  let m = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return { date: iso(+m[1], +m[2], +m[3]), approximate: false };
  m = s.match(/\b(\d{4})-(\d{2})\b/);
  if (m && +m[2] >= 1 && +m[2] <= 12) return { date: iso(+m[1], +m[2], 15), approximate: true };
  const yearM = s.match(/\b(20\d{2}|19\d{2})\b/);
  if (!yearM) return { approximate: false };
  const y = +yearM[1];
  m = s.match(/\b(\d{1,2})(?:st|nd|rd|th)? ([a-z]{3,9})\b/);
  if (m && monthOf(m[2]) && +m[1] >= 1 && +m[1] <= 31)
    return { date: iso(y, monthOf(m[2])!, +m[1]), approximate: false };
  m = s.match(/\b([a-z]{3,9}) (\d{1,2})(?:st|nd|rd|th)?\b/);
  if (m && monthOf(m[1]) && +m[2] >= 1 && +m[2] <= 31 && !/^(20|19)\d\d$/.test(m[2]))
    return { date: iso(y, monthOf(m[1])!, +m[2]), approximate: false };
  m = s.match(/\bq([1-4])\b/);
  if (m) return { date: iso(y, [2, 5, 8, 11][+m[1] - 1], 15), approximate: true };
  m = s.match(/\bh([12])\b/);
  if (m) return { date: iso(y, m[1] === "1" ? 4 : 10, 1), approximate: true };
  if (/\b(early|beginning|start)\b/.test(s)) return { date: iso(y, 2, 1), approximate: true };
  if (/\b(mid|middle)\b/.test(s)) return { date: iso(y, 6, 1), approximate: true };
  if (/\b(late|end)\b/.test(s)) return { date: iso(y, 10, 1), approximate: true };
  for (const word of s.split(/[\s/.-]+/)) {
    const mo = monthOf(word);
    if (mo) return { date: iso(y, mo, 15), approximate: true };
  }
  return { date: iso(y, 7, 1), approximate: true };
}

export const FX_TO_USD = { USD: 1, GBP: 1.27, EUR: 1.08 } as const;
type Ccy = keyof typeof FX_TO_USD;

const SCALE: Record<string, number> = {
  k: 1e3, thousand: 1e3, m: 1e6, mn: 1e6, mm: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9,
};

// "~$2.7M", "$1.6M (€1.3M)", "£500k", "€12.6M (~£10.9M)", "US$35,000,000" -> USD.
// Prefers an explicit dollar figure; otherwise converts the first figure with a currency.
export function parseAmountUsd(raw: unknown): number | undefined {
  if (typeof raw === "number") return raw > 0 ? raw : undefined;
  if (typeof raw !== "string") return undefined;
  const re =
    /(us\$|\$|£|€|usd|gbp|eur)?\s*~?\s*(\d[\d,]*(?:\.\d+)?)\s*(thousand|million|billion|bn|mn|mm|k|m|b)?\b\s*(usd|gbp|eur)?/gi;
  const found: { ccy?: Ccy; value: number }[] = [];
  for (const m of raw.matchAll(re)) {
    const num = parseFloat(m[2].replace(/,/g, ""));
    if (!Number.isFinite(num) || num <= 0) continue;
    const sym = (m[1] ?? m[4] ?? "").toLowerCase();
    const ccy: Ccy | undefined =
      sym === "$" || sym === "us$" || sym === "usd" ? "USD" : sym === "£" || sym === "gbp" ? "GBP" : sym === "€" || sym === "eur" ? "EUR" : undefined;
    const scale = m[3] ? SCALE[m[3].toLowerCase()] : 1;
    const value = num * scale;
    if (!ccy && !m[3]) continue; // bare numbers like years or "Series 2" are not amounts
    found.push({ ccy, value });
  }
  if (!found.length) return undefined;
  const pick = found.find((f) => f.ccy === "USD") ?? found.find((f) => f.ccy) ?? found[0];
  const usd = pick.value * FX_TO_USD[pick.ccy ?? "USD"];
  return usd >= 1000 ? Math.round(usd) : undefined;
}

// null = not an equity venture round (grant, debt, IPO, M&A); skip it as a deal.
export function normaliseRound(raw: unknown): Stage | "unknown" | null {
  if (typeof raw !== "string") return "unknown";
  const s = raw.trim().toLowerCase();
  if (!s || /^[—–-]+$/.test(s)) return "unknown";
  if (/grant|debt|loan|non[- ]equity|ipo|acqui|merger|post[- ]ipo|secondary|buyout|dividend|venture debt|credit/.test(s))
    return null;
  if (/pre[- ]?seed|angel|friends|accelerator|incubator/.test(s)) return "pre-seed";
  if (/pre[- ]?series[- ]?a/.test(s)) return "seed";
  if (/\bseed\b|seed\+|seed extension/.test(s)) return "seed";
  if (/series[- ]?a\b|series[- ]?a\+|series[- ]?a[0-9]/.test(s)) return "series-a";
  if (/series[- ]?[b-z]\b|series[- ]?[b-z][+0-9]|growth|late[- ]stage|private equity|expansion/.test(s))
    return "series-b-plus";
  return "unknown";
}

const LEGAL = /\b(limited|ltd|llp|l\.?l\.?p|lp|l\.p|plc|inc|llc|gmbh|sarl|s\.a|bv|ag|co)\b\.?/g;
const FUND_NOISE =
  /\b(gp|general partner|investment management|investment managers|management|holdings?|services|founder|nominees?|eng|scot|uk|london|europe|the|fund|funds|[ivx]{1,5}|\d+)\b/g;
const GENERIC = /\b(ventures?|venture partners|capital|partners|vc|investments?|investors?|group|advisors|advisers)\b/g;

// Collapses Cala's fund-vehicle variants ("SEEDCAMP III L.P.", "Seedcamp GP LLP") onto one key.
export function investorKey(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/&/g, " and ");
  const stripped = base.replace(LEGAL, " ").replace(/[^a-z0-9 ]+/g, " ").replace(FUND_NOISE, " ");
  const loose = stripped.replace(GENERIC, " ").replace(/\band\b/g, " ").replace(/\s+/g, "");
  if (loose.length >= 2) return loose;
  const tight = stripped.replace(/\s+/g, "");
  return tight || base.replace(/[^a-z0-9]+/g, "");
}

export function companyKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(LEGAL, " ")
    .replace(/\b(technologies|technology|labs|ai|global|holdings)\b/g, " ")
    .replace(/[^a-z0-9]+/g, "");
}

export const DUPLICATE_DEAL_DAYS = 60;

const hasUrl = (d: Deal) => d.sources.some((s) => !!s.url);
const rank = (d: Deal) => [d.round !== "unknown", hasUrl(d), !!d.amount].map(Number);

// a is kept over b when it has a known round, then a URL source, then an amount.
function better(a: Deal, b: Deal): boolean {
  const ra = rank(a);
  const rb = rank(b);
  for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] > rb[i];
  return true;
}

function sameDeal(a: Deal, b: Deal): boolean {
  if (!a.date || !b.date || companyKey(a.company) !== companyKey(b.company)) return false;
  // Two different known rounds a few weeks apart can both be real (a seed then a quick Series A).
  if (a.round !== "unknown" && b.round !== "unknown" && a.round !== b.round) return false;
  return Math.abs(Date.parse(a.date) - Date.parse(b.date)) <= DUPLICATE_DEAL_DAYS * 86_400_000;
}

// One investor's deal list can carry the same round twice (one copy with round "unknown", a day
// apart), because the query rows are deduped on company + round. Keeps the better copy, fills its
// blanks from the other and merges the sources.
export function dedupeDeals(deals: Deal[]): Deal[] {
  const kept: Deal[] = [];
  for (const d of deals) {
    const i = kept.findIndex((k) => sameDeal(k, d));
    if (i < 0) {
      kept.push(d);
      continue;
    }
    const [win, lose] = better(kept[i], d) ? [kept[i], d] : [d, kept[i]];
    kept[i] = { ...lose, ...win, sources: dedupeSources([...win.sources, ...lose.sources], 4) };
  }
  return kept;
}

export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function dedupeByKey<T>(items: T[], name: (t: T) => string, prefer?: (a: T, b: T) => T): T[] {
  const by = new Map<string, T>();
  for (const it of items) {
    const k = investorKey(name(it));
    const prev = by.get(k);
    by.set(k, prev === undefined ? it : prefer ? prefer(prev, it) : prev);
  }
  return [...by.values()];
}

// Runtime paths, not build inputs: the ignore hint stops Turbopack tracing the cache into the bundle.
export const CALA_CACHE_DIR = path.join(/* turbopackIgnore: true */ process.cwd(), "data", "cala-cache");
export const LIVE_USAGE_FILE = path.join(/* turbopackIgnore: true */ process.cwd(), "data", ".cala-live-usage.json");

// The live-route client: memory LRU -> Aiven Valkey (shared) -> the on-disk cache the ingest
// uses, a live-call budget shared through Valkey, one retry for 429/5xx and none for timeouts.
// Also used by scripts/prewarm.ts so prewarmed entries are exactly the ones the routes look up.
export function createRouteCala(extra: { budget?: CalaBudget; log?: (msg: string) => void } = {}): CalaClient {
  const live = sharedBudget(LIVE_USAGE_FILE, liveBudgetLimit());
  return createCalaClient({
    cache: tieredCache(new MemoryLRU(300), valkeyCache(), diskCache(CALA_CACHE_DIR)),
    budget: extra.budget ? allBudgets(extra.budget, live) : live,
    timeoutMs: 120_000,
    maxRetries: 1,
    retryNetworkErrors: false,
    log: extra.log,
  });
}

let routeClient: CalaClient | undefined;

// Shared by the /api/cala/* route handlers.
export function getRouteCala(): CalaClient | null {
  if (process.env.E2E_MOCK === "1" || !process.env.CALA_API_KEY) return null;
  routeClient ??= createRouteCala({ log: console.warn });
  return routeClient;
}

export const UUID_RE =/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
