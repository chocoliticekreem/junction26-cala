// Server-only Aiven for Valkey client. Never import from a client component: it reads
// AIVEN_VALKEY_URI, which carries a password. (No `server-only` import because the scripts also
// run this under tsx.)
//
// Every operation is best-effort: with the env var missing, Valkey unreachable or a command slow,
// it resolves as a miss or no-op within OP_TIMEOUT_MS and the caller falls through to the next
// cache tier. A failed connect is not retried for COOLDOWN_MS, so an outage cannot cause a
// reconnect storm.
import Valkey from "iovalkey";

export const VALKEY_PREFIX = "room:cala:v1:";
export const VALKEY_TTL_SECONDS = 30 * 24 * 3600;

const CONNECT_TIMEOUT_MS = 2000;
const OP_TIMEOUT_MS = 800;
const COOLDOWN_MS = 30_000;

type State = {
  client: Valkey | null;
  connecting: Promise<Valkey | null> | null;
  downUntil: number;
  logged: Set<string>;
};

// On globalThis so every route bundle in one server process shares a single connection.
const g = globalThis as typeof globalThis & { __roomValkey?: State };
const state: State = (g.__roomValkey ??= { client: null, connecting: null, downUntil: 0, logged: new Set() });

function logOnce(tag: string, msg: string) {
  if (state.logged.has(tag)) return;
  state.logged.add(tag);
  console.warn(`valkey: ${msg}`);
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

export function valkeyConfigured(): boolean {
  return process.env.E2E_MOCK !== "1" && Boolean(process.env.AIVEN_VALKEY_URI?.trim());
}

async function connect(uri: string): Promise<Valkey | null> {
  const client = new Valkey(uri, {
    lazyConnect: true,
    connectTimeout: CONNECT_TIMEOUT_MS,
    commandTimeout: OP_TIMEOUT_MS,
    maxRetriesPerRequest: 0,
    enableOfflineQueue: false,
    retryStrategy: () => null,
  });
  client.on("error", (e: Error) => logOnce(`error:${e.message}`, `connection error (${e.message}); falling back to the file cache`));
  try {
    await withTimeout(client.connect(), CONNECT_TIMEOUT_MS + 200);
    state.logged.delete("down");
    return client;
  } catch (e) {
    client.disconnect();
    state.downUntil = Date.now() + COOLDOWN_MS;
    logOnce("down", `unreachable (${e instanceof Error ? e.message : e}); using the file cache, retry in ${COOLDOWN_MS / 1000} s`);
    return null;
  }
}

export async function getValkey(): Promise<Valkey | null> {
  if (!valkeyConfigured()) {
    if (process.env.E2E_MOCK !== "1") logOnce("missing", "AIVEN_VALKEY_URI not set; shared cache off, file cache only");
    return null;
  }
  if (state.client?.status === "ready") return state.client;
  if (Date.now() < state.downUntil) return null;
  state.connecting ??= connect(process.env.AIVEN_VALKEY_URI!.trim()).then((c) => {
    state.client = c;
    state.connecting = null;
    return c;
  });
  return state.connecting;
}

// Runs one op against Valkey; undefined on any failure (missing env, down, timeout, error reply).
async function run<T>(op: (c: Valkey) => Promise<T>): Promise<T | undefined> {
  const c = await getValkey();
  if (!c) return undefined;
  try {
    return await withTimeout(op(c), OP_TIMEOUT_MS);
  } catch (e) {
    logOnce(`op:${e instanceof Error ? e.message : e}`, `command failed (${e instanceof Error ? e.message : e}); treated as a miss`);
    return undefined;
  }
}

export async function valkeyGetJson(key: string): Promise<unknown | undefined> {
  const raw = await run((c) => c.get(key));
  if (typeof raw !== "string") return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export async function valkeySetJson(key: string, value: unknown, ttlSeconds = VALKEY_TTL_SECONDS): Promise<void> {
  await run((c) => c.set(key, JSON.stringify(value), "EX", ttlSeconds));
}

export async function valkeyIncr(key: string): Promise<number | undefined> {
  return run((c) => c.incr(key));
}

export async function valkeyDecr(key: string): Promise<number | undefined> {
  return run((c) => c.decr(key));
}

export async function valkeyGetNumber(key: string): Promise<number | undefined> {
  const raw = await run((c) => c.get(key));
  if (raw === undefined) return undefined;
  const n = Number(raw ?? 0);
  return Number.isFinite(n) ? n : undefined;
}

export async function valkeyHincrby(key: string, field: string, by: number): Promise<void> {
  await run((c) => c.hincrby(key, field, by));
}

export async function valkeyHgetall(key: string): Promise<Record<string, string> | undefined> {
  return run((c) => c.hgetall(key));
}

// Closes the connection so a script can exit. Routes never call this.
export async function closeValkey(): Promise<void> {
  const c = state.client;
  state.client = null;
  if (c) await c.quit().catch(() => c.disconnect());
}
