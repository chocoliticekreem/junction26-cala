// Batch backtest of the Path engine (the honest proof slide). Companies whose seed (or Series A) was
// 2018-2022 are rewound to the day before that round, the model is fitted only on earlier rounds,
// and we score (1) the rank of the round's real lead among simulated leads (companies with >= 3
// rounds) and (2) calibration of P(next round within 24 months) against what happened.
// Run: npx tsx scripts/backtest-batch.ts [--runs 1000] [--from 2018] [--to 2022] [--cases]
import { loadCohort, usingCohortFixture } from "../lib/cohort";
import { batchBacktest, type Calib } from "../lib/sim/backtest";

const arg = (name: string, dflt: number) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? Number(process.argv[i + 1]) : dflt;
};
const cohort = loadCohort();
const t0 = performance.now();
const r = batchBacktest(cohort, { runs: arg("--runs", 1000), fromYear: arg("--from", 2018), toYear: arg("--to", 2022) });
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const f3 = (x: number) => x.toFixed(3);

console.log(`cohort: ${Object.keys(cohort.companies).length} companies, asOf ${cohort.asOf}${usingCohortFixture() ? " (FIXTURE)" : ""}`);
console.log(`anchors skipped as programme entry (first round led by an accelerator): ${r.skippedProgramme}`);
console.log(`calibration population: ${r.calibrationPopulation === "seed-sample" ? "seed-sample companies only" : "all companies (no seed sample in this cohort: actuals are survivorship-inflated)"}`);

function calib(label: string, c: Calib) {
  const skill = c.baseRateBrier > 0 ? 1 - c.brier / c.baseRateBrier : 0;
  console.log(`  ${label}: n=${c.n}, mean predicted ${pct(c.meanPredicted)} vs actual ${pct(c.meanActual)}, Brier ${f3(c.brier)} (constant-rate Brier ${f3(c.baseRateBrier)}, skill ${skill.toFixed(2)})`);
  for (const b of c.bins) if (b.n) console.log(`    predicted ${b.lo.toFixed(1)}-${b.hi.toFixed(1)}: n=${b.n}, mean predicted ${pct(b.predicted)}, actual ${pct(b.actual)}`);
}

for (const m of r.models) {
  console.log(`\n## model: ${m.label}`);
  console.log(`real lead of the anchor round (>= 3 rounds, seed 2018-2022): n=${m.leadN} anchors (${m.leadNEligible} with the real lead a lead candidate at asOf)`);
  console.log(`  all: ${Object.entries(m.leadHits).map(([k, v]) => `${k} ${pct(v)}`).join(", ")}`);
  const elig = m.cases.filter((c) => c.inLeadSet && c.realLeadId && c.leadEligible);
  const hit = (k: number) => pct(elig.filter((c) => c.leadRank !== null && c.leadRank <= k).length / (elig.length || 1));
  console.log(`  where the real lead had cohort history before asOf: top1 ${hit(1)}, top3 ${hit(3)}, top5 ${hit(5)}, top10 ${hit(10)}`);
  console.log("P(next round within 24 months of the anchor round):");
  calib("calibration set", m.calibration);
  calib(">= 3-round set (selected on raising, biased toward yes)", m.calibrationLeadSet);
  if (process.argv.includes("--cases")) {
    for (const c of m.cases.filter((x) => x.inLeadSet)) {
      console.log(`    ${c.name} [${c.anchor} ${c.asOf}] real lead ${c.realLeadName ?? "?"} rank ${c.leadRank ?? "-"}; p(next) ${c.predictedNext?.toFixed(2) ?? "-"} actual ${c.actualNext ?? "-"}`);
    }
  }
}
console.log(`\n${Math.round(performance.now() - t0)} ms`);
