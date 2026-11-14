// Strict tool use needs every object closed and rejects numeric bounds. A free-form string map
// (additionalProperties: {type: string}) becomes a fixed-key object over mapKeys.
export function strictSchema(node: unknown, mapKeys: readonly string[] = []): unknown {
  if (Array.isArray(node)) return node.map((n) => strictSchema(n, mapKeys));
  if (!node || typeof node !== "object") return node;
  const o = { ...(node as Record<string, unknown>) };
  delete o.minimum;
  delete o.maximum;
  if (o.type === "object") {
    if (o.additionalProperties && typeof o.additionalProperties === "object") {
      o.properties = Object.fromEntries(mapKeys.map((k) => [k, { type: "string" }]));
    }
    o.additionalProperties = false;
  }
  if (o.properties) {
    o.properties = Object.fromEntries(
      Object.entries(o.properties as Record<string, unknown>).map(([k, v]) => [k, strictSchema(v, mapKeys)]),
    );
  }
  if (o.items) o.items = strictSchema(o.items, mapKeys);
  return o;
}

// Which path understood an input. The UI shows a notice whenever it is keyword_fallback.
export type Analysis = "ai" | "keyword_fallback";

// The Haiku call, injectable so tests stub it. Same contract as lib/anthropic.ts haikuTool.
export type ToolCaller = (opts: {
  system: string;
  user: string;
  tool: { name: string; description: string; input_schema: object };
  maxTokens: number;
  strict?: boolean;
  timeoutMs?: number;
  maxRetries?: number;
}) => Promise<unknown | null>;

export function cleanTags(x: unknown, max = 10): string[] {
  if (!Array.isArray(x)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of x) {
    if (typeof t !== "string") continue;
    const s = t.trim().replace(/\s+/g, " ").slice(0, 40);
    const k = s.toLowerCase();
    if (!s || seen.has(k)) continue;
    seen.add(k);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}
