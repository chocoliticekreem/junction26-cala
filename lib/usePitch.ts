"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fallbackExtract } from "@/lib/fallbackExtract";
import { emptyProfile, mergeProfile } from "@/lib/mergeProfile";
import { createReplay, type ReplayPlayer } from "@/lib/replay";
import { pickProvider, type SttSession } from "@/lib/stt";
import type { Extraction, FounderProfile, ReplayEvent } from "@/lib/types";

export type TranscriptToken = { text: string; t: number; final: boolean };

const CHUNK_MS = 3000;

// Extraction trigger keys use extraction field names and sector labels; chips key by profile field.
function chipTriggers(e: Extraction): Record<string, string> {
  const t = e.triggers ?? {};
  const out: Record<string, string> = {};
  const sectorWord = t.sectors ?? e.sectors.map((s) => t[s.label]).find(Boolean);
  if (sectorWord) out.sectors = sectorWord;
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
  const pending = useRef("");
  const inFlight = useRef(false);
  const queued = useRef<string | null>(null);
  const lastSent = useRef(0);
  const epoch = useRef(0);

  const apply = useCallback((e: Extraction) => {
    if (isEmpty(e)) return;
    const next = mergeProfile(profileRef.current, e);
    profileRef.current = next;
    setProfile(next);
    const tr = chipTriggers(e);
    if (Object.keys(tr).length) setTriggers((prev) => ({ ...prev, ...tr }));
  }, []);

  const reset = useCallback(() => {
    epoch.current += 1;
    player.current?.stop();
    player.current = null;
    session.current?.stop();
    session.current = null;
    pending.current = "";
    queued.current = null;
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

  // One LLM request in flight; a newer chunk replaces any queued one (spec 5.6).
  const sendChunk = useCallback(
    async (first: string) => {
      if (inFlight.current) {
        queued.current = queued.current ? `${queued.current} ${first}` : first;
        return;
      }
      inFlight.current = true;
      const myEpoch = epoch.current;
      let chunk: string | null = first;
      while (chunk && myEpoch === epoch.current) {
        try {
          const res = await fetch("/api/extract", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ chunk, profile: profileRef.current }),
          });
          if (res.ok && myEpoch === epoch.current) {
            const body = (await res.json()) as { extraction?: Extraction; source?: "llm" | "fallback" };
            if (body.source === "llm" && body.extraction) apply(body.extraction);
            if (body.source) setExtractSource(body.source);
          }
        } catch {
          // Network loss: the keyword fallback has already moved the graph.
        }
        chunk = queued.current;
        queued.current = null;
      }
      inFlight.current = false;
    },
    [apply],
  );

  const onFinal = useCallback(
    (text: string) => {
      setInterim("");
      setTranscript((prev) => [...prev, { text, t: Date.now(), final: true }]);
      apply(fallbackExtract(text));
      pending.current = pending.current ? `${pending.current} ${text}` : text;
      const sentenceEnd = /[.!?]\s*$/.test(text);
      if (sentenceEnd || Date.now() - lastSent.current > CHUNK_MS) {
        const chunk = pending.current;
        pending.current = "";
        lastSent.current = Date.now();
        void sendChunk(chunk);
      }
    },
    [apply, sendChunk],
  );

  // Flush a half-sentence chunk if the speaker pauses without a full stop.
  useEffect(() => {
    if (!micOn) return;
    const id = window.setInterval(() => {
      if (pending.current && Date.now() - lastSent.current > CHUNK_MS) {
        const chunk = pending.current;
        pending.current = "";
        lastSent.current = Date.now();
        void sendChunk(chunk);
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [micOn, sendChunk]);

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
