"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fallbackExtract } from "@/lib/fallbackExtract";
import { addFallback, addLlm, buildProfile, closeChunk, emptyLog, type LiveLog } from "@/lib/liveProfile";
import { emptyProfile, mergeProfile } from "@/lib/mergeProfile";
import { createReplay, type ReplayPlayer } from "@/lib/replay";
import { pickProvider, type SttSession } from "@/lib/stt";
import type { Extraction, FounderProfile, ReplayEvent } from "@/lib/types";

export type TranscriptToken = { text: string; t: number; final: boolean };

const CHUNK_MS = 3000;

// Extraction trigger keys use extraction field names and sector labels; chips key by profile field,
// with one entry per sector ("sector:<label>") so each sector chip shows its own word.
function chipTriggers(e: Extraction): Record<string, string> {
  const t = e.triggers ?? {};
  const out: Record<string, string> = {};
  for (const s of e.sectors) {
    const word = t[s.label] ?? (s === e.sectors[0] ? t.sectors : undefined);
    if (word) out[`sector:${s.label}`] = word;
  }
  if (t.stage) out.stage = t.stage;
  if (t.raise_amount) out.raise = t.raise_amount;
  if (t.traction) out.traction = t.traction;
  if (t.team_signals) out.teamSignals = t.team_signals;
  if (t.geography) out.geography = t.geography;
  if (t.business_model) out.businessModel = t.business_model;
  return out;
}

function isEmpty(e: Extraction): boolean {
  return (
    e.sectors.length === 0 &&
    !e.stage &&
    !e.raise_amount &&
    !e.traction &&
    !e.team_signals?.length &&
    !e.geography &&
    !e.business_model
  );
}

type QueuedChunk = { epoch: number; text: string; ids: number[] };

