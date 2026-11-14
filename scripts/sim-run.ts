// Runs the Path simulator on the three demo cases (Cala, Raise, Tenkai) against data/cohort.json
// and prints the numbers we show: reach-vision with its band, branches, realities, calibration,
// plus three health checks over 5,000 plain engine runs: re-lead share, lead geography, junk leads.
// Run: npx tsx scripts/sim-run.ts
import { findCompanyByName, loadCohort, loadCohortModel } from "../lib/cohort";
import { parseVision, simulate } from "../lib/sim";
import type { StartState } from "../lib/sim";
import { Engine, prepare } from "../lib/sim/simulate";
import { investorDropReason } from "../lib/sim/quality";
import { mulberry32, roundStageIndex } from "../lib/sim/util";
import { UNICORN_USD, companyFacts } from "../lib/sim/vision";

const cohort = loadCohort();
const model = loadCohortModel();
console.log(`cohort: ${Object.keys(cohort.companies).length} companies, ${Object.keys(cohort.rounds).length} rounds, asOf ${cohort.asOf}`);

type Case = { name: string; company?: string; start: StartState; vision: string };
const cases: Case[] = [
  { name: "Cala", company: "Cala", start: { sectors: { "AI infrastructure": 0.6, "developer tools": 0.4 }, stage: "pre-seed" }, vision: "Cala becomes a unicorn" },
  {
    name: "Raise",
    start: { sectors: { fintech: 0.5, "B2B SaaS (other)": 0.5 }, stage: "pre-seed", raiseUsd: 1_000_000, geography: "London, United Kingdom" },
    vision: "the default fundraising layer for European founders, Series B, about 150 people",
  },
  { name: "Tenkai", start: { sectors: { "deep tech/hardware": 0.5, "applied AI/vertical SaaS": 0.5 }, stage: "pre-idea" }, vision: "the default AI layer for AR glasses, Series B, about 100 people" },
];

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

// Guardrail base rates: seed-sample companies (outcome-blind) by their first round, effective stage
// (stageSize.ts). "Comparable to Cala" = first round at effective seed and in the seed's top size
// tercile. Outcomes as of the cohort date: ever, and within 5 years of the first round.
function baseRates() {
  const top = model.episodeBands.seed?.p67 ?? Infinity;
  const groups: Record<string, string[]> = { "all seed-sample": [], "first round at effective seed": [], [`first round seed, top size tercile (>= $${(top / 1e6).toFixed(1)}M)`]: [], "same, lead is a fund": [] };
  const keys = Object.keys(groups);
  for (const c of Object.values(cohort.companies)) {
    if (c.sampledBy !== "seed-sample") continue;
    const e0 = model.episodes[c.id]?.[0];
    if (!e0) continue;
    groups[keys[0]].push(c.id);
    if (e0.stage !== "seed") continue;
    groups[keys[1]].push(c.id);
    if ((e0.amountUsd ?? 0) < top) continue;
    groups[keys[2]].push(c.id);
    if (e0.leadId && (model.agents[model.agentIndex[e0.leadId]]?.kind ?? cohort.investors[e0.leadId]?.kind) === "fund") groups[keys[3]].push(c.id);
  }
  const fiveY = 60 * 30.44 * 86400000;
  console.log("\n### Base rates (seed-sample, as of cohort date; 5y = within 60 months of the first round)");
  for (const [label, ids] of Object.entries(groups)) {
    let uni = 0, a = 0, b = 0, a5 = 0, b5 = 0;
    for (const id of ids) {
      const eps = model.episodes[id];
      const t0 = eps[0].dateMs;
      const f = companyFacts(model, id);
      if ((f.valuationUsd ?? 0) >= UNICORN_USD) uni++;
      const reach = (s: number, within: boolean) => eps.some((e) => roundStageIndex(e.stage) >= s && (!within || e.dateMs - t0 <= fiveY));
      if (reach(2, false)) a++;
      if (reach(3, false)) b++;
      if (reach(2, true)) a5++;
      if (reach(3, true)) b5++;
    }
    const n = ids.length || 1;
    console.log(`  ${label}: n=${ids.length}; reached $1B valuation ${uni} (${pct(uni / n)}); Series A ${pct(a / n)} (5y ${pct(a5 / n)}); Series B+ ${pct(b / n)} (5y ${pct(b5 / n)})`);
  }
}
baseRates();

function homeRegion(id: string): string | undefined {
  const a = model.agents[model.agentIndex[id]];
  const r = Object.entries(a?.geo.region ?? {}).sort((x, y) => (y[1] ?? 0) - (x[1] ?? 0))[0];
  return r?.[0];
}

