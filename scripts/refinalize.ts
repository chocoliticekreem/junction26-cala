// Re-runs the revealed/contradiction pass over the committed data/investors.json without calling
// Cala, so a logic change reaches the shipped data. Usage:
//   npx tsx scripts/refinalize.ts --now 2026-11-14T05:31:21.300Z [--write]
// --now must be the original build time: it decides which deals fall inside the 24-month window.
// The script first proves --now reproduces the stored revealed vectors, then:
// - clamps deal dates later than --now (month-only dates were pinned to the 15th) to the 1st of
//   their month, or to the ingest date if that is still in the future;
// - recomputes revealed for investors whose deals changed (others keep their stored vectors,
//   so the diff carries no float noise), then contradiction, line and thinHistory.
import fs from "node:fs";
import path from "node:path";
import {
  CONTRADICTION_THRESHOLD,
  THIN_HISTORY_MIN_DEALS,
  computeRevealed,
  contradictionLine,
  contradictionScore,
} from "../lib/revealed";
import type { Deal, Investor } from "../lib/types";

const FILE = path.join(process.cwd(), "data/investors.json");
const TOLERANCE = 1e-6;

const args = process.argv.slice(2);
const nowArg = args[args.indexOf("--now") + 1];
if (!args.includes("--now") || !nowArg || Number.isNaN(Date.parse(nowArg))) {
  console.error("usage: tsx scripts/refinalize.ts --now <ISO build time> [--write]");
  process.exit(1);
}
const now = new Date(nowArg);
const ingestDay = now.toISOString().slice(0, 10);
const before = JSON.parse(fs.readFileSync(FILE, "utf8")) as Investor[];

function drift(a: Partial<Record<string, number>>, b: Partial<Record<string, number>>): number {
  let d = 0;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) d += Math.abs((a[k] ?? 0) - (b[k] ?? 0));
  return d;
}

function clampDate(date: string | undefined): string | undefined {
  if (!date || !(Date.parse(date) > now.getTime())) return date;
  const first = `${date.slice(0, 7)}-01`;
  return Date.parse(first) > now.getTime() ? ingestDay : first;
}

const problems: string[] = [];
let datesClamped = 0;
let revealedChanged = 0;
const after = before.map((inv) => {
  const check = computeRevealed(inv.deals, now);
  const d = drift(inv.revealed.S, check.S) + drift(inv.revealed.G, check.G);
  if (d > TOLERANCE || inv.revealed.dealCount24m !== check.dealCount24m)
    problems.push(`${inv.id}: revealed drift ${d.toExponential(2)}`);

  let touched = false;
  const deals: Deal[] = inv.deals.map((deal) => {
    const date = clampDate(deal.date);
    if (date === deal.date) return deal;
    touched = true;
    datesClamped++;
    return { ...deal, date };
  });
  const revealed = touched ? computeRevealed(deals, now) : inv.revealed;
  if (touched && JSON.stringify(revealed) !== JSON.stringify(inv.revealed)) revealedChanged++;
  const thinHistory = revealed.dealCount24m < THIN_HISTORY_MIN_DEALS;
  const contradiction = thinHistory ? 0 : contradictionScore(inv.statedThesis, revealed);
  const line =
    contradiction > CONTRADICTION_THRESHOLD ? contradictionLine({ statedThesis: inv.statedThesis, deals }, now) : undefined;

  const next: Record<string, unknown> = { ...inv, deals, revealed, contradiction, thinHistory };
  delete next.contradictionLine;
  if (line) next.contradictionLine = line;
  return next as Investor;
});

if (problems.length) {
  console.error(`--now does not reproduce the stored data (${problems.length} investors):\n${problems.slice(0, 5).join("\n")}`);
  process.exit(1);
}

let linesChanged = 0;
let scoresChanged = 0;
let badgesBefore = 0;
let badgesAfter = 0;
for (let i = 0; i < before.length; i++) {
  const a = before[i];
  const b = after[i];
  if (Math.abs(a.contradiction - b.contradiction) > TOLERANCE) scoresChanged++;
  if (a.contradiction > CONTRADICTION_THRESHOLD) badgesBefore++;
  if (b.contradiction > CONTRADICTION_THRESHOLD) badgesAfter++;
  if (a.contradictionLine === b.contradictionLine) continue;
  linesChanged++;
  console.log(`${a.id}\n  before: ${a.contradictionLine ?? "-"}\n  after:  ${b.contradictionLine ?? "-"}`);
}
const count = (xs: Investor[]) => xs.filter((i) => i.contradictionLine).length;
console.log(
  [
    `${before.length} investors`,
    `deal dates clamped ${datesClamped}`,
    `revealed recomputed ${revealedChanged}`,
    `contradiction scores changed ${scoresChanged}`,
    `score > ${CONTRADICTION_THRESHOLD}: ${badgesBefore} -> ${badgesAfter}`,
    `lines changed ${linesChanged} (${count(before)} -> ${count(after)})`,
  ].join("; "),
);
if (args.includes("--write")) {
  fs.writeFileSync(FILE, JSON.stringify(after, null, 2));
  console.log(`wrote ${FILE}`);
}
