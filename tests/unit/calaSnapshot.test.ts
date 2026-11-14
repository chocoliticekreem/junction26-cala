import { promises as fsp, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MemoryLRU,
  createCalaClient,
  diskCache,
  fileBudget,
  sessionBudget,
  tieredCache,
  type CalaClient,
} from "@/lib/cala";
import { snapshotEntity, snapshotSearch, type CalaSnapshot } from "@/lib/calaSnapshot";

const SNAP_ID = "11111111-1111-4111-8111-111111111111";
const CACHED_ID = "22222222-2222-4222-8222-222222222222";
const UNKNOWN_ID = "33333333-3333-4333-8333-333333333333";

const fake: CalaSnapshot = {
  version: 1,
  entities: {
    [SNAP_ID]: { id: SNAP_ID, name: "ZINC VC LTD", entity_type: "Company", description: "Venture builder", sources: [{ name: "Companies House" }] },
  },
  searches: {
    "zinc": { investorId: "zinc", query: "What does Zinc (London investor) say ...", answer: "Zinc backs health.", sources: [{ name: "zinc.vc", url: "https://zinc.vc" }] },
    "zoe capital": { investorId: "zoe", query: "q", answer: "Zoë backs climate.", sources: [] },
  },
};

const route = vi.hoisted(() => ({ client: null as CalaClient | null }));
vi.mock("@/lib/calaSnapshotData", () => ({ SNAPSHOT: fake }));
vi.mock("@/lib/cala", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/cala")>()),
  getRouteCala: () => route.client,
}));

const { GET: getEntity } = await import("@/app/api/cala/entity/[id]/route");
const { POST: postSearch } = await import("@/app/api/cala/search/route");

const fetchMock = vi.fn<typeof fetch>();
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const roError = (code: string) => Object.assign(new Error(`${code}: read-only file system`), { code });

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "cala-snap-"));
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  route.client = null;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

const entityReq = (id: string) =>
  getEntity(new Request(`http://x/api/cala/entity/${id}`), { params: Promise.resolve({ id }) } as never);
const searchReq = (query: string) =>
  postSearch(new Request("http://x/api/cala/search", { method: "POST", body: JSON.stringify({ query }) }));

async function routeClient(liveLimit: number, seed: Record<string, unknown> = {}) {
  const mem = new MemoryLRU(10);
  for (const [k, v] of Object.entries(seed)) await mem.set(k, v);
  route.client = createCalaClient({
    apiKey: "test",
    cache: mem,
    budget: fileBudget(path.join(dir, "usage.json"), liveLimit),
    maxRetries: 0,
    retryNetworkErrors: false,
  });
  return route.client;
}

describe("snapshot lookup", () => {
  it("finds an entity by Cala id only", () => {
    expect(snapshotEntity(fake, SNAP_ID)?.name).toBe("ZINC VC LTD");
    expect(snapshotEntity(fake, UNKNOWN_ID)).toBeUndefined();
    expect(snapshotEntity(fake, "__proto__")).toBeUndefined();
  });

  it("matches the panel query to the investor by name", () => {
    expect(snapshotSearch(fake, "What does Zinc invest in?")?.answer).toBe("Zinc backs health.");
    expect(snapshotSearch(fake, "  what does ZINC invest in ")?.investorId).toBe("zinc");
    expect(snapshotSearch(fake, "What does Zoë  Capital invest in?")?.investorId).toBe("zoe");
  });

  it("does not answer other questions or unknown investors", () => {
    expect(snapshotSearch(fake, "Who founded Zinc?")).toBeUndefined();
    expect(snapshotSearch(fake, "What does Acme invest in?")).toBeUndefined();
    expect(snapshotSearch(fake, "What does constructor invest in?")).toBeUndefined();
  });
});

