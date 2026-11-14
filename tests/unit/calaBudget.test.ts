import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CalaBudgetError,
  MemoryLRU,
  allBudgets,
  createCalaClient,
  diskCache,
  fileBudget,
  liveBudgetLimit,
  sessionBudget,
  tieredCache,
} from "@/lib/cala";

let dir: string;
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "cala-budget-"));
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const status = (code: number) => new Response("nope", { status: code });
const entity = { id: "e1", name: "Zinc", entity_type: "Organization", properties: {}, relationships: {} };

function client(budgetFile = path.join(dir, "usage.json"), limit = 5) {
  return createCalaClient({
    apiKey: "test",
    cache: tieredCache(new MemoryLRU(10), diskCache(path.join(dir, "cache"))),
    budget: fileBudget(budgetFile, limit),
    maxRetries: 1,
    retryNetworkErrors: false,
  });
}

describe("liveBudgetLimit", () => {
  it.each([
    [undefined, 150],
    ["", 150],
    ["40", 40],
    ["0", 0],
    ["-3", 150],
    ["abc", 150],
    ["2.5", 150],
  ])("%s -> %s", (raw, want) => {
    expect(liveBudgetLimit(raw)).toBe(want);
  });
});

describe("fileBudget", () => {
  it("counts consumes and refuses at the limit", async () => {
    const b = fileBudget(path.join(dir, "usage.json"), 2);
    expect(await b.tryConsume()).toBe(true);
    expect(await b.tryConsume()).toBe(true);
    expect(await b.tryConsume()).toBe(false);
    expect(await b.usage()).toEqual({ used: 2, limit: 2 });
  });

  it("persists across instances (server restart)", async () => {
    const file = path.join(dir, "usage.json");
    await fileBudget(file, 3).tryConsume();
    await fileBudget(file, 3).tryConsume();
    const after = fileBudget(file, 3);
    expect((await after.usage()).used).toBe(2);
    expect(await after.tryConsume()).toBe(true);
    expect(await after.tryConsume()).toBe(false);
  });

  it("never overshoots under concurrent consumes", async () => {
    const b = fileBudget(path.join(dir, "usage.json"), 3);
    const results = await Promise.all(Array.from({ length: 10 }, () => b.tryConsume()));
    expect(results.filter(Boolean)).toHaveLength(3);
    expect((await b.usage()).used).toBe(3);
  });

  it("limit 0 allows nothing", async () => {
    expect(await fileBudget(path.join(dir, "usage.json"), 0).tryConsume()).toBe(false);
  });

  it("allBudgets stops at the tightest cap", async () => {
    const b = allBudgets(sessionBudget(1), fileBudget(path.join(dir, "usage.json"), 5));
    expect(await b.tryConsume()).toBe(true);
    expect(await b.tryConsume()).toBe(false);
  });
});

describe("route client cache and budget", () => {
  it("reads through to disk: a new client (restart) makes no call", async () => {
    fetchMock.mockResolvedValueOnce(ok(entity));
    expect((await client().retrieve("e1")).name).toBe("Zinc");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(readdirSync(path.join(dir, "cache"))).toHaveLength(1);

    const restarted = client();
    expect((await restarted.retrieve("e1")).name).toBe("Zinc");
    expect(await restarted.retrieve("e1")).toEqual(entity);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(restarted.stats.cacheHits).toBe(2);
    expect((await fileBudget(path.join(dir, "usage.json"), 5).usage()).used).toBe(1);
  });

  it("does not cache failures", async () => {
    fetchMock.mockResolvedValueOnce(status(404)).mockResolvedValueOnce(ok(entity));
    const c = client();
    await expect(c.retrieve("e1")).rejects.toMatchObject({ status: 404 });
    expect(await c.retrieve("e1")).toEqual(entity);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws CalaBudgetError without calling Cala once the budget is spent, but still serves cache", async () => {
    fetchMock.mockResolvedValueOnce(ok(entity));
    const c = client(path.join(dir, "usage.json"), 1);
    await c.retrieve("e1");
    await expect(c.retrieve("e2")).rejects.toBeInstanceOf(CalaBudgetError);
    expect(await c.retrieve("e1")).toEqual(entity);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry a 4xx other than 429", async () => {
    fetchMock.mockResolvedValue(status(400));
    await expect(client().retrieve("e1")).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a 429 at most once, counting both calls", async () => {
    fetchMock.mockResolvedValue(status(429));
    const c = client();
    await expect(c.retrieve("e1")).rejects.toMatchObject({ status: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((await fileBudget(path.join(dir, "usage.json"), 5).usage()).used).toBe(2);
  });

  it("never retries a timeout", async () => {
    fetchMock.mockRejectedValue(new DOMException("timed out", "TimeoutError"));
    await expect(client().retrieve("e1")).rejects.toThrow(/TimeoutError/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