for (const c of cases) {
  const start: StartState = { ...c.start };
  if (c.company) {
    const co = findCompanyByName(cohort, c.company);
    console.log(`\n### ${c.name}: cohort match = ${co ? `${co.name} (${co.id}), rounds ${co.roundIds.length}` : "none"}`);
    if (co) start.companyId = co.id;
  } else console.log(`\n### ${c.name} (not in Cala)`);
  const vision = parseVision(c.vision);
  const t0 = performance.now();
  const r = simulate(start, vision, model, { runs: 5000, seed: 7 });
  const ms = performance.now() - t0;
  console.log("vision basis:", r.visionBasis.text);
  console.log(`start: stage ${r.start.stage}, effective ${r.start.effectiveStage ?? "-"}${r.start.stageNote ? ` | ${r.start.stageNote}` : ""}`);
  const sf = r.calibration.startFactors;
  if (sf) console.log(`  start factors: size tercile ${sf.tercile ?? "-"} x${sf.sizeFactor.toFixed(2)}; lead ${sf.lead ? `${sf.lead.name} lift ${sf.lead.lift.toFixed(2)} (evidence ${sf.lead.evidence}, kind ${sf.lead.kindLift.toFixed(2)})` : "-"}`);
  const t = r.tree;
  console.log(`root reach-vision: ${pct(t.reachVisionShare)} [band ${pct(t.confidenceBand.lo)}-${pct(t.confidenceBand.hi)}] (n=${t.sampleSize} companies) in ${ms.toFixed(0)} ms`);
  for (const ch of t.children) {
    console.log(`  ${ch.label}: ${pct(ch.reachVisionShare)} [${pct(ch.confidenceBand.lo)}-${pct(ch.confidenceBand.hi)}], next round ~${ch.medianMonthsToNextRound?.toFixed(1) ?? "-"} mo, n=${ch.sampleSize}${ch.lowConfidence ? " LOW" : ""}`);
  }
  for (const re of r.realities) {
    console.log(`  reality "${re.title}" ${pct(re.probability)} | ${re.steps.map((s) => s.label).join(" -> ")} | precedents: ${re.precedents.map((p) => p.name).join(", ")}`);
  }
  console.log("  precedents:", r.precedents.slice(0, 6).map((p) => `${p.name}${p.reachedVision ? "✓" : "✗"}`).join(", "));
  const cal = r.calibration;
  console.log(`  base rates: ${cal.baseRates.map((b) => `${b.stage} ${pct(b.p)} (${b.source}; cohort ${b.cohort.raised}/${b.cohort.n})`).join(", ")}`);
  console.log(
    `  size rates: ${Object.entries(cal.sizeRates)
      .map(([s, v]) => `${s} [${v!.tiers.map((t) => `${t.raised}/${t.n} x${t.factor.toFixed(2)}`).join(", ")}]`)
      .join("; ")}`,
  );
  console.log(`  re-lead: ${cal.reLead.map((x) => `${x.from} ${x.same}/${x.n} -> ${pct(x.rate)}`).join(", ")}`);
  console.log(`  lead filter: ${JSON.stringify(cal.leadFilter)}; geography: ${JSON.stringify(cal.geography)}`);

  const prep = prepare(start, vision, model);
  const engine = new Engine(model, prep, start.raiseUsd);
  const rnd = mulberry32(11);
  let pairs = 0;
  let same = 0;
  const byFrom: Record<string, [number, number]> = {};
  let leads = 0;
  let inRegion = 0;
  let northAmerica = 0;
  let junk = 0;
  for (let i = 0; i < 5000; i++) {
    const o = engine.run({ l1: null, l2: "now" }, 0, (vision.horizonYears || 5) * 12, rnd);
    let prev = prep.lastLead;
    let prevStage: string | undefined = prep.lastStageIdx >= 0 ? model.episodes[prep.company?.id ?? ""]?.at(-1)?.stage : undefined;
    for (const s of o.steps) {
      if (!s.leadId) continue;
      leads++;
      if (prev) {
        pairs++;
        if (prev === s.leadId) same++;
        const b = (byFrom[prevStage ?? "?"] ??= [0, 0]);
        b[1]++;
        if (prev === s.leadId) b[0]++;
      }
      prev = s.leadId;
      prevStage = s.stage;
      const h = homeRegion(s.leadId);
      if (h === prep.geo.region) inRegion++;
      if (h === "north-america") northAmerica++;
      if (investorDropReason(s.leadName)) junk++;
    }
  }
  console.log(
    `  health: re-lead ${pct(same / (pairs || 1))} of ${pairs} consecutive leads (${Object.entries(byFrom).map(([k, [a, b]]) => `from ${k} ${pct(a / b)}`).join(", ")}); leads based in ${prep.geo.region ?? "?"} ${pct(inRegion / (leads || 1))}, ` +
      `North America ${pct(northAmerica / (leads || 1))}; junk-named leads ${junk}`,
  );
}