describe("route precedence: snapshot, then cache, then live within budget", () => {
  it("entity: snapshot wins even with a client and budget, and sends nothing", async () => {
    const c = await routeClient(5);
    const body = await (await entityReq(SNAP_ID)).json();
    expect(body).toMatchObject({ source: "snapshot", cached: true, entity: { id: SNAP_ID, name: "ZINC VC LTD" } });
    expect(body.sources).toEqual([{ name: "Companies House" }]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(c.stats.calls).toBe(0);
  });

  it("entity: snapshot works with no Cala key at all", async () => {
    expect((await (await entityReq(SNAP_ID)).json()).source).toBe("snapshot");
  });

  it("entity: cache next, without spending budget", async () => {
    const cached = { id: CACHED_ID, name: "Cached Co", entity_type: "Company", properties: {}, relationships: {} };
    await routeClient(0, { [`POST /v1/entities/${CACHED_ID} `]: cached });
    const body = await (await entityReq(CACHED_ID)).json();
    expect(body).toMatchObject({ source: "memory", cached: true, entity: { name: "Cached Co" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("entity: budget 0 never calls Cala for a miss", async () => {
    await routeClient(0);
    const body = await (await entityReq(UNKNOWN_ID)).json();
    expect(body.budgetExhausted).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("entity: live only for a miss within budget", async () => {
    fetchMock.mockResolvedValueOnce(ok({ id: UNKNOWN_ID, name: "Live Co", entity_type: "Company", properties: {}, relationships: {} }));
    await routeClient(1);
    expect((await (await entityReq(UNKNOWN_ID)).json()).source).toBe("live");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("search: snapshot answers the panel query with no call", async () => {
    await routeClient(5);
    const body = await (await searchReq("What does Zinc invest in?")).json();
    expect(body).toMatchObject({ source: "snapshot", answer: "Zinc backs health.", sources: [{ name: "zinc.vc", url: "https://zinc.vc" }] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("search: a question outside the snapshot falls to cache, then budget", async () => {
    const q = "Who founded Zinc?";
    const key = `POST /v1/knowledge/search ${JSON.stringify({ input: q, explainability: false })}`;
    await routeClient(0, { [key]: { content: "Cached answer", context: [], entities: null } });
    expect((await (await searchReq(q)).json()).source).toBe("memory");
    expect((await (await searchReq("Who funds Acme?")).json()).budgetExhausted).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("read-only filesystem", () => {
  it.each(["EROFS", "EACCES", "EPERM"])("disk cache stops writing on %s and never throws", async (code) => {
    const mkdir = vi.spyOn(fsp, "mkdir").mockRejectedValue(roError(code));
    const cache = diskCache(path.join(dir, "cache"));
    await expect(cache.set("k", 1)).resolves.toBeUndefined();
    await expect(cache.set("k2", 2)).resolves.toBeUndefined();
    expect(mkdir).toHaveBeenCalledTimes(1);
    expect(await cache.get("k")).toBeUndefined();
  });

  it("disk cache still surfaces other write errors", async () => {
    vi.spyOn(fsp, "writeFile").mockRejectedValue(roError("ENOSPC"));
    await expect(diskCache(path.join(dir, "cache")).set("k", 1)).rejects.toThrow(/ENOSPC/);
  });

  it("a route client on a read-only disk serves from memory and returns the live answer", async () => {
    vi.spyOn(fsp, "mkdir").mockRejectedValue(roError("EROFS"));
    vi.spyOn(fsp, "writeFile").mockRejectedValue(roError("EROFS"));
    fetchMock.mockResolvedValueOnce(ok({ id: UNKNOWN_ID, name: "Live Co", entity_type: "Company", properties: {}, relationships: {} }));
    const c = createCalaClient({
      apiKey: "test",
      cache: tieredCache(new MemoryLRU(10), diskCache(path.join(dir, "cache"))),
      budget: fileBudget(path.join(dir, "usage.json"), 3),
      maxRetries: 0,
    });
    expect((await c.retrieve(UNKNOWN_ID)).name).toBe("Live Co");
    expect((await c.retrieve(UNKNOWN_ID)).name).toBe("Live Co");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("budget falls back to an in-memory counter with the same cap when the file cannot be written", async () => {
    vi.spyOn(fsp, "writeFile").mockRejectedValue(roError("EROFS"));
    const b = fileBudget(path.join(dir, "usage.json"), 2);
    expect(await b.tryConsume()).toBe(true);
    expect(await b.tryConsume()).toBe(true);
    expect(await b.tryConsume()).toBe(false);
    expect(await b.usage()).toEqual({ used: 2, limit: 2 });
  });

  it("in-memory fallback continues from the count already on disk", async () => {
    await fsp.writeFile(path.join(dir, "usage.json"), JSON.stringify({ used: 1 }));
    vi.spyOn(fsp, "writeFile").mockRejectedValue(roError("EACCES"));
    const b = fileBudget(path.join(dir, "usage.json"), 2);
    expect(await b.tryConsume()).toBe(true);
    expect(await b.tryConsume()).toBe(false);
  });

  it("budget still surfaces other write errors", async () => {
    vi.spyOn(fsp, "writeFile").mockRejectedValue(roError("ENOSPC"));
    await expect(fileBudget(path.join(dir, "usage.json"), 2).tryConsume()).rejects.toThrow(/ENOSPC/);
  });

  it("sessionBudget is unaffected", async () => {
    expect(await sessionBudget(1).tryConsume()).toBe(true);
  });
});
