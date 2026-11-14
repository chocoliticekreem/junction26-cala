// The founder page's ranking after the full demo replay, computed with the same library code the
// page runs. Replay is deterministic, so this is what the screen must show at the end, online or off.
import { loadDebriefs, loadInvestors, loadReplay } from "../../lib/data";
import { emptyProfile, mergeProfile } from "../../lib/mergeProfile";
import { rankInvestors } from "../../lib/scoring";
import type { Extraction, Investor } from "../../lib/types";

export const INVESTORS: Investor[] = loadInvestors();

export function replayTopIds(n = 10): string[] {
  let p = emptyProfile();
  for (const ev of loadReplay()) if (ev.kind === "profile" && ev.extraction) p = mergeProfile(p, ev.extraction as Extraction);
  return rankInvestors(p, INVESTORS, loadDebriefs())
    .slice(0, n)
    .map((m) => m.investorId);
}

export const BIOTECH = "biotech/therapeutics";
