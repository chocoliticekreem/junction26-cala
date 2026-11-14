// Backtest of the early spotter on the real cohort (the proof slide): run it as of 2015 and 2016
// for London's early-stage investors and report where later unicorns landed. Skipped until Track
// A's data/cohort.json exists. Prints the table; asserts only that it ran (leakage is covered in spotter.test.ts).
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { backtestSpotter, runSpotter, SpotterError } from "@/lib/sim/spotter";
import { resolveInvestor, spotterIndex } from "@/lib/sim/spotter/base";
import { PARTICIPATION_SCALE, simModel, stageParticipation, UNICORN_VISION } from "@/lib/sim/spotter/futures";
import { Engine, prepare, simulate } from "@/lib/sim/simulate";
import { mulberry32 } from "@/lib/sim/util";
import type { Cohort } from "@/lib/sim/types";

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

  it("gives the same unicorn odds as the founder simulator, and honest base rates", () => {
    const cohort = JSON.parse(readFileSync(file, "utf8")) as Cohort;
    const res = runSpotter(cohort, { investorName: "Seedcamp" });
    const model = simModel(cohort, cohort.asOf);
    for (const p of res.picks.slice(0, 5)) {
      const founder = simulate({ sectors: {}, stage: p.company.latestRound.stage, companyId: p.company.id }, UNICORN_VISION, model, { runs: 3000 });
      expect(Math.abs(p.scores.pUnicorn! - founder.tree.reachVisionShare)).toBeLessThan(0.05);
    }
    // Stage-matched seed-sample base rates: Seedcamp's lane is pre-seed/seed, so single digits, not
    // the enriched reference set's share.
    for (const p of res.picks) {
      expect(["pre-seed", "seed"]).toContain(p.company.latestRound.stage);
      expect(p.scores.unicornBaseRate).toBeGreaterThan(0.02);
      expect(p.scores.unicornBaseRate).toBeLessThan(0.1);
      expect(p.scores.unicornLift).toBeCloseTo(p.scores.pUnicorn! / p.scores.unicornBaseRate!, 0);
    }
  });

  it("keeps each fund in its lane", () => {
    const cohort = JSON.parse(readFileSync(file, "utf8")) as Cohort;
    for (const inv of ["Seedcamp", "Entrepreneur First"]) {
      for (const p of runSpotter(cohort, { investorName: inv, topN: 10 }).picks) expect(["pre-seed", "seed"]).toContain(p.company.latestRound.stage);
    }
    const ls = runSpotter(cohort, { investorName: "Lightspeed", topN: 10 }).picks;
    for (const p of ls) expect(["seed", "series-a", "series-b-plus"]).toContain(p.company.latestRound.stage);
  });

  // Participation calibration on date holdouts: fit everything on rounds before `cutoff`, then for
  // every episode in [cutoff, until), predict P(investor joins as new non-lead money) the way
  // futures.ts does (engine co-investor draw, else PARTICIPATION_SCALE x the investor's stage
  // participation rate) and compare with what happened, for investors with >= 10 rounds before the
  // cutoff. The scale is fitted on the 2022-11..2024-11 window and checked on 2024-11 onwards.
  type Tally = { pred: number; eng: number; rateMass: number; act: number; n: number };
  function holdout(cohort: Cohort, cutoff: string, until: string, scale: number): Map<string, Tally> {
    const DRAWS = 40;
    const cut = spotterIndex(cohort, cutoff);
    const full = spotterIndex(cohort);
    const model = simModel(cohort, cutoff);
    const engine = new Engine(model, prepare({ sectors: {}, stage: "seed" }, UNICORN_VISION, model));
    const rnd = mulberry32(7);
    const investors = [...cut.roundsOf.entries()].filter(([, n]) => n >= 10).map(([id]) => id);
    const part = new Map(investors.map((id) => [id, stageParticipation(cut, id)]));
    const focus = new Map(["Seedcamp", "Entrepreneur First", "Lightspeed", "Kfund"].map((n) => [resolveInvestor(full, { investorName: n })!, n]));
    const out = new Map<string, Tally>();
    const tally = (k: string) => out.get(k) ?? out.set(k, { pred: 0, eng: 0, rateMass: 0, act: 0, n: 0 }).get(k)!;
    const untilMs = Date.parse(until);
    for (const row of full.rows.values()) {
      row.eps.forEach((e, k) => {
        if (k === 0 || e.dateMs < cut.asOfMs || e.dateMs >= untilMs) return;
        const prev = row.eps[k - 1].memberIds;
        const earlier = new Set(row.eps.slice(0, k).flatMap((x) => x.memberIds));
        const li = e.leadId !== undefined ? model.agentIndex[e.leadId] : undefined;
        const drawn = new Map<string, number>();
        for (let d = 0; d < DRAWS; d++) for (const id of engine.coInvestors(e.stage, li, prev, rnd)) drawn.set(id, (drawn.get(id) ?? 0) + 1);
        for (const id of investors) {
          if (id === e.leadId || earlier.has(id)) continue;
          const eng = (drawn.get(id) ?? 0) / DRAWS;
          const rate = part.get(id)![e.stage] ?? 0;
          for (const key of ["all", ...(focus.has(id) ? [focus.get(id)!] : [])]) {
            const t = tally(key);
            t.pred += 1 - (1 - eng) * (1 - scale * rate);
            t.eng += eng;
            t.rateMass += (1 - eng) * rate;
            t.act += e.memberIds.includes(id) ? 1 : 0;
            t.n++;
          }
        }
      });
    }
    return out;
  }
  const show = (label: string, out: Map<string, Tally>) =>
    `${label}\n` + [...out.entries()].map(([k, t]) => `  ${k}: actual ${t.act}, predicted ${t.pred.toFixed(1)} (engine alone ${t.eng.toFixed(1)}) over ${t.n} investor-rounds`).join("\n");

  it("predicts new-participant rates on a date holdout", () => {
    const cohort = JSON.parse(readFileSync(file, "utf8")) as Cohort;
    const a = holdout(cohort, "2022-11-14", "2024-11-14", PARTICIPATION_SCALE);
    const b = holdout(cohort, "2024-11-14", cohort.asOf, PARTICIPATION_SCALE);
    const [ta, tb] = [a.get("all")!, b.get("all")!];
    const fit = (t: Tally) => (t.act - t.eng) / t.rateMass;
    const pooled = (ta.act + tb.act - ta.eng - tb.eng) / (ta.rateMass + tb.rateMass);
    console.log(
      `participation scale fitted: 2022-11..2024-11 ${fit(ta).toFixed(3)}, 2024-11.. ${fit(tb).toFixed(3)}, pooled ${pooled.toFixed(3)} (shipped ${PARTICIPATION_SCALE})\n` +
        `${show("window A: fit < 2022-11-14, scored to 2024-11-14", a)}\n${show("window B: fit < 2024-11-14, scored after", b)}`,
    );
    const pred = ta.pred + tb.pred;
    const act = ta.act + tb.act;
    expect(pred / act).toBeGreaterThan(0.8);
    expect(pred / act).toBeLessThan(1.25);
    for (const t of [ta, tb]) {
      expect(t.pred / t.act).toBeGreaterThan(0.5);
      expect(t.pred / t.act).toBeLessThan(2);
    }
  });
});
