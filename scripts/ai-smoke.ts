// Live smoke test of the AI analysis path: 5 founder pitches + 4 visions = 9 Haiku calls.
// --grounded instead runs one narrative call and one email-draft call (2 calls) to check that
// those strict schemas are accepted live.
// Usage: npx tsx scripts/ai-smoke.ts [--grounded]
import path from "node:path";
import { analyzeFounder } from "../lib/ai/analyzeFounder";
import { analyzeVision } from "../lib/ai/analyzeVision";
import { draftEmail, type EmailFacts } from "../lib/context/actions";
import { fitModel } from "../lib/sim/fit";
import { narrate } from "../lib/sim/llm";
import { simulate } from "../lib/sim/simulate";
import type { Cohort } from "../lib/sim/types";
import fixture from "../data/cohort.fixture.json";

try {
  process.loadEnvFile(path.resolve(__dirname, "..", ".env.local"));
} catch {
  // ANTHROPIC_API_KEY may come from the shell
}

const PITCHES: [string, string][] = [
  ["EEG neurotech", "Hi, I'm Maya. We're building Lumen, an e e g headband that reads your brain waves to coach focus and sleep. Consumer neurotech, we sell the headband plus a subscription app. Pre-seed, raising one point five million euros, 2,000 people on the waitlist."],
  ["Cala", "Cala is a knowledge engine for AI agents: one API that returns verified, sourced facts about companies, people and funding, so agents stop hallucinating. Developers pay per query. We're in Helsinki, at seed."],
  ["Raise", "Raise matches founders with the investors most likely to back them, using what funds actually invested in, not what their website says. Founders join free, funds pay for the deal flow. Pre-seed, London."],
  ["Tenkai", "Tenkai is the AR operating layer: the default AI layer for AR glasses, so apps can see what you see. We got 8 signups at a club demo last week. Pre-idea, two founders from Meta Reality Labs."],
  ["Defence drone", "We build autonomous interceptor drones for air defence, cheap enough to shoot down Shaheds at a tenth of the cost of a missile. Selling to NATO ministries of defence. Raising a 6 million dollar seed round."],
];

const VISIONS = ["Become a unicorn in 6 years", "A decacorn, then IPO on Nasdaq", "Profitable and bootstrapped at 10 million ARR in 4 years", "Series A with a team of 40 by 2029"];

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY missing");
  if (process.argv.includes("--grounded")) {
    const model = fitModel(fixture as unknown as Cohort);
    const r = simulate({ sectors: { fintech: 1 }, stage: "pre-seed" }, { text: "Series B", targetStage: "series-b-plus", horizonYears: 5 }, model, { runs: 500, seed: 1 });
    console.log("narrative:", await narrate(r.tree.children, model));
    const facts: EmailFacts = { company: "Lumen", product: "EEG headband that coaches focus and sleep", stage: "pre-seed", founderClaims: ["2,000 people on the waitlist"], investor: "Kestrel Ventures" };
    console.log("email:", await draftEmail(facts));
    return;
  }
  for (const [name, text] of PITCHES) {
    const r = await analyzeFounder(text);
    const f = r.founder;
    console.log(`\n[${name}] analysis=${r.analysis}${r.fallbackReason ? ` (${r.fallbackReason})` : ""}`);
    console.log(`  sector=${f.sector} weights=${JSON.stringify(f.sectorWeights)}`);
    console.log(`  tags=${JSON.stringify(f.tags)} stage=${f.stage ?? "-"} raiseUsd=${f.raiseUsd ?? "-"} company=${f.company ?? "-"}`);
    console.log(`  oneLiner=${f.oneLiner ?? "-"} model=${f.businessModel ?? "-"} geo=${f.geography ?? "-"} team=${JSON.stringify(f.teamSignals)} traction=${JSON.stringify(f.traction ?? {})}`);
  }
  for (const text of VISIONS) {
    const r = await analyzeVision(text);
    const v = r.vision;
    console.log(`\n[vision] "${text}" analysis=${r.analysis}${r.fallbackReason ? ` (${r.fallbackReason})` : ""}`);
    console.log(`  interpretation="${v.interpretation}"`);
    console.log(`  stage=${v.targetStage} valuationUsd=${v.targetValuationUsd ?? "-"} revenueUsd=${v.targetRevenueUsd ?? "-"} headcount=${v.targetHeadcount ?? "-"} public=${!!v.goesPublic} profitable=${!!v.profitable} horizon=${v.horizonYears}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
