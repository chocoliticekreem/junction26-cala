import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Extraction, ReplayEvent } from "../lib/types";

const WORDS_PER_SECOND = 2.5;
const WORDS_PER_CHUNK = 3;
const EXTRACTION_DELAY_MS = 800;
const MS_PER_WORD = 1000 / WORDS_PER_SECOND;

const BIO = "biotech/therapeutics" as const;

type Trigger = { phrase: string[]; extraction: Extraction };

const TRIGGERS: Trigger[] = [
  {
    phrase: ["helixa", "bio"],
    extraction: {
      sectors: [],
      company: { value: "Helixa Bio", confidence: 0.9 },
      one_liner: { value: "Therapeutics for autoimmune disease", confidence: 0.85 },
      founder_name: { value: "Amara", confidence: 0.9 },
      triggers: { company: "Helixa Bio", founder_name: "Amara" },
    },
  },
  {
    phrase: ["london"],
    extraction: {
      sectors: [],
      geography: { value: "London", confidence: 0.9 },
      triggers: { geography: "London" },
    },
  },
  {
    phrase: ["therapeutics"],
    extraction: {
      sectors: [{ label: BIO, confidence: 0.8 }],
      triggers: { [BIO]: "therapeutics" },
    },
  },
  {
    phrase: ["antibody"],
    extraction: {
      sectors: [{ label: BIO, confidence: 0.9 }],
      triggers: { [BIO]: "antibody" },
    },
  },
  {
    phrase: ["drug", "discovery"],
    extraction: {
      sectors: [{ label: BIO, confidence: 0.9 }],
      triggers: { [BIO]: "drug discovery" },
    },
  },
  {
    phrase: ["machine", "learning"],
    extraction: {
      sectors: [{ label: "AI infrastructure", confidence: 0.3 }],
      triggers: { "AI infrastructure": "machine learning" },
    },
  },
  {
    phrase: ["wet", "lab"],
    extraction: {
      sectors: [{ label: BIO, confidence: 0.92 }],
      triggers: { [BIO]: "wet lab" },
    },
  },
  {
    phrase: ["pre-seed"],
    extraction: {
      sectors: [],
      stage: { value: "pre-seed", confidence: 0.9 },
      triggers: { stage: "pre-seed" },
    },
  },
  {
    phrase: ["£1.2", "million"],
    extraction: {
      sectors: [],
      raise_amount: { value: 1524000, confidence: 0.85 },
      triggers: { raise_amount: "£1.2 million" },
    },
  },
  {
    phrase: ["letter", "of", "intent"],
    extraction: {
      sectors: [],
      traction: { users: "Letter of intent from a large pharma company", confidence: 0.75 },
      triggers: { traction: "letter of intent" },
    },
  },
  {
    phrase: ["three", "academic", "labs"],
    extraction: {
      sectors: [],
      traction: { users: "3 academic labs using the designs", confidence: 0.8 },
      triggers: { traction: "three academic labs" },
    },
  },
  {
    phrase: ["phds"],
    extraction: {
      sectors: [],
      team_signals: [{ value: "Two PhDs", confidence: 0.85 }],
      triggers: { team_signals: "PhDs" },
    },
  },
  {
    phrase: ["immunology"],
    extraction: {
      sectors: [],
      team_signals: [{ value: "Doctorate in immunology", confidence: 0.85 }],
      triggers: { team_signals: "immunology" },
    },
  },
  {
    phrase: ["phd", "in", "machine", "learning"],
    extraction: {
      sectors: [],
      team_signals: [{ value: "PhD in machine learning", confidence: 0.85 }],
      triggers: { team_signals: "PhD in machine learning" },
    },
  },
];

export function spokenText(script: string): string {
  return script
    .split("\n")
    .filter((line) => !line.startsWith("#") && !line.startsWith(">"))
    .join(" ")
    .trim();
}

function normaliseWord(w: string): string {
  return w.toLowerCase().replace(/^[^\p{L}\p{N}£]+|[^\p{L}\p{N}]+$/gu, "");
}

function findPhrase(words: string[], phrase: string[]): number {
  for (let i = 0; i + phrase.length <= words.length; i++) {
    if (phrase.every((p, j) => words[i + j] === p)) return i + phrase.length - 1;
  }
  return -1;
}

export function buildReplay(script: string): ReplayEvent[] {
  const raw = spokenText(script).split(/\s+/).filter(Boolean);
  const words = raw.map(normaliseWord);
  const events: ReplayEvent[] = [];

  for (let i = 0; i < raw.length; i += WORDS_PER_CHUNK) {
    const last = Math.min(i + WORDS_PER_CHUNK, raw.length) - 1;
    events.push({
      t: Math.round((last + 1) * MS_PER_WORD),
      kind: "transcript",
      text: raw.slice(i, last + 1).join(" "),
    });
  }

  for (const trigger of TRIGGERS) {
    const endIdx = findPhrase(words, trigger.phrase);
    if (endIdx < 0) {
      throw new Error(`Trigger "${trigger.phrase.join(" ")}" not found in the script`);
    }
    events.push({
      t: Math.round((endIdx + 1) * MS_PER_WORD + EXTRACTION_DELAY_MS),
      kind: "profile",
      extraction: trigger.extraction,
    });
  }

  return events
    .map((e, order) => ({ e, order }))
    .sort((a, b) => a.e.t - b.e.t || a.order - b.order)
    .map(({ e }) => e);
}

function main(): void {
  const dir = path.join(process.cwd(), "data", "replay");
  const script = readFileSync(path.join(dir, "demo-pitch.script.md"), "utf8");
  const events = buildReplay(script);
  writeFileSync(path.join(dir, "demo-pitch.json"), JSON.stringify(events, null, 2) + "\n");
  const lastT = events[events.length - 1].t;
  console.log(`Wrote ${events.length} events, duration ${(lastT / 1000).toFixed(1)} s`);
}

if (process.argv[1]?.endsWith("build-replay.ts")) main();
