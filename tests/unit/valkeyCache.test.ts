import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// In-memory stand-in for the iovalkey client: no network in tests.
const fake = vi.hoisted(() => ({
  store: new Map<string, string>(),
  hashes: new Map<string, Record<string, string>>(),
  connectFails: false,
  hang: false,
  instances: 0,
}));

vi.mock("iovalkey", () => {
  const never = () => new Promise<never>(() => {});
  class FakeValkey {
    status = "wait";
    constructor() {
      fake.instances++;
    }
    on() {
      return this;
    }
    async connect() {
      if (fake.connectFails) throw new Error("connect ECONNREFUSED");
      this.status = "ready";
    }
    disconnect() {
      this.status = "end";
    }
    async quit() {
      this.status = "end";
    }
    get(k: string) {
      return fake.hang ? never() : Promise.resolve(fake.store.get(k) ?? null);
    }
    set(k: string, v: string) {
      if (fake.hang) return never();
      fake.store.set(k, v);
      return Promise.resolve("OK");
    }
    incr(k: string) {
      return this.incrby(k, 1);
    }
    decr(k: string) {
      return this.incrby(k, -1);
    }
    incrby(k: string, by: number) {
      if (fake.hang) return never();
      const n = Number(fake.store.get(k) ?? 0) + by;
      fake.store.set(k, String(n));
      return Promise.resolve(n);
    }
    hincrby(k: string, f: string, by: number) {
      const h = fake.hashes.get(k) ?? {};
      h[f] = String(Number(h[f] ?? 0) + by);
      fake.hashes.set(k, h);
      return Promise.resolve(Number(h[f]));
    }
    hgetall(k: string) {
      return Promise.resolve(fake.hashes.get(k) ?? {});
    }
  }
  return { default: FakeValkey };
});

const {
  CalaBudgetError,
  LIVE_USAGE_KEY,
  MemoryLRU,
  cacheKeyHash,
  createCalaClient,
  diskCache,
  sharedBudget,
  tieredCache,
  valkeyCache,
} = await import("@/lib/cala");
const { VALKEY_PREFIX, closeValkey, valkeyGetJson, valkeySetJson } = await import("@/lib/valkey");
const { STATS_KEY, localStats, resetLocalStats } = await import("@/lib/cacheStats");
const { GET: getStats } = await import("@/app/api/cache/stats/route");

const ENTITY_KEY = "POST /v1/entities/e1 ";
const vkey = (k: string) => VALKEY_PREFIX + cacheKeyHash(k);
const entity = { id: "e1", name: "Zinc", entity_type: "Organization", properties: {}, relationships: {} };
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const fetchMock = vi.fn<typeof fetch>();
let dir: string;

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "valkey-"));
  await closeValkey();
  const state = (globalThis as { __roomValkey?: { downUntil: number; logged: Set<string> } }).__roomValkey;
  if (state) {
    state.downUntil = 0;
    state.logged.clear();
  }
  fake.store.clear();
  fake.hashes.clear();
  fake.connectFails = false;
  fake.hang = false;
  fake.instances = 0;
  process.env.AIVEN_VALKEY_URI = "rediss://user:pw@fake.aivencloud.com:12345";
  resetLocalStats();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.AIVEN_VALKEY_URI;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

function routeLikeClient(limit = 5) {
  const mem = new MemoryLRU(10);
  const file = diskCache(path.join(dir, "cache"));
  const client = createCalaClient({
    apiKey: "test",
    cache: tieredCache(mem, valkeyCache(), file),
    budget: sharedBudget(path.join(dir, "usage.json"), limit),
    maxRetries: 0,
    retryNetworkErrors: false,
  });
  return { client, mem, file };
}

