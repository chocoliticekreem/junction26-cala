// Action layer: for each chosen investor, the evidence (precedent, partner, events) and a short
// intro email grounded only on the context doc and the precedent.
import { haikuTool } from "@/lib/anthropic";
import {
  CALA_CACHE_DIR,
  MemoryLRU,
  createCalaClient,
  diskCache,
  sessionBudget,
  tieredCache,
  valkeyCache,
  type CalaClient,
  type CalaProjection,
} from "@/lib/cala";
import { SECTOR_SHORT, STAGE_LABELS, STAGES, stageIndex, type Stage } from "@/lib/taxonomy";
import type { Investor, Sector, Source } from "@/lib/types";
import type { CohortLite } from "./cohortRead";
import type { ContextDoc, EmailDraft, EventRef, InvestorAction, Precedent } from "./types";

export const MAX_EMAIL_WORDS = 120;

export function findInvestor(investors: Investor[], id: string): Investor | undefined {
  return investors.find((i) => i.id === id || i.calaId === id);
}

// ---------- precedent ----------

type Candidate = Precedent & { sector?: Sector; stage?: Stage | "unknown" };

function relevance(c: Candidate, sector: Sector | undefined, stage: Stage | undefined): number {
  let s = c.led ? 4 : 0;
  if (sector && c.sector === sector) s += 2;
  if (stage && c.stage && c.stage !== "unknown") {
    const want = stageIndex(stage);
    const got = stageIndex(c.stage);
    if (got === want || got === want + 1) s += 1;
  }
  return s;
}

// The most relevant round this investor led (cohort lead flags), else one it backed (investors.json
// deals carry no lead flag, so those are marked led: false).
export function choosePrecedent(
  inv: Investor,
  cohort: CohortLite | null,
  sector: Sector | undefined,
  stage: Stage | undefined,
): Precedent | undefined {
  const cands: Candidate[] = [];
  if (cohort) {
    for (const r of Object.values(cohort.rounds)) {
      const p = r.participants.find(
        (x) => x.investorId === inv.calaId || cohort.investors[x.investorId]?.investorsJsonId === inv.id,
      );
      if (!p) continue;
      const company = cohort.companies[r.companyId];
      if (!company) continue;
      cands.push({
        company: company.name,
        companyCalaId: company.id,
        round: r.label,
        ...(r.date ? { date: r.date } : {}),
        led: p.isLead === true,
        ...(r.sources[0] ? { source: r.sources[0] } : {}),
        sector: company.sector,
        stage: r.stage,
      });
    }
  }
  for (const d of inv.deals) {
    if (cands.some((c) => c.company.toLowerCase() === d.company.toLowerCase() && c.date === d.date)) continue;
    cands.push({
      company: d.company,
      ...(d.companyCalaId ? { companyCalaId: d.companyCalaId } : {}),
      round: d.round === "unknown" ? "Funding round" : STAGE_LABELS[d.round],
      ...(d.date ? { date: d.date } : {}),
      led: false,
      ...(d.sources[0] ? { source: d.sources[0] } : {}),
      sector: d.sector,
      stage: d.round,
    });
  }
  if (!cands.length) return undefined;
  cands.sort((a, b) => relevance(b, sector, stage) - relevance(a, sector, stage) || (b.date ?? "").localeCompare(a.date ?? ""));
  const best = { ...cands[0] };
  delete best.sector;
  delete best.stage;
  return best;
}

// ---------- events (cache only) ----------

// Byte-identical to the ingest's investor projection, so these are cache reads.
export const EVENTS_PROJECTION: CalaProjection = {
  properties: ["name"],
  relationships: {
    outgoing: {
      PARTICIPATES_IN_FUNDING_ROUND: { limit: 100 },
      PARTICIPATES_IN_CORPORATE_EVENT: { limit: 50 },
      PARTICIPATES_IN_EVENT: { limit: 20 },
    },
  },
};

let cacheOnly: CalaClient | undefined;

// Never sends a request: a zero budget turns every cache miss into a refused call.
export function cacheOnlyCala(): CalaClient {
  cacheOnly ??= createCalaClient({
    apiKey: process.env.CALA_API_KEY || "cache-only",
    cache: tieredCache(new MemoryLRU(200), valkeyCache(), diskCache(CALA_CACHE_DIR)),
    budget: sessionBudget(0),
    maxRetries: 0,
  });
  return cacheOnly;
}

