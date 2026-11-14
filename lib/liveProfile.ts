import { emptyProfile, mergeProfile } from "./mergeProfile";
import type { Extraction, FounderProfile } from "./types";

// The live profile is rebuilt from a log of transcript chunks rather than merged incrementally,
// so an LLM answer for a chunk replaces the keyword fallback's guesses for that chunk instead of
// stacking on top of them (spec 5.6: "the LLM result overrides it").
export type LiveChunk = {
  id: number;
  fallbacks: Extraction[];
  // Set on every chunk an LLM request covered; the extraction lives on the last one only.
  answered?: boolean;
  llm?: Extraction;
};

export type LiveLog = { chunks: LiveChunk[]; open: number };

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
  const chunks = log.chunks.map((c) =>
    ids.includes(c.id) ? { ...c, answered: true, llm: c.id === last ? e : undefined } : c,
  );
  return { ...log, chunks };
}

export function buildProfile(log: LiveLog, base: FounderProfile = emptyProfile()): FounderProfile {
  let p = base;
  for (const c of [...log.chunks].sort((a, b) => a.id - b.id)) {
    if (c.answered) {
      if (c.llm) p = mergeProfile(p, c.llm);
    } else {
      for (const f of c.fallbacks) p = mergeProfile(p, f);
    }
  }
  return p;
}