export function usePitch(replayEvents: ReplayEvent[]) {
  const [transcript, setTranscript] = useState<TranscriptToken[]>([]);
  const [interim, setInterim] = useState("");
  const [profile, setProfile] = useState<FounderProfile>(() => emptyProfile());
  const [triggers, setTriggers] = useState<Record<string, string>>({});
  const [replaying, setReplaying] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [extractSource, setExtractSource] = useState<"llm" | "fallback" | null>(null);

  const player = useRef<ReplayPlayer | null>(null);
  const session = useRef<SttSession | null>(null);
  const profileRef = useRef(profile);
  const log = useRef<LiveLog>(emptyLog());
  const pending = useRef("");
  const inFlightEpoch = useRef<number | null>(null);
  const queued = useRef<QueuedChunk | null>(null);
  const lastSent = useRef(0);
  const epoch = useRef(0);

  const commit = useCallback((nextLog: LiveLog, e: Extraction) => {
    log.current = nextLog;
    const next = buildProfile(nextLog);
    profileRef.current = next;
    setProfile(next);
    const tr = chipTriggers(e);
    if (Object.keys(tr).length) setTriggers((prev) => ({ ...prev, ...tr }));
  }, []);

  const apply = useCallback(
    (e: Extraction) => {
      if (!isEmpty(e)) commit(addFallback(log.current, e), e);
    },
    [commit],
  );

  const reset = useCallback(() => {
    epoch.current += 1;
    player.current?.stop();
    player.current = null;
    session.current?.stop();
    session.current = null;
    pending.current = "";
    queued.current = null;
    log.current = emptyLog();
    const p = emptyProfile();
    profileRef.current = p;
    setProfile(p);
    setTranscript([]);
    setInterim("");
    setTriggers({});
    setReplaying(false);
    setMicOn(false);
    setExtractSource(null);
  }, []);

  // One LLM request in flight per session. The queued request holds all text sent since the
  // in-flight one, not just the newest chunk, so the LLM never misses words (spec 5.6 deviation).
  const sendChunk = useCallback(
    async (text: string, id: number) => {
      const myEpoch = epoch.current;
      if (inFlightEpoch.current === myEpoch) {
        const q = queued.current?.epoch === myEpoch ? queued.current : null;
        queued.current = q
          ? { epoch: myEpoch, text: `${q.text} ${text}`, ids: [...q.ids, id] }
          : { epoch: myEpoch, text, ids: [id] };
        return;
      }
      inFlightEpoch.current = myEpoch;
      let job: QueuedChunk | null = { epoch: myEpoch, text, ids: [id] };
      while (job) {
        try {
          const res = await fetch("/api/extract", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ chunk: job.text, profile: profileRef.current }),
          });
          if (res.ok && myEpoch === epoch.current) {
            const body = (await res.json()) as { extraction?: Extraction; source?: "llm" | "fallback" };
            if (myEpoch === epoch.current) {
              if (body.source === "llm" && body.extraction)
                commit(addLlm(log.current, job.ids, body.extraction), body.extraction);
              if (body.source) setExtractSource(body.source);
            }
          }
        } catch {
          // Network loss: the keyword fallback has already moved the graph.
        }
        // A reset during the request starts a new epoch; its queued work belongs to the new loop.
        const next: QueuedChunk | null = queued.current;
        if (myEpoch === epoch.current && next && next.epoch === myEpoch) {
          queued.current = null;
          job = next;
        } else {
          job = null;
        }
      }
      if (inFlightEpoch.current === myEpoch) inFlightEpoch.current = null;
    },
    [commit],
  );

  const flush = useCallback(() => {
    const text = pending.current;
    pending.current = "";
    lastSent.current = Date.now();
    const closed = closeChunk(log.current);
    log.current = closed.log;
    void sendChunk(text, closed.id);
  }, [sendChunk]);

  const onFinal = useCallback(
    (text: string) => {
      setInterim("");
      setTranscript((prev) => [...prev, { text, t: Date.now(), final: true }]);
      apply(fallbackExtract(text));
      pending.current = pending.current ? `${pending.current} ${text}` : text;
      const sentenceEnd = /[.!?]\s*$/.test(text);
      if (sentenceEnd || Date.now() - lastSent.current > CHUNK_MS) flush();
    },
    [apply, flush],
  );

  // Flush a half-sentence chunk if the speaker pauses without a full stop.
  useEffect(() => {
    if (!micOn) return;
    const id = window.setInterval(() => {
      if (pending.current && Date.now() - lastSent.current > CHUNK_MS) flush();
    }, 1000);
    return () => window.clearInterval(id);
  }, [micOn, flush]);

  const replay = useCallback(() => {
    reset();
    setReplaying(true);
    player.current = createReplay(replayEvents, {
      onTranscript: (text, t) => setTranscript((prev) => [...prev, { text, t, final: true }]),
      onExtraction: (e) => apply(e),
      onEnd: () => setReplaying(false),
    });
    player.current.start();
  }, [apply, replayEvents, reset]);

  const toggleMic = useCallback(() => {
    if (session.current) {
      session.current.stop();
      session.current = null;
      setMicOn(false);
      setInterim("");
      return;
    }
    reset();
    session.current = pickProvider().start({
      onInterim: setInterim,
      onFinal,
      onError: () => {
        setMicOn(false);
        session.current = null;
      },
      onEnd: () => {
        setMicOn(false);
        session.current = null;
      },
    });
    setMicOn(true);
  }, [onFinal, reset]);

  useEffect(
    () => () => {
      player.current?.stop();
      session.current?.stop();
    },
    [],
  );

  // Interim words move the graph before the sentence ends; they are previewed, not committed.
  const displayProfile = useMemo(() => {
    if (!interim) return profile;
    const e = fallbackExtract(interim);
    return isEmpty(e) ? profile : mergeProfile(profile, e);
  }, [interim, profile]);

  const tokens = useMemo(
    () => (interim ? [...transcript, { text: interim, t: 0, final: false }] : transcript),
    [transcript, interim],
  );

  return { tokens, profile: displayProfile, triggers, replaying, micOn, extractSource, replay, toggleMic, reset };
}
