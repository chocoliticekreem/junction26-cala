// Backtest the Path engine on one cohort company: fit on rounds before <asOf>, simulate, and print
// where the company's real next leads rank among the simulated ones.
// Run: npx tsx scripts/backtest.ts "<company name>" <yyyy-mm-dd>
import { findCompanyByName, loadCohort, usingCohortFixture } from "../lib/cohort";
import { backtest } from "../lib/sim/backtest";

const [name, asOf] = process.argv.slice(2);
if (!name || !asOf) {
  console.error('usage: npx tsx scripts/backtest.ts "<company name>" <yyyy-mm-dd>');
  process.exit(1);
}
const cohort = loadCohort();
const co = findCompanyByName(cohort, name);
if (!co) {
  console.error(`no cohort company matches "${name}"${usingCohortFixture() ? " (using the fixture cohort)" : ""}`);
  process.exit(1);
}
const t0 = performance.now();
const r = backtest(co.id, asOf, cohort);
console.log(`${co.name} (${co.id}), fitted on rounds before ${r.asOf}${usingCohortFixture() ? ", FIXTURE cohort" : ""}`);
if (r.programmeStep) console.log(`programme step: first round led by ${r.programmeStep.leadName} (${r.programmeStep.date}) is programme entry; backtest starts after it`);
console.log("real path:");
for (const s of r.realPath.path) console.log(`  ${s.date ?? "????-??-??"}  ${s.stage.padEnd(14)} lead ${s.leadName ?? "?"}`);
const rank = (n: number | null) => (n === null ? "not simulated" : `#${n}`);
console.log(`real first lead: ${r.realFirstLead ?? "none"} -> rank ${rank(r.rankOfRealFirstLead)} of simulated first leads`);
console.log(`  top simulated: ${r.topLeads.join(", ")}`);
console.log(`real next lead:  ${r.realNextLead ?? "none"} -> rank ${rank(r.rankOfRealNextLead)} of simulated second leads`);
console.log(`  top simulated: ${r.topNextLeads.join(", ")}`);
console.log(`${r.runs} runs in ${Math.round(performance.now() - t0)} ms`);
