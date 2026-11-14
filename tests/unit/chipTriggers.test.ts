import { describe, expect, it } from "vitest";
import { chipTriggers, teamTrigger } from "@/lib/usePitch";
import { loadReplay } from "@/lib/data";
import type { Extraction } from "@/lib/types";

describe("team-signal chip triggers", () => {
  it("gives each replay team signal its own trigger word", () => {
    const merged: Record<string, string> = {};
    for (const ev of loadReplay()) if (ev.extraction) Object.assign(merged, chipTriggers(ev.extraction as Extraction));
    const team = Object.entries(merged).filter(([k]) => k.startsWith("team:"));
    expect(team.length).toBeGreaterThanOrEqual(3);
    expect(new Set(team.map(([, w]) => w)).size).toBe(team.length);
    expect(merged["team:two phds"]).toBe("PhDs");
    expect(merged["team:doctorate in immunology"]).toBe("immunology");
  });

  it("puts a shared trigger only on the signal that contains it", () => {
    const signals = [{ value: "PhD in machine learning" }, { value: "ex-Google" }];
    expect(teamTrigger(signals, "ex-Google")).toEqual({ value: "ex-Google", word: "ex-Google" });
    expect(teamTrigger(signals, "machine learning")).toEqual({ value: "PhD in machine learning", word: "machine learning" });
    expect(teamTrigger(signals, "founders")).toBeUndefined();
    expect(teamTrigger([{ value: "Doctorate in immunology" }], "doctor")).toEqual({
      value: "Doctorate in immunology",
      word: "doctor",
    });
    expect(teamTrigger([{ value: "Second-time founder" }], "exited")).toEqual({ value: "Second-time founder", word: "exited" });
    expect(teamTrigger([], "PhD")).toBeUndefined();
  });

  it("keys by lower-cased signal so the chip finds it after merge", () => {
    const e: Extraction = { sectors: [], team_signals: [{ value: "PhD", confidence: 0.8 }], triggers: { team_signals: "PhD" } };
    expect(chipTriggers(e)).toEqual({ "team:phd": "PhD" });
  });
});
