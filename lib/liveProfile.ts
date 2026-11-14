import { emptyProfile, mergeProfile } from "./mergeProfile";
import type { Extraction, FounderProfile } from "./types";

// The live profile is rebuilt from a log of transcript chunks rather than merged incrementally,
// so an LLM answer for a chunk replaces the keyword fallback's guesses for that chunk instead of
// stacking on top of them (spec 5.6: "the LLM result overrides it"). The override is per field:
// a field the LLM leaves empty keeps the fallback's finding for that chunk, because an empty field
// can mean "nothing new" as easily as "nothing there".
export type LiveChunk = {
  id: number;
  fallbacks: Extraction[];
  // Set on every chunk an LLM request covered; the extraction lives on the last one only.
  answered?: boolean;
  llm?: Extraction;
  // Fields the covering LLM answer reported; the chunk's fallbacks keep every other field.
  llmFields?: ExtractionField[];
};

export type LiveLog = { chunks: LiveChunk[]; open: number };

export type ExtractionField =
  | "sectors"
  | "stage"
  | "raise_amount"
  | "traction"
  | "team_signals"
  | "geography"
  | "business_model";

const OPTIONAL_FIELDS = ["stage", "raise_amount", "traction", "geography", "business_model"] as const;

export function reportedFields(e: Extraction): ExtractionField[] {
  const out: ExtractionField[] = [];
  if (e.sectors.length) out.push("sectors");
  for (const f of OPTIONAL_FIELDS) if (e[f]) out.push(f);
  if (e.team_signals?.length) out.push("team_signals");
  return out;
}

function withoutFields(e: Extraction, fields: ExtractionField[]): Extraction {
  if (!fields.length) return e;
  const next: Extraction = { ...e };
  for (const f of fields) {
    if (f === "sectors") next.sectors = [];
    else delete next[f];
  }
  return next;
}

export function emptyLog(): LiveLog {
  return { chunks: [], open: 0 };
}

function withOpen(log: LiveLog): LiveChunk[] {
  return log.chunks.some((c) => c.id === log.open)
    ? log.chunks
    : [...log.chunks, { id: log.open, fallbacks: [] }];
}

// A keyword-fallback extraction for text heard while the open chunk is still collecting.
export function addFallback(log: LiveLog, e: Extraction): LiveLog {
  const chunks = withOpen(log).map((c) =>
    c.id === log.open ? { ...c, fallbacks: [...c.fallbacks, e] } : c,
  );
  return { ...log, chunks };
}

// Closes the open chunk (it is about to be sent to the LLM) and returns its id.
export function closeChunk(log: LiveLog): { log: LiveLog; id: number } {
  return { log: { chunks: withOpen(log), open: log.open + 1 }, id: log.open };
}

// One LLM request may cover several chunks when queued text was batched together.
export function addLlm(log: LiveLog, ids: number[], e: Extraction): LiveLog {
  if (!ids.length) return log;
  const last = Math.max(...ids);
  const llmFields = reportedFields(e);
  const chunks = log.chunks.map((c) =>
    ids.includes(c.id) ? { ...c, answered: true, llm: c.id === last ? e : undefined, llmFields } : c,
  );
  return { ...log, chunks };
}

export function buildProfile(log: LiveLog, base: FounderProfile = emptyProfile()): FounderProfile {
  let p = base;
  for (const c of [...log.chunks].sort((a, b) => a.id - b.id)) {
    const masked = c.answered ? (c.llmFields ?? []) : [];
    for (const f of c.fallbacks) p = mergeProfile(p, withoutFields(f, masked));
    if (c.llm) p = mergeProfile(p, c.llm);
  }
  return p;
}

// The running profile sent with an LLM request: everything heard before the first chunk it covers,
// so the chunk's own fallback finding is not presented to the LLM as already known.
export function profileBefore(log: LiveLog, firstId: number): FounderProfile {
  return buildProfile({ ...log, chunks: log.chunks.filter((c) => c.id < firstId) });
}