export async function investorEvents(cala: CalaClient, calaId: string): Promise<EventRef[] | undefined> {
  try {
    const e = await cala.retrieve(calaId, EVENTS_PROJECTION);
    const evs = e.relationships?.outgoing?.PARTICIPATES_IN_EVENT ?? [];
    return evs.map((ev) => {
      const p = ev.properties as Record<string, unknown> | undefined;
      const date = [p?.event_date, p?.valid_since].find((d): d is string => typeof d === "string" && !!d);
      return { id: ev.id, name: ev.name, ...(date ? { date } : {}) };
    });
  } catch {
    return undefined;
  }
}

// ---------- email ----------

export type EmailFacts = {
  company: string;
  product?: string;
  stage?: string;
  sector?: string;
  website?: string;
  vision?: string;
  founderClaims: string[];
  investor: string;
  partner?: string;
  precedent?: { company: string; round: string; year?: string; led: boolean };
};

export function emailFacts(doc: ContextDoc, inv: Investor, precedent: Precedent | undefined): EmailFacts {
  const f: EmailFacts = {
    company: doc.company.name,
    founderClaims: doc.claims.filter((c) => c.basis !== "cala").map((c) => c.text).slice(0, 8),
    investor: inv.name,
  };
  if (doc.product) f.product = doc.product;
  if (doc.company.stage) f.stage = STAGE_LABELS[doc.company.stage];
  if (doc.company.sector) f.sector = SECTOR_SHORT[doc.company.sector];
  if (doc.company.website) f.website = doc.company.website;
  if (doc.vision) f.vision = doc.vision;
  if (inv.partners[0]) f.partner = inv.partners[0].name;
  if (precedent)
    f.precedent = {
      company: precedent.company,
      round: precedent.round,
      ...(precedent.date ? { year: precedent.date.slice(0, 4) } : {}),
      led: precedent.led,
    };
  return f;
}

const ALLOWED_CAPS = new Set(
  (
    "i i'm i've i'd i'll we we're we've our my me hi hello dear best thanks thank regards cheers warm kind " +
    "would could can happy looking given since as the this that it its your you if in at with on for and " +
    "but so glad saw noticed congrats congratulations re is are was a an to of from what how why when where " +
    "here there they their let me please sincerely yours any no not today currently quick short open " +
    "intro introducing introduction reaching building " +
    STAGES.join(" ") +
    " pre-seed seed series"
  ).split(/\s+/),
);

const wordsOf = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'&.-]*/gu) ?? [];
const digitsOf = (s: string) => s.replace(/[^\d]/g, "");

