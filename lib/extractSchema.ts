import type { Extraction } from "./types";
import { ALL_SECTORS, STAGES, isSector, isStage, type Stage } from "./taxonomy";

const confidence = { type: "number", minimum: 0, maximum: 1 } as const;

export const EXTRACTION_TOOL: { name: string; description: string; input_schema: object } = {
  name: "record_pitch_features",
  description:
    "Record the startup features heard in the newest chunk of a founder's pitch. Only include fields the founder actually said or clearly implied; give each a confidence from 0 to 1. Map sectors onto the fixed taxonomy (tolerate speech-to-text misspellings, e.g. 'crisper' means CRISPR, so biotech/therapeutics). Convert the raise amount to US dollars (GBP x1.27, EUR x1.08).",
  input_schema: {
    type: "object",
    properties: {
      sectors: {
        type: "array",
        items: {
          type: "object",
          properties: {
            label: { type: "string", enum: [...ALL_SECTORS] },
            confidence,
          },
          required: ["label", "confidence"],
        },
      },
      stage: {
        type: "object",
        properties: { value: { type: "string", enum: [...STAGES] }, confidence },
        required: ["value", "confidence"],
      },
      raise_amount: {
        type: "object",
        properties: { value: { type: "number", description: "USD" }, confidence },
        required: ["value", "confidence"],
      },
      traction: {
        type: "object",
        properties: {
          revenue: { type: "string" },
          users: { type: "string" },
          growth: { type: "string" },
          confidence,
        },
        required: ["confidence"],
      },
      team_signals: {
        type: "array",
        items: {
          type: "object",
          properties: { value: { type: "string" }, confidence },
          required: ["value", "confidence"],
        },
      },
      geography: {
        type: "object",
        properties: { value: { type: "string" }, confidence },
        required: ["value", "confidence"],
      },
      business_model: {
        type: "object",
        properties: { value: { type: "string" }, confidence },
        required: ["value", "confidence"],
      },
      company: {
        type: "object",
        description: "Startup name, only when the founder states it",
        properties: { value: { type: "string" }, confidence },
        required: ["value", "confidence"],
      },
      one_liner: {
        type: "object",
        description: "What the startup does, in the founder's own words, at most 80 characters",
        properties: { value: { type: "string" }, confidence },
        required: ["value", "confidence"],
      },
      founder_name: {
        type: "object",
        description: "The speaking founder's first name, only when stated",
        properties: { value: { type: "string" }, confidence },
        required: ["value", "confidence"],
      },
      triggers: {
        type: "object",
        description: "Field name (or sector label) to the exact transcript word that triggered it",
        additionalProperties: { type: "string" },
      },
    },
    required: ["sectors"],
  },
};

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);

function conf(x: unknown): number | undefined {
  const n = typeof x === "string" ? parseFloat(x) : x;
  if (typeof n !== "number" || !Number.isFinite(n)) return undefined;
  return Math.min(1, Math.max(0, n));
}

function str(x: unknown): string | undefined {
  return typeof x === "string" && x.trim() ? x.trim() : undefined;
}

const STAGE_ALIASES: Record<string, Stage> = {
  preseed: "pre-seed",
  "pre seed": "pre-seed",
  preidea: "pre-idea",
  "pre idea": "pre-idea",
  "series a": "series-a",
  "series b": "series-b-plus",
  "series b+": "series-b-plus",
  "series-b": "series-b-plus",
  "series-b+": "series-b-plus",
  "series c": "series-b-plus",
};

function toStage(x: unknown): Stage | undefined {
  const s = str(x)?.toLowerCase();
  if (!s) return undefined;
  if (isStage(s)) return s;
  return STAGE_ALIASES[s] ?? STAGE_ALIASES[s.replace(/-/g, " ")];
}

const ONE_LINER_MAX = 80;

// Strict tool schemas cannot cap string length, so an over-long one-liner is cut at a word here.
function oneLinerText(x: unknown): string | undefined {
  const s = str(x);
  if (!s || s.length <= ONE_LINER_MAX) return s;
  const cut = s.lastIndexOf(" ", ONE_LINER_MAX);
  return s.slice(0, cut > 0 ? cut : ONE_LINER_MAX).replace(/[\s,;:.-]+$/, "");
}

function valued<T>(x: unknown, parse: (v: unknown) => T | undefined) {
  if (!isObj(x)) return undefined;
  const value = parse(x.value);
  const c = conf(x.confidence);
  return value === undefined || c === undefined ? undefined : { value, confidence: c };
}

export function parseExtraction(x: unknown): Extraction | null {
  if (!isObj(x)) return null;
  const best = new Map<Extraction["sectors"][number]["label"], number>();
  if (Array.isArray(x.sectors)) {
    for (const s of x.sectors) {
      if (!isObj(s) || typeof s.label !== "string" || !isSector(s.label)) continue;
      const c = conf(s.confidence);
      if (c === undefined) continue;
      best.set(s.label, Math.max(best.get(s.label) ?? 0, c));
    }
  }
  const out: Extraction = {
    sectors: [...best].map(([label, confidence]) => ({ label, confidence })),
  };

  const stage = valued(x.stage, toStage);
  if (stage) out.stage = stage;

  const raise = valued(x.raise_amount, (v) => {
    const n = typeof v === "string" ? parseFloat(v.replace(/[^\d.]/g, "")) : v;
    return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : undefined;
  });
  if (raise) out.raise_amount = raise;

  if (isObj(x.traction)) {
    const c = conf(x.traction.confidence);
    const revenue = str(x.traction.revenue);
    const users = str(x.traction.users);
    const growth = str(x.traction.growth);
    if (c !== undefined && (revenue || users || growth)) {
      out.traction = { confidence: c };
      if (revenue) out.traction.revenue = revenue;
      if (users) out.traction.users = users;
      if (growth) out.traction.growth = growth;
    }
  }

  if (Array.isArray(x.team_signals)) {
    const signals = x.team_signals
      .map((t) => valued(t, str))
      .filter((t): t is { value: string; confidence: number } => !!t);
    if (signals.length) out.team_signals = signals;
  }

  const geo = valued(x.geography, str);
  if (geo) out.geography = geo;
  const model = valued(x.business_model, str);
  if (model) out.business_model = model;
  const company = valued(x.company, str);
  if (company) out.company = company;
  const oneLiner = valued(x.one_liner, oneLinerText);
  if (oneLiner) out.one_liner = oneLiner;
  const founderName = valued(x.founder_name, str);
  if (founderName) out.founder_name = founderName;

  if (isObj(x.triggers)) {
    const triggers: Record<string, string> = {};
    for (const [k, v] of Object.entries(x.triggers)) {
      const s = str(v);
      if (s) triggers[k] = s;
    }
    if (Object.keys(triggers).length) out.triggers = triggers;
  }
  return out;
}
