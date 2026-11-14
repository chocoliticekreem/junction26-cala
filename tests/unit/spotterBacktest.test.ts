// Backtest of the early spotter on the real cohort (the proof slide): run it as of 2015 and 2016
// for London's early-stage investors and report where later unicorns landed. Skipped until Track
// A's data/cohort.json exists. Prints the table; asserts only that it ran (leakage is covered in spotter.test.ts).
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { backtestSpotter, SpotterError } from "@/lib/sim/spotter";
import type { Cohort } from "@/lib/sim/spotter/cohort";

const file = path.join(process.cwd(), "data", "cohort.json");
const hasCohort = existsSync(file);

const INVESTORS = ["Entrepreneur First", "Seedcamp", "Index Ventures", "LocalGlobe", "Balderton Capital"];
const AS_OF = ["2015-06-01", "2016-06-01"];
const TARGETS = ["Tractable", "Revolut", "Wise", "TransferWise", "Monzo", "PolyAI", "Cleo", "Synthesia", "Onfido", "Thought Machine"];

describe.skipIf(!hasCohort)("spotter backtest on data/cohort.json", () => {
  it("reports where later unicorns rank", () => {
    const cohort = JSON.parse(readFileSync(file, "utf8")) as Cohort;
    const lines: string[] = [];
    let ran = 0;
    for (const asOf of AS_OF) {
      for (const inv of INVESTORS) {
        try {
          const row = backtestSpotter(cohort, inv, asOf, TARGETS);
          ran++;
          const found = row.targets.filter((t) => t.reason !== "not in cohort");
          lines.push(`${asOf} ${row.investor} (${row.candidates} candidates) top5=[${row.top5.join(", ")}]`);
          for (const t of found) lines.push(`    ${t.name}: ${t.rank ? `rank ${t.rank}${t.inTop20 ? " (top 20)" : ""}` : `not ranked - ${t.reason}`}`);
        } catch (e) {
          if (!(e instanceof SpotterError)) throw e;
          lines.push(`${asOf} ${inv}: not in cohort`);
        }
      }
    }
    console.log(`spotter backtest\n${lines.join("\n")}`);
    expect(ran).toBeGreaterThan(0);
  });
});
