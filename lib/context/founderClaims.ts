// Founder-supplied text (deck notes, pasted text, uploaded markdown) -> claims tagged basis
// "founder". Haiku with a strict schema; a sentence split when the key is missing or the call fails.
import { haikuTool } from "@/lib/anthropic";
import type { Claim, Upload } from "./types";

export const MAX_UPLOAD_CHARS = 20_000;
const MAX_CLAIMS = 20;

export const CLAIMS_TOOL = {
  name: "record_founder_claims",
  description: "Record the factual claims the founder makes about their company.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      claims: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            text: { type: "string", description: "One claim, in the founder's terms, at most 160 characters." },
            upload: { type: "string", description: "Name of the upload the claim came from." },
          },
          required: ["text", "upload"],
        },
      },
    },
    required: ["claims"],
  },
};

const SYSTEM = `You turn a founder's own notes into short factual claims (traction, product, team, customers,
pricing, raise, plans). Keep only what the text states; never add numbers, names or facts.
Drop marketing language. At most ${MAX_CLAIMS} claims.`;

export function parseClaims(raw: unknown, uploads: Upload[]): Claim[] {
  const list = (raw as { claims?: unknown } | null)?.claims;
  if (!Array.isArray(list)) return [];
  const names = new Set(uploads.map((u) => u.name));
  const out: Claim[] = [];
  for (const c of list) {
    const text = typeof c?.text === "string" ? c.text.trim().slice(0, 200) : "";
    if (!text || out.some((o) => o.text === text)) continue;
    const upload = typeof c?.upload === "string" && names.has(c.upload) ? c.upload : uploads[0]?.name;
    out.push({ text, basis: "founder", ...(upload ? { source: { name: `Founder upload: ${upload}` } } : {}) });
    if (out.length >= MAX_CLAIMS) break;
  }
  return out;
}

export function sentenceClaims(uploads: Upload[]): Claim[] {
  const out: Claim[] = [];
  for (const u of uploads)
    for (const s of u.text.split(/(?<=[.!?])\s+|\n+/)) {
      const text = s.replace(/^[-*#>\s]+/, "").trim();
      if (text.length < 12) continue;
      out.push({ text: text.slice(0, 200), basis: "founder", source: { name: `Founder upload: ${u.name}` } });
      if (out.length >= MAX_CLAIMS) return out;
    }
  return out;
}

export async function founderClaims(uploads: Upload[]): Promise<Claim[]> {
  const usable = uploads.filter((u) => u.text.trim());
  if (!usable.length) return [];
  const user = usable.map((u) => `## Upload: ${u.name}\n${u.text.slice(0, MAX_UPLOAD_CHARS)}`).join("\n\n");
  try {
    const raw = await haikuTool({ system: SYSTEM, user, tool: CLAIMS_TOOL, maxTokens: 1200, strict: true });
    const claims = parseClaims(raw, usable);
    if (claims.length) return claims;
  } catch (e) {
    console.warn("founder claims:", e instanceof Error ? e.message : e);
  }
  return sentenceClaims(usable);
}
