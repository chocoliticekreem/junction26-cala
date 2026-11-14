"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FounderProfile, Match } from "@/lib/types";
import { emptyMockProfile, mockRank, MOCK_INVESTORS, MOCK_TIMELINE, MOCK_TIMELINE_END } from "./mockState";

export type TranscriptToken = { text: string; t: number; final: boolean };

export type MockState = {
  transcript: TranscriptToken[];
  profile: FounderProfile;
  matches: Match[];
  triggers: Record<string, string>;
  playing: boolean;
  replay: () => void;
};

// Drives the founder view from MOCK_TIMELINE; swap for lib/replay.ts + the live loop.
export function useMockTimeline(autoStart = true): MockState {
  const [transcript, setTranscript] = useState<TranscriptToken[]>([]);
  const [profile, setProfile] = useState<FounderProfile>(emptyMockProfile);
  const [matches, setMatches] = useState<Match[]>(() => mockRank(emptyMockProfile(), MOCK_INVESTORS));
  const [triggers, setTriggers] = useState<Record<string, string>>({});
  const [playing, setPlaying] = useState(false);
  const timers = useRef<number[]>([]);

  const clear = () => {
    for (const id of timers.current) window.clearTimeout(id);
    timers.current = [];
  };

  const replay = useCallback(() => {
    clear();
    const base = emptyMockProfile();
    setTranscript([]);
    setProfile(base);
    setMatches(mockRank(base, MOCK_INVESTORS));
    setTriggers({});
    setPlaying(true);
    let running = base;
    for (const step of MOCK_TIMELINE) {
      timers.current.push(
        window.setTimeout(() => {
          setTranscript((prev) => [...prev, { text: step.words, t: step.t, final: true }]);
          if (step.profile) {
            running = { ...running, ...step.profile, id: running.id };
            setProfile(running);
            setMatches(mockRank(running, MOCK_INVESTORS));
            if (step.trigger) {
              const keys = Object.keys(step.profile);
              setTriggers((prev) => {
                const next = { ...prev };
                for (const k of keys) if (k !== "confidence") next[k] = step.trigger!;
                return next;
              });
            }
          }
        }, step.t),
      );
    }
    timers.current.push(window.setTimeout(() => setPlaying(false), MOCK_TIMELINE_END));
  }, []);

  useEffect(() => {
    const id = autoStart ? window.setTimeout(replay, 0) : undefined;
    return () => {
      if (id !== undefined) window.clearTimeout(id);
      clear();
    };
  }, [autoStart, replay]);

  return { transcript, profile, matches, triggers, playing, replay };
}
