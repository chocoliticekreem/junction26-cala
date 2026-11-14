import type { Extraction, ReplayEvent } from "./types";
import type { Sector } from "./taxonomy";

export type ReplayPlayer = { start(): void; stop(): void; isPlaying(): boolean };

// Profile events without an explicit extraction are converted so the replay still drives the
// same merge path as live extraction.
function profileToExtraction(ev: ReplayEvent): Extraction | undefined {
  if (ev.extraction) return ev.extraction;
  const p = ev.profile;
  if (!p) return undefined;
  const c = (k: string) => p.confidence?.[k] ?? 0.9;
  const ex: Extraction = {
    sectors: (Object.entries(p.sectors ?? {}) as [Sector, number][]).map(([label, w]) => ({
      label,
      confidence: Math.min(1, w * c("sectors")),
    })),
  };
  if (p.stage) ex.stage = { value: p.stage, confidence: c("stage") };
  if (p.raise) ex.raise_amount = { value: p.raise, confidence: c("raise") };
  if (p.traction) ex.traction = { ...p.traction, confidence: c("traction") };
  if (p.teamSignals?.length)
    ex.team_signals = p.teamSignals.map((value) => ({ value, confidence: c("teamSignals") }));
  if (p.geography) ex.geography = { value: p.geography, confidence: c("geography") };
  if (p.businessModel) ex.business_model = { value: p.businessModel, confidence: c("businessModel") };
  return ex;
}

export function createReplay(
  events: ReplayEvent[],
  handlers: {
    onTranscript(text: string, t: number): void;
    onExtraction(e: Extraction, t: number): void;
    onEnd(): void;
  },
  speed = 1,
): ReplayPlayer {
  const rate = speed > 0 ? speed : 1;
  const sorted = [...events].sort((a, b) => a.t - b.t);
  let timers: ReturnType<typeof setTimeout>[] = [];
  let playing = false;

  const stop = () => {
    for (const t of timers) clearTimeout(t);
    timers = [];
    playing = false;
  };

  return {
    start() {
      if (playing) return;
      playing = true;
      for (const ev of sorted) {
        timers.push(
          setTimeout(() => {
            if (ev.kind === "transcript" && ev.text) handlers.onTranscript(ev.text, ev.t);
            if (ev.kind === "profile") {
              const ex = profileToExtraction(ev);
              if (ex) handlers.onExtraction(ex, ev.t);
            }
          }, Math.max(0, ev.t / rate)),
        );
      }
      const last = sorted.length ? sorted[sorted.length - 1].t : 0;
      timers.push(
        setTimeout(() => {
          timers = [];
          playing = false;
          handlers.onEnd();
        }, Math.max(0, last / rate)),
      );
    },
    stop,
    isPlaying: () => playing,
  };
}
