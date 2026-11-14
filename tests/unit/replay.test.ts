import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReplayEvent } from "@/lib/types";
import { createReplay } from "@/lib/replay";

const events: ReplayEvent[] = [
  { t: 2000, kind: "profile", extraction: { sectors: [{ label: "biotech/therapeutics", confidence: 0.9 }] } },
  { t: 0, kind: "transcript", text: "Hi, we are" },
  { t: 1000, kind: "transcript", text: "a therapeutics company" },
  { t: 3000, kind: "profile", profile: { stage: "pre-seed", confidence: { stage: 0.8 } } },
];

describe("createReplay", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(speed?: number) {
    const log: string[] = [];
    const player = createReplay(
      events,
      {
        onTranscript: (text, t) => log.push(`T${t}:${text}`),
        onExtraction: (e, t) => log.push(`E${t}:${e.sectors.map((s) => s.label).join()}|${e.stage?.value ?? ""}`),
        onEnd: () => log.push("end"),
      },
      speed,
    );
    return { log, player };
  }

  it("plays events in time order and ends", () => {
    const { log, player } = setup();
    player.start();
    expect(player.isPlaying()).toBe(true);
    vi.advanceTimersByTime(1500);
    expect(log).toEqual(["T0:Hi, we are", "T1000:a therapeutics company"]);
    vi.advanceTimersByTime(2000);
    expect(log).toEqual([
      "T0:Hi, we are",
      "T1000:a therapeutics company",
      "E2000:biotech/therapeutics|",
      "E3000:|pre-seed",
      "end",
    ]);
    expect(player.isPlaying()).toBe(false);
  });

  it("applies the speed multiplier", () => {
    const { log, player } = setup(2);
    player.start();
    vi.advanceTimersByTime(1500);
    expect(log.at(-1)).toBe("end");
  });

  it("stop() clears pending timers", () => {
    const { log, player } = setup();
    player.start();
    vi.advanceTimersByTime(1000);
    player.stop();
    expect(player.isPlaying()).toBe(false);
    vi.advanceTimersByTime(10_000);
    expect(log).toEqual(["T0:Hi, we are", "T1000:a therapeutics company"]);
  });
});