describe("cache chain: memory -> valkey -> file -> live", () => {
  it("serves a Valkey hit without calling Cala and back-fills memory", async () => {
    fake.store.set(vkey(ENTITY_KEY), JSON.stringify(entity));
    const { client, mem } = routeLikeClient();
    const r = await client.withMeta.retrieve("e1");
    expect(r).toMatchObject({ source: "valkey", value: entity });
    expect(await mem.get(ENTITY_KEY)).toEqual(entity);
    expect((await client.withMeta.retrieve("e1")).source).toBe("memory");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("prefers memory over Valkey over file", async () => {
    const { client, mem, file } = routeLikeClient();
    await file.set(ENTITY_KEY, { ...entity, name: "from file" });
    fake.store.set(vkey(ENTITY_KEY), JSON.stringify({ ...entity, name: "from valkey" }));
    expect((await client.retrieve("e1")).name).toBe("from valkey");
    await mem.set(ENTITY_KEY, { ...entity, name: "from memory" });
    expect((await client.retrieve("e1")).name).toBe("from memory");
  });

  it("a file-cache hit back-fills Valkey and memory", async () => {
    const { client, mem, file } = routeLikeClient();
    await file.set(ENTITY_KEY, entity);
    expect((await client.withMeta.retrieve("e1")).source).toBe("file");
    expect(JSON.parse(fake.store.get(vkey(ENTITY_KEY))!)).toEqual(entity);
    expect(await mem.get(ENTITY_KEY)).toEqual(entity);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a live result is written through to memory, Valkey and the file cache", async () => {
    fetchMock.mockResolvedValueOnce(ok(entity));
    const { client, mem } = routeLikeClient();
    const r = await client.withMeta.retrieve("e1");
    expect(r.source).toBe("live");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await mem.get(ENTITY_KEY)).toEqual(entity);
    expect(JSON.parse(fake.store.get(vkey(ENTITY_KEY))!)).toEqual(entity);
    expect(readdirSync(path.join(dir, "cache"))).toEqual([`${cacheKeyHash(ENTITY_KEY)}.json`]);
  });

  it("another instance (empty memory, no file cache) is served by Valkey", async () => {
    fetchMock.mockResolvedValueOnce(ok(entity));
    await routeLikeClient().client.retrieve("e1");
    rmSync(path.join(dir, "cache"), { recursive: true, force: true });
    const other = routeLikeClient();
    expect((await other.client.withMeta.retrieve("e1")).source).toBe("valkey");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("records hits and misses per tier, locally and in Valkey", async () => {
    const { client, file } = routeLikeClient();
    await file.set(ENTITY_KEY, entity);
    await client.retrieve("e1");
    await client.retrieve("e1");
    const s = localStats();
    expect(s.memory).toMatchObject({ hits: 1, misses: 1 });
    expect(s.valkey).toMatchObject({ hits: 0, misses: 1 });
    expect(s.file.hits).toBe(1);
    expect(s.file.p50Ms).not.toBeNull();
    await vi.waitFor(() => expect(fake.hashes.get(STATS_KEY)?.["file:hits"]).toBe("1"));

    const body = await (await getStats()).json();
    expect(body.valkey).toEqual({ configured: true, connected: true });
    expect(body.instance.summary).toEqual({ hits: 2, misses: 0 });
    expect(body.shared.byTier.file.hits).toBe(1);
    expect(JSON.stringify(body)).not.toContain("pw@");
  });
});

describe("Valkey unavailable never breaks the app", () => {
  it("missing AIVEN_VALKEY_URI: every op is a no-op and the chain uses file then live", async () => {
    delete process.env.AIVEN_VALKEY_URI;
    await valkeySetJson("k", 1);
    expect(await valkeyGetJson("k")).toBeUndefined();
    expect(fake.instances).toBe(0);

    fetchMock.mockResolvedValueOnce(ok(entity));
    const { client } = routeLikeClient();
    expect((await client.withMeta.retrieve("e1")).source).toBe("live");
    expect((await routeLikeClient().client.withMeta.retrieve("e1")).source).toBe("file");
    expect(existsSync(path.join(dir, "usage.json"))).toBe(true);

    const body = await (await getStats()).json();
    expect(body.valkey).toEqual({ configured: false, connected: false });
    expect(body.shared).toBeNull();
  });

  it("a Valkey timeout falls through to the file cache within the op timeout", async () => {
    const { client, file } = routeLikeClient();
    await file.set(ENTITY_KEY, entity);
    await valkeyGetJson("warm-up");
    fake.hang = true;
    const t0 = Date.now();
    const r = await client.withMeta.retrieve("e1");
    expect(r).toMatchObject({ source: "file", value: entity });
    expect(Date.now() - t0).toBeLessThan(2500);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a failed connect is not retried during the cooldown (no reconnect storm)", async () => {
    fake.connectFails = true;
    expect(await valkeyGetJson("a")).toBeUndefined();
    expect(await valkeyGetJson("b")).toBeUndefined();
    await valkeySetJson("c", 1);
    expect(fake.instances).toBe(1);
  });
});

describe("shared live budget (atomic INCR in Valkey)", () => {
  it("holds the cap across instances and does not touch the file counter", async () => {
    const a = sharedBudget(path.join(dir, "usage-a.json"), 2);
    const b = sharedBudget(path.join(dir, "usage-b.json"), 2);
    expect(await a.tryConsume()).toBe(true);
    expect(await b.tryConsume()).toBe(true);
    expect(await a.tryConsume()).toBe(false);
    expect(await b.tryConsume()).toBe(false);
    expect(fake.store.get(LIVE_USAGE_KEY)).toBe("2");
    expect(await a.usage()).toEqual({ used: 2, limit: 2, shared: true });
    expect(existsSync(path.join(dir, "usage-a.json"))).toBe(false);
  });

  it("never overshoots under concurrent consumes", async () => {
    const b = sharedBudget(path.join(dir, "usage.json"), 3);
    const results = await Promise.all(Array.from({ length: 10 }, () => b.tryConsume()));
    expect(results.filter(Boolean)).toHaveLength(3);
    expect(fake.store.get(LIVE_USAGE_KEY)).toBe("3");
  });

  it("a spent shared budget throws CalaBudgetError without calling Cala", async () => {
    fake.store.set(LIVE_USAGE_KEY, "5");
    const { client } = routeLikeClient(5);
    await expect(client.retrieve("e1")).rejects.toBeInstanceOf(CalaBudgetError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to the file counter when Valkey is down", async () => {
    fake.connectFails = true;
    const b = sharedBudget(path.join(dir, "usage.json"), 1);
    expect(await b.tryConsume()).toBe(true);
    expect(await b.tryConsume()).toBe(false);
    expect(await b.usage()).toEqual({ used: 1, limit: 1, shared: false });
    expect(existsSync(path.join(dir, "usage.json"))).toBe(true);
  });
});