// Tokens in the draft that the inputs do not contain: numbers and capitalised words (names,
// companies, places), outside [bracketed placeholders]. Empty = grounded.
export function ungroundedTokens(body: string, facts: EmailFacts): string[] {
  const factText = JSON.stringify(facts);
  const factWords = new Set(wordsOf(factText).map((w) => w.replace(/[.'-]+$/, "")));
  const factNums = (factText.match(/\d[\d,.]*/g) ?? []).map(digitsOf).filter(Boolean);
  const text = body.replace(/\[[^\]]*\]/g, " ");
  const bad = new Set<string>();
  for (const m of text.matchAll(/\d[\d,.]*/g)) {
    const d = digitsOf(m[0]);
    if (d && !factNums.some((n) => n === d || n.startsWith(d))) bad.add(m[0].replace(/[.,]+$/, ""));
  }
  for (const m of text.matchAll(/\b\p{Lu}[\p{L}\p{N}'&-]*/gu)) {
    const w = m[0].toLowerCase().replace(/['-]+$/, "").replace(/'s$/, "");
    if (ALLOWED_CAPS.has(w) || factWords.has(w)) continue;
    bad.add(m[0]);
  }
  return [...bad];
}

export function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

function clip(s: string, words: number): string {
  const w = s.split(/\s+/).filter(Boolean);
  return w.length <= words ? s.trim() : w.slice(0, words).join(" ").replace(/[,;:.]+$/, "") + "...";
}

// Deterministic fallback, built only from the facts.
export function templateDraft(f: EmailFacts): EmailDraft {
  const first = f.partner?.split(/\s+/)[0];
  const opener = f.precedent
    ? `I saw ${f.investor} ${f.precedent.led ? "led" : "backed"} ${f.precedent.company}'s ${f.precedent.round}${f.precedent.year ? ` in ${f.precedent.year}` : ""}.`
    : `I'm reaching out because of ${f.investor}'s investments${f.sector ? ` in ${f.sector}` : ""}.`;
  const what = f.product ? `I'm building ${f.company}: ${clip(f.product, 30)}` : `I'm building ${f.company}. [One line on what it does]`;
  const proof = f.founderClaims.find((c) => /\d/.test(c) && !c.startsWith("Vision:") && c !== f.product);
  const lines = [
    `Hi ${first ?? "[name]"},`,
    "",
    `${opener} ${what}`,
    "",
    proof ? clip(proof, 25) : "[One line of traction]",
  ];
  if (f.vision) lines.push("", `Where we're heading: ${clip(f.vision, 20)}`);
  lines.push("", "Would you be open to a short call?", "", "[Your name]");
  const stage = f.stage ? `${f.stage} ` : "";
  return { subject: `${f.company}: ${stage}intro`.trim(), body: lines.join("\n"), grounded: "template" };
}

export const EMAIL_TOOL = {
  name: "write_intro_email",
  description: "Write a short founder-to-investor intro email.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: { subject: { type: "string" }, body: { type: "string" } },
    required: ["subject", "body"],
  },
};

const EMAIL_SYSTEM = `You write a founder's first email to an investor. Use ONLY the facts given as JSON.
Never add a number, name, customer, metric or claim that is not in the facts. Where a useful fact is
missing, write a placeholder in [square brackets], e.g. [traction]. At most ${MAX_EMAIL_WORDS} words.
Plain, specific, no hype. Mention the precedent if given ("led" only if led is true, else "backed").
Sign off with [Your name].`;

export type Drafter = (facts: EmailFacts) => Promise<{ subject: string; body: string } | null>;

export const haikuDrafter: Drafter = async (facts) => {
  const raw = (await haikuTool({
    system: EMAIL_SYSTEM,
    user: JSON.stringify(facts),
    tool: EMAIL_TOOL,
    maxTokens: 500,
    strict: true,
  })) as { subject?: unknown; body?: unknown } | null;
  if (!raw || typeof raw.subject !== "string" || typeof raw.body !== "string") return null;
  return { subject: raw.subject, body: raw.body };
};

export async function draftEmail(facts: EmailFacts, drafter: Drafter = haikuDrafter): Promise<EmailDraft> {
  let out: { subject: string; body: string } | null = null;
  try {
    out = await drafter(facts);
  } catch (e) {
    console.warn("email draft:", e instanceof Error ? e.message : e);
  }
  if (!out) return templateDraft(facts);
  const bad = ungroundedTokens(`${out.subject}\n${out.body}`, facts);
  if (bad.length || wordCount(out.body) > MAX_EMAIL_WORDS || !out.body.trim()) {
    if (bad.length) console.warn("email draft: ungrounded tokens, using template:", bad.join(", "));
    return templateDraft(facts);
  }
  return { subject: out.subject.trim(), body: out.body.trim(), grounded: "llm" };
}

export function mailtoFor(d: { subject: string; body: string }): string {
  return `mailto:?subject=${encodeURIComponent(d.subject)}&body=${encodeURIComponent(d.body)}`;
}

export function investorSources(inv: Investor, precedent: Precedent | undefined): Source[] {
  const all = [...(precedent?.source ? [precedent.source] : []), ...inv.statedThesis.sources, ...inv.deals.flatMap((d) => d.sources)];
  const seen = new Set<string>();
  return all.filter((s) => {
    const k = s.url ?? s.name;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 5);
}

export async function buildAction(
  doc: ContextDoc,
  inv: Investor,
  deps: { cohort: CohortLite | null; cala: CalaClient | null; drafter?: Drafter },
): Promise<InvestorAction> {
  const precedent = choosePrecedent(inv, deps.cohort, doc.company.sector, doc.company.stage);
  const events = deps.cala ? await investorEvents(deps.cala, inv.calaId) : undefined;
  const emailDraft = await draftEmail(emailFacts(doc, inv, precedent), deps.drafter);
  const p = inv.partners[0];
  const action: InvestorAction = {
    investorId: inv.id,
    name: inv.name,
    calaSources: investorSources(inv, precedent),
    emailDraft,
    mailto: mailtoFor(emailDraft),
  };
  if (inv.website) action.website = inv.website;
  if (p) action.leadPartner = { name: p.name, ...(p.role ? { role: p.role } : {}), calaId: p.calaId };
  if (events?.length) action.events = events;
  if (precedent) action.precedent = precedent;
  return action;
}
