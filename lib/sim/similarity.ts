// "Companies like you": a cheap lexical similarity, no embeddings and no API calls.
//
//   document   = a company's AI tags (each word counted TAG_WEIGHT times) + its description words
//   tokens     = lowercase words of 2+ characters, a short stopword list removed, plural "s" cut
//   weight     = tf x idf, idf = ln((N + 1) / (df + 1)) + 1 over the cohort, vector L2-normalised
//   textSim    = cosine(query vector, company vector), 0..1
//   similarity = TEXT_W * textSim + (1 - TEXT_W) * sectorWeight(company sector)
//
// The index is built once per cohort object (WeakMap) at first use. Tags carry the precise domain
// ("EEG", "neurotech") that the 18 broad sectors flatten, so an EEG wearable finds other
// neurotech companies even when one is filed under medtech and another under deep tech.
import type { Sector } from "@/lib/taxonomy";
import type { Cohort } from "./types";

export const TAG_WEIGHT = 2;
export const TEXT_W = 0.7;

const STOP = new Set(
  (
    "a an and are as at be by for from has have in into is it its of on or our that the their this to " +
    "we with company companies startup startups platform builds build building based using use provides " +
    "synthetic development fixture stand real data come comes json cohort"
  ).split(" "),
);

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9][a-z0-9+]*/g) ?? [])
    .filter((w) => w.length >= 2 && !STOP.has(w))
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}

type Vec = Map<string, number>;

export type SimilarityIndex = { vecs: Map<string, Vec>; idf: Map<string, number>; n: number };

function termCounts(tags: string[] | undefined, text: string | undefined): Vec {
  const tf: Vec = new Map();
  for (const t of tags ?? []) for (const w of tokenize(t)) tf.set(w, (tf.get(w) ?? 0) + TAG_WEIGHT);
  for (const w of tokenize(text ?? "")) tf.set(w, (tf.get(w) ?? 0) + 1);
  return tf;
}

function weigh(tf: Vec, idf: Map<string, number>, n: number): Vec {
  const out: Vec = new Map();
  let norm = 0;
  const unseen = Math.log(n + 1) + 1;
  for (const [w, c] of tf) {
    const x = c * (idf.get(w) ?? unseen);
    out.set(w, x);
    norm += x * x;
  }
  norm = Math.sqrt(norm);
  if (norm) for (const [w, x] of out) out.set(w, x / norm);
  return out;
}

export function cosine(a: Vec, b: Vec): number {
  const [s, l] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [w, x] of s) dot += x * (l.get(w) ?? 0);
  return Math.max(0, Math.min(1, dot));
}

const cache = new WeakMap<Cohort, SimilarityIndex>();

export function similarityIndex(cohort: Cohort): SimilarityIndex {
  const hit = cache.get(cohort);
  if (hit) return hit;
  const counts = new Map<string, Vec>();
  const df = new Map<string, number>();
  for (const co of Object.values(cohort.companies)) {
    const tf = termCounts(co.tags, co.description);
    counts.set(co.id, tf);
    for (const w of tf.keys()) df.set(w, (df.get(w) ?? 0) + 1);
  }
  const n = counts.size;
  const idf = new Map([...df].map(([w, d]) => [w, Math.log((n + 1) / (d + 1)) + 1]));
  const vecs = new Map([...counts].map(([id, tf]) => [id, weigh(tf, idf, n)]));
  const idx = { vecs, idf, n };
  cache.set(cohort, idx);
  return idx;
}

export function queryVector(idx: SimilarityIndex, q: { tags?: string[]; text?: string }): Vec {
  return weigh(termCounts(q.tags, q.text), idx.idf, idx.n);
}

export function textSimilarity(idx: SimilarityIndex, q: Vec, companyId: string): number {
  const v = idx.vecs.get(companyId);
  return v && q.size ? cosine(q, v) : 0;
}

export function similarity(
  idx: SimilarityIndex,
  q: Vec,
  company: { id: string; sector: Sector },
  sectorWeights: Partial<Record<Sector, number>>,
): number {
  return TEXT_W * textSimilarity(idx, q, company.id) + (1 - TEXT_W) * (sectorWeights[company.sector] ?? 0);
}

