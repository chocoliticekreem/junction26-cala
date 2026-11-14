import { describe, expect, it } from "vitest";
import { addFallback, addLlm, buildProfile, closeChunk, emptyLog } from "@/lib/liveProfile";
import type { Extraction } from "@/lib/types";

const sector = (label: Extraction["sectors"][number]["label"], confidence = 0.8): Extraction => ({
  sectors: [{ label, confidence }],
});

describe("liveProfile", () => {
  it("uses fallback extractions until the LLM answers", () => {
    const log = addFallback(emptyLog(), sector("fintech"));
    expect(buildProfile(log).sectors).toEqual({ fintech: 1 });
  });

  it("replaces a chunk's fallback contribution with the LLM answer instead of stacking", () => {
    let log = addFallback(emptyLog(), sector("fintech"));
    log = addFallback(log, { sectors: [], stage: { value: "seed", confidence: 0.6 } });
    const closed = closeChunk(log);
    log = addLlm(closed.log, [closed.id], {
      sectors: [{ label: "insurtech", confidence: 0.9 }],
      stage: { value: "pre-seed", confidence: 0.9 },
    });
    const p = buildProfile(log);
    expect(p.sectors).toEqual({ insurtech: 1 });
    expect(p.stage).toBe("pre-seed");
  });

  it("keeps fallbacks of chunks the LLM has not answered yet", () => {
    const first = closeChunk(addFallback(emptyLog(), sector("fintech")));
    let log = addFallback(first.log, sector("biotech/therapeutics"));
    log = addLlm(log, [first.id], sector("insurtech"));
    const p = buildProfile(log);
    expect(Object.keys(p.sectors).sort()).toEqual(["biotech/therapeutics", "insurtech"]);
    expect(p.sectors.fintech).toBeUndefined();
  });

  it("covers every chunk of a batched request with one LLM answer", () => {
    const a = closeChunk(addFallback(emptyLog(), sector("fintech")));
    const b = closeChunk(addFallback(a.log, sector("proptech")));
    const log = addLlm(b.log, [a.id, b.id], sector("insurtech"));
    expect(buildProfile(log).sectors).toEqual({ insurtech: 1 });
  });
});
