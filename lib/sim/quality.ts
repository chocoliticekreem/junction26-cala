// Investor quality filter, applied at fit time. Cala's round participants include placeholders
// ("Founders", "Early strategic investors", "+4 others"), lists of individuals ("angels from
// Stripe") and entities that are not venture investors (charitable foundations). None of them can
// be a simulated lead, and the generic / non-investor ones are dropped from the round graph.
//
// Known ceiling: "Founders" is dropped as generic although in some rounds (Ramp) it is Cala's
// truncation of Founders Fund; the fix belongs upstream in the ingest's investor aliasing.

const GENERIC_WORDS = new Set([
  "a", "additional", "and", "angel", "angels", "backers", "business", "co-founder", "co-founders", "cofounder",
  "cofounders", "consulting", "early", "employees", "existing", "family", "few", "founder", "founders", "four",
  "friends", "from", "group", "including", "individual", "individuals", "investor", "investors", "management",
  "new", "of", "office", "offices", "operators", "other", "others", "participants", "previous", "prior", "private",
  "regional", "seed", "several", "strategic", "team", "the", "undisclosed", "unnamed", "various", "unicorn",
]);

// Lists and descriptions rather than one investing entity.
const LIST_PATTERNS: RegExp[] = [
  /\b(?:and|\+)\s*\d+\s+others?\b/i,
  /^\+?\d+\+?\s+(?:angels?|investors?|others?|backers?|individuals?)\b/i,
  /^(?:business\s+)?angels?(?:\s+investors?)?\s*(?::|including|from|connected|and)/i,
  /^(?:angel|angels|individual|several|strategic)\b.*\binvestors?\b/i,
  /\b(?:part of|investors? included|including|and other angels|\+ business angels)\b/i,
  /\b(?:co-?)?founders? of\b/i,
  /\b(?:co-?founders?|founder)$/i,
  /\band\b.*\binvestors$/i,
  /\bCEO\b/,
];

// Charitable or family foundations are not venture investors; "Foundation Capital" is.
const NON_INVESTOR = /\bfoundation\b/i;
const VENTURE_WORDS = /\b(?:capital|ventures?|fund|partners|vc)\b/i;

export type InvestorDropReason = "generic" | "non_investor";

export function investorDropReason(name: string | undefined): InvestorDropReason | undefined {
  const n = (name ?? "").trim();
  if (!n) return "generic";
  const words = n.toLowerCase().replace(/[^a-z0-9+\- ]+/g, " ").split(/\s+/).filter(Boolean);
  if (words.every((w) => GENERIC_WORDS.has(w) || /^\+?\d+\+?$/.test(w))) return "generic";
  if (LIST_PATTERNS.some((re) => re.test(n))) return "generic";
  if (NON_INVESTOR.test(n) && !VENTURE_WORDS.test(n)) return "non_investor";
  return undefined;
}

// Cala resolved the investor to an entity (not just a name string).
export function isResolvedInvestorId(id: string): boolean {
  return !!id && !id.startsWith("name:");
}

export const MIN_LEAD_ROUNDS = 2;

// A lead candidate needs either a resolved Cala entity or at least two rounds of evidence.
export function isLeadEligible(id: string, rounds: number): boolean {
  return isResolvedInvestorId(id) || rounds >= MIN_LEAD_ROUNDS;
}