// Coarse domain families over the broad sectors: a precedent from the founder's family is a fair
// comparison, one from another family (a consumer app for an AI-infrastructure start) is not.
const FAMILY_OF: Record<Sector, string> = {
  "AI infrastructure": "software",
  "developer tools": "software",
  "B2B SaaS (other)": "software",
  "applied AI/vertical SaaS": "software",
  cybersecurity: "software",
  "biotech/therapeutics": "health",
  "medtech/devices": "health",
  healthtech: "health",
  fintech: "money",
  insurtech: "money",
  "crypto/web3": "money",
  consumer: "consumer",
  marketplaces: "consumer",
  edtech: "consumer",
  proptech: "physical",
  mobility: "physical",
  "climate/energy": "physical",
  "deep tech/hardware": "physical",
  other: "other",
};

export function sectorFamily(s: Sector): string {
  return FAMILY_OF[s] ?? "other";
}

// Text similarity at or above which a company counts as the same domain: STRONG_TEXT_SIM on its
// own, FAMILY_TEXT_SIM when it is also in one of the founder's sector families. Calibrated on the
// real cohort: ~70 of 486 companies clear 0.04 for an AI-infrastructure pitch, and generic word
// overlap ("AI", "agents") keeps unrelated fintech/edtech below 0.1. Below STRONG_TEXT_SIM a match
// also needs MIN_SHARED_TERMS distinct words in common: one incidental word ("self-knowledge" in a
// wellness app vs "knowledge graph") is not a shared domain.
export const FAMILY_TEXT_SIM = 0.04;
export const STRONG_TEXT_SIM = 0.1;
export const MIN_SHARED_TERMS = 2;

export type TextMatch = { sim: number; shared: number };

export function textMatch(idx: SimilarityIndex, q: Vec, companyId: string): TextMatch {
  const v = idx.vecs.get(companyId);
  if (!v || !q.size) return { sim: 0, shared: 0 };
  let shared = 0;
  for (const w of q.keys()) if (v.has(w)) shared++;
  return { sim: cosine(q, v), shared };
}

// 0 = same domain, 1 = same sector family (looser), 2 = unrelated. Without founder text, tier 0
// is the founder's own sectors.
export function domainTier(
  company: { sector: Sector },
  founderSectors: ReadonlySet<Sector>,
  text: TextMatch | undefined,
): 0 | 1 | 2 {
  if (!founderSectors.size && !text) return 0;
  const families = new Set([...founderSectors].map(sectorFamily));
  const inFamily = families.has(sectorFamily(company.sector));
  if (!text) return founderSectors.has(company.sector) ? 0 : inFamily ? 1 : 2;
  if (text.sim >= STRONG_TEXT_SIM) return 0;
  if (text.shared < MIN_SHARED_TERMS) return 2;
  return inFamily ? (text.sim >= FAMILY_TEXT_SIM ? 0 : 1) : 2;
}

// Mean of the given companies' vectors, re-normalised: an investor's portfolio as one "document".
export function centroid(idx: SimilarityIndex, ids: Iterable<string>): Vec {
  const sum: Vec = new Map();
  for (const id of ids) for (const [w, x] of idx.vecs.get(id) ?? []) sum.set(w, (sum.get(w) ?? 0) + x);
  const norm = Math.sqrt([...sum.values()].reduce((a, x) => a + x * x, 0));
  if (norm) for (const [w, x] of sum) sum.set(w, x / norm);
  return sum;
}

// Companies ranked by similarity to the query, best first.
export function companiesLike(
  cohort: Cohort,
  q: { tags?: string[]; text?: string; sectorWeights?: Partial<Record<Sector, number>> },
  opts: { limit?: number; exclude?: string } = {},
): { companyId: string; name: string; similarity: number; textSimilarity: number }[] {
  const idx = similarityIndex(cohort);
  const qv = queryVector(idx, q);
  return Object.values(cohort.companies)
    .filter((c) => c.id !== opts.exclude)
    .map((c) => ({
      companyId: c.id,
      name: c.name,
      similarity: similarity(idx, qv, c, q.sectorWeights ?? {}),
      textSimilarity: textSimilarity(idx, qv, c.id),
    }))
    .sort((a, b) => b.similarity - a.similarity || a.companyId.localeCompare(b.companyId))
    .slice(0, opts.limit ?? 10);
}
