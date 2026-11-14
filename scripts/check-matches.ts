// DoD checks on the real data, no network:
// 1. Every top-10 match has a reason and >= 2 evidence chips, or is marked thin history (DoD 4).
// 2. After the demo replay, which contradiction-badged investors show in the top 10 / top 25 (DoD 5).
// Usage: npx tsx scripts/check-matches.ts
import { loadDebriefs, loadInvestors, loadReplay } from "../lib/data";
import { fallbackExtract } from "../lib/fallbackExtract";
import { emptyProfile, mergeProfile } from "../lib/mergeProfile";
import { CONTRADICTION_THRESHOLD } from "../lib/revealed";
import { rankInvestors } from "../lib/scoring";
import type { Extraction, FounderProfile, Investor } from "../lib/types";

const investors = loadInvestors();
const debriefs = loadDebriefs();
const byId = new Map(investors.map((i) => [i.id, i]));

export const hasBadge = (i: Investor) =>
  !i.thinHistory && i.contradiction > CONTRADICTION_THRESHOLD && !!i.contradictionLine;

function replayProfile(): FounderProfile {
  let p = emptyProfile();
  for (const ev of loadReplay()) if (ev.kind === "profile" && ev.extraction) p = mergeProfile(p, ev.extraction as Extraction);
  return p;
}

const PITCHES: [string, string][] = [
  ["biotech pre-seed", "We are a pre-seed therapeutics company developing antibody drugs, raising £1m in London."],
  ["fintech seed", "We are a seed-stage fintech building payments infrastructure for SMEs, raising £3 million."],
  ["climate seed", "We are a seed climate tech startup building grid-scale battery storage, raising £2m."],
  ["AI infra pre-seed", "We are a pre-seed AI infrastructure company building GPU inference tooling for LLMs."],
  ["consumer pre-seed", "We are a pre-seed consumer app for Gen Z shoppers, a direct to consumer brand raising £500k."],
  ["off-taxonomy defence", "We are a pre-seed defence company building counter-drone systems for armed forces."],
];

let failures = 0;
console.log("DoD 4: top-10 reason + >= 2 evidence chips (or thin history)\n");
console.log("| Pitch | Profile | Top-10 ok | Thin-history rows | Failures |");
console.log("|---|---|---|---|---|");
for (const [name, text] of PITCHES) {
  const p = mergeProfile(emptyProfile(), fallbackExtract(text));
  const top = rankInvestors(p, investors, debriefs).slice(0, 10);
  const bad: string[] = [];
  let thin = 0;
  for (const m of top) {
    const inv = byId.get(m.investorId) as Investor;
    if (inv.thinHistory) thin++;
    const ok = m.reason.trim().length > 0 && (m.evidence.length >= 2 || inv.thinHistory);
    if (!ok) bad.push(`${inv.id} (reason "${m.reason}", evidence ${m.evidence.length})`);
  }
  failures += bad.length;
  const prof = `${Object.keys(p.sectors).join("+") || "no sector"} / ${p.stage ?? "no stage"}`;
  console.log(`| ${name} | ${prof} | ${10 - bad.length}/10 | ${thin} | ${bad.join("; ") || "-"} |`);
}

console.log("\nDoD 5: contradiction badges after the replay\n");
const final = replayProfile();
const ranked = rankInvestors(final, investors, debriefs);
console.log(`replay profile: ${JSON.stringify({ sectors: final.sectors, stage: final.stage, raise: final.raise })}`);
const badged = ranked
  .map((m, i) => ({ rank: i + 1, inv: byId.get(m.investorId) as Investor }))
  .filter((x) => hasBadge(x.inv));
console.log(`badged investors in data: ${investors.filter(hasBadge).length}`);
console.log(`badged in top 10: ${badged.filter((x) => x.rank <= 10).map((x) => `#${x.rank} ${x.inv.name}`).join(", ") || "none"}`);
console.log(
  `badged in top 25: ${badged
    .filter((x) => x.rank <= 25)
    .map((x) => `#${x.rank} ${x.inv.name} (${x.inv.contradiction.toFixed(2)}): ${x.inv.contradictionLine}`)
    .join("\n  ") || "none"}`,
);

if (failures) {
  console.error(`\n${failures} top-10 rows fail DoD 4`);
  process.exit(1);
}
