import type { Extraction } from "./types";
import type { Sector, Stage } from "./taxonomy";

// Fixed demo rates; the spec only needs the order of magnitude right.
export const FX_TO_USD = { GBP: 1.27, EUR: 1.08, USD: 1 } as const;
type Currency = keyof typeof FX_TO_USD;

// [sector, strong terms, weak terms]. Terms are regex fragments, matched case-insensitively
// on word boundaries. Misspellings STT produces ("crisper") live alongside the real word.
const SECTOR_TERMS: [Sector, string[], string[]][] = [
  [
    "biotech/therapeutics",
    [
      "biotech(?:nology)?",
      "bio-tech",
      "therapeutics?",
      "therap(?:y|ies)",
      "drug discovery",
      "drug development",
      "drug candidates?",
      "crispr",
      "crisper",
      "crisp r",
      "gene (?:therapy|editing)",
      "antibod(?:y|ies)",
      "biologics?",
      "small molecules?",
      "oncology",
      "pre-?clinical",
      "biopharma",
      "mrna",
      "cell therapy",
      "synthetic biology",
      "synbio",
      "vaccines?",
      "peptides?",
    ],
    ["drugs?", "molecules?", "proteins?", "pharma(?:ceutical)?s?", "clinical trials?", "genomics?"],
  ],
  [
    "medtech/devices",
    [
      "medtech",
      "med-tech",
      "medical devices?",
      "implants?",
      "implantable",
      "surgical",
      "catheters?",
      "diagnostics?",
      "ultrasound",
      "glucose monitors?",
    ],
    ["wearables?", "imaging", "sensors? for patients"],
  ],
  [
    "healthtech",
    ["healthtech", "health tech", "digital health", "tele(?:health|medicine)", "mental health"],
    ["healthcare", "nhs", "clinics?", "care homes?", "gps"],
  ],
  [
    "insurtech",
    ["insurtech", "insurance", "insurers?", "underwriting", "actuarial"],
    ["claims", "premiums?"],
  ],
  [
    "fintech",
    ["fintech", "payments?", "neobank", "open banking", "lending", "remittances?", "wealth management"],
    ["banking", "banks?", "loans?", "savings", "trading", "credit"],
  ],
  [
    "crypto/web3",
    ["crypto(?:currency|currencies)?", "web3", "web 3", "blockchain", "defi", "nfts?", "stablecoins?", "bitcoin", "ethereum"],
    ["tokens?", "wallets?"],
  ],
  [
    "proptech",
    ["proptech", "real estate", "property", "landlords?", "tenants?", "lettings"],
    ["rental", "housing", "mortgages?"],
  ],
  [
    "marketplaces",
    ["marketplaces?", "two-sided", "buyers and sellers"],
    ["gig economy", "peer-to-peer"],
  ],
  [
    "consumer",
    ["consumer", "d2c", "dtc", "direct[- ]to[- ]consumer", "e-?commerce"],
    ["shoppers", "fashion", "beauty", "food", "beverages?", "gaming", "brand"],
  ],
  [
    "edtech",
    ["edtech", "education", "tutoring", "teachers?", "e-?learning"],
    ["students?", "schools?", "courses?", "learning"],
  ],
  [
    "mobility",
    ["mobility", "electric vehicles?", "evs", "e-?scooters?", "ride-?hailing", "autonomous vehicles?"],
    ["transport(?:ation)?", "logistics", "fleets?", "cars?"],
  ],
  [
    "climate/energy",
    [
      "climate",
      "carbon",
      "net[- ]zero",
      "decarboni[sz](?:e|ation|ing)",
      "renewables?",
      "solar",
      "wind power",
      "batter(?:y|ies)",
      "cleantech",
      "clean tech",
      "heat pumps?",
      "hydrogen",
      "emissions",
    ],
    ["energy", "grid", "sustainab(?:le|ility)"],
  ],
  [
    "deep tech/hardware",
    ["deep ?tech", "hardware", "semiconductors?", "quantum", "robotics", "photonics", "satellites?"],
    ["robots?", "chips?", "drones?", "materials science", "space"],
  ],
  [
    "AI infrastructure",
    ["ai infra(?:structure)?", "gpus?", "inference", "model training", "mlops", "llmops", "vector databases?", "foundation models?"],
    ["compute"],
  ],
  [
    "developer tools",
    ["developer tools?", "dev ?tools", "devops", "ci/cd", "sdks?", "observability", "open[- ]source"],
    ["developers", "apis?"],
  ],
  [
    "cybersecurity",
    ["cyber ?security", "infosec", "threat detection", "zero trust", "phishing", "ransomware", "malware"],
    ["security", "encryption"],
  ],
  [
    "applied AI/vertical SaaS",
    ["vertical saas", "ai agents?", "copilots?", "ai[- ]powered", "machine learning", "artificial intelligence"],
    ["ai", "automation", "ml"],
  ],
  [
    "B2B SaaS (other)",
    ["b2b saas", "saas", "crm"],
    ["b2b", "enterprise software", "software", "workflows?"],
  ],
];

const SECTOR_RES = SECTOR_TERMS.map(([sector, strong, weak]) => ({
  sector,
  strong: new RegExp(`\\b(?:${strong.join("|")})\\b`, "gi"),
  weak: weak.length ? new RegExp(`\\b(?:${weak.join("|")})\\b`, "gi") : null,
}));

// Off-taxonomy pitches (spec 9.1) emit sector "other" so cards can say "sector unclear,
// matched on stage" instead of forcing a wrong label.
const OFF_TAXONOMY_TERMS = [
  "defen[cs]e(?: tech)?",
  "defen[cs]etech",
  "military",
  "agri-?tech",
  "agriculture",
  "agricultural",
  "farming",
  "gaming",
  "games? studio",
  "video games?",
  "legal ?tech",
  "law ?tech",
  "space ?tech",
  "space (?:industry|startup|company|launch)",
  "satellites?",
  "food (?:&|and) beverage",
  "f&b",
  "fashion",
  "media (?:company|startup|brand|publisher)",
  "publishing",
  "hr ?tech",
  "hr",
  "recruit(?:ing|ment)",
  "gov ?tech",
  "sports?",
];
const OFF_TAXONOMY_RE = new RegExp(`\\b(?:${OFF_TAXONOMY_TERMS.join("|")})\\b`, "gi");
const OFF_TAXONOMY_CONFIDENCE = 0.6;

const STAGE_PATTERNS: { stage: Stage; re: RegExp; confidence: number }[] = [
  { stage: "pre-idea", re: /\b(?:pre[- ]?idea|idea[- ]stage|just an idea)\b/gi, confidence: 0.85 },
  { stage: "pre-seed", re: /\bpre[- ]?seed\b/gi, confidence: 0.9 },
  { stage: "pre-seed", re: /\b(?:angel round|friends and family(?: round)?)\b/gi, confidence: 0.7 },
  { stage: "seed", re: /(?<!pre[- ]?)\bseed\b/gi, confidence: 0.85 },
  { stage: "series-a", re: /\bseries[- ]a\b/gi, confidence: 0.9 },
  {
    stage: "series-b-plus",
    re: /\b(?:series[- ][b-f]|growth[- ]stage|late[- ]stage)\b/gi,
    confidence: 0.85,
  },
];

const TEAM_PATTERNS: { value: string; re: RegExp }[] = [
  { value: "PhD", re: /\b(?:ph\.?\s?d|doctorate)\b/i },
  {
    value: "second-time founder",
    re: /\b(?:second[- ]time founders?|serial (?:entrepreneur|founder)s?|founded (?:my|our) (?:first|last|previous) (?:company|startup))\b/i,
  },
  { value: "previous exit", re: /\b(?:exited|previous exit|acquired by|sold (?:my|our) (?:last|previous|first) (?:company|startup))\b/i },
  { value: "university spin-out", re: /\b(?:spin[- ]?out|spun out)\b/i },
  { value: "professor", re: /\bprofessor\b/i },
  { value: "postdoc", re: /\bpost-?docs?\b/i },
  { value: "clinician", re: /\b(?:clinicians?|surgeons?|practising doctors?|nurses?)\b/i },
  { value: "technical co-founder", re: /\b(?:cto|technical co-?founder)\b/i },
];

const GEO_PATTERNS: { value: string; re: RegExp }[] = [
  { value: "London", re: /\blondon\b/i },
  { value: "Manchester", re: /\bmanchester\b/i },
  { value: "Cambridge", re: /\bcambridge\b/i },
  { value: "Oxford", re: /\boxford\b/i },
  { value: "Edinburgh", re: /\bedinburgh\b/i },
  { value: "Bristol", re: /\bbristol\b/i },
  { value: "UK", re: /\b(?:uk|united kingdom|britain)\b/i },
  { value: "Europe", re: /\beurope(?:an)?\b/i },
  { value: "Berlin", re: /\bberlin\b/i },
  { value: "Paris", re: /\bparis\b/i },
  { value: "US", re: /\b(?:US|USA|United States)\b/ },
];

const MODEL_PATTERNS: { value: string; re: RegExp }[] = [
  { value: "B2B SaaS", re: /\bb2b saas\b/i },
  { value: "pharma partnerships", re: /\b(?:pharma partner(?:ship)?s?|partner(?:ing)? with pharma|licens(?:e|ing) (?:to|deals with) pharma)\b/i },
  { value: "licensing", re: /\b(?:licens(?:ing|e fees?)|royalt(?:y|ies))\b/i },
  { value: "marketplace", re: /\b(?:marketplace|take rate|commission)\b/i },
  { value: "transaction fees", re: /\btransaction fees?\b/i },
  { value: "usage-based", re: /\busage[- ]based\b/i },
  { value: "freemium", re: /\bfreemium\b/i },
  { value: "subscription", re: /\b(?:subscriptions?|per seat|monthly fee|annual contract)\b/i },
  { value: "D2C", re: /\b(?:d2c|direct[- ]to[- ]consumer)\b/i },
  { value: "B2B", re: /\bb2b\b/i },
];

const WORD_NUMBERS: Record<string, number> = {
  a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40,
  fifty: 50, "half a": 0.5,
};

const MULTIPLIERS: Record<string, number> = {
  k: 1e3, thousand: 1e3, m: 1e6, mm: 1e6, million: 1e6, bn: 1e9, billion: 1e9,
};

const CURRENCY_RE = "(£|\\$|€|pounds?|gbp|quid|dollars?|usd|euros?|eur)";
const NUMERIC_MONEY = new RegExp(
  `(?:(£|\\$|€)\\s?)?(\\d{1,3}(?:,\\d{3})+|\\d+(?:\\.\\d+)?)\\s?(k|mm|m|bn|thousand|million|billion)?(?![a-z])(?:\\s?${CURRENCY_RE}(?![a-z]))?`,
  "gi",
);
const WORD_MONEY = new RegExp(
  `\\b(half a|a|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty)(\\s+hundred)?(\\s+and\\s+a\\s+half)?\\s+(thousand|million|billion)\\b(?:\\s+${CURRENCY_RE}(?![a-z]))?`,
  "gi",
);

const REVENUE_AFTER = /^\s*(?:of\s+)?(?:mrr|arr|revenue|in revenue|in sales|turnover|a month|per month|monthly|a year|per year|annual(?:ly)?|recurring)/i;
const REVENUE_BEFORE = /(?:revenue|mrr|arr|turnover|sales)\s+(?:of|at|is|are|hit|reached)?\s*$/i;
const RAISE_STRONG = /\b(?:raising|to raise|looking for|seeking|we need)\b/i;
const RAISE_WEAK = /\b(?:raise|round|investment|funding|ticket)\b/i;

function currencyOf(sym: string | undefined): Currency | undefined {
  if (!sym) return undefined;
  const s = sym.toLowerCase();
  if (s === "£" || s.startsWith("pound") || s === "gbp" || s === "quid") return "GBP";
  if (s === "€" || s.startsWith("euro") || s === "eur") return "EUR";
  if (s === "$" || s.startsWith("dollar") || s === "usd") return "USD";
  return undefined;
}

type Money = { usd: number; text: string; index: number; end: number; explicit: boolean };

function findMoney(text: string): Money[] {
  const out: Money[] = [];
  for (const m of text.matchAll(NUMERIC_MONEY)) {
    const [full, sym, num, mult, cur] = m;
    if (!sym && !mult && !cur) continue;
    const value = parseFloat(num.replace(/,/g, "")) * (mult ? MULTIPLIERS[mult.toLowerCase()] : 1);
    const currency = currencyOf(sym) ?? currencyOf(cur);
    const usd = value * FX_TO_USD[currency ?? "GBP"];
    const idx = m.index ?? 0;
    out.push({ usd, text: full.trim(), index: idx, end: idx + full.length, explicit: !!currency });
  }
  for (const m of text.matchAll(WORD_MONEY)) {
    const [full, word, hundred, half, mult, cur] = m;
    let value = WORD_NUMBERS[word.toLowerCase()] ?? 0;
    if (hundred) value *= 100;
    if (half) value += 0.5;
    value *= MULTIPLIERS[mult.toLowerCase()];
    const currency = currencyOf(cur);
    const idx = m.index ?? 0;
    out.push({
      usd: value * FX_TO_USD[currency ?? "GBP"],
      text: full.trim(),
      index: idx,
      end: idx + full.length,
      explicit: !!currency,
    });
  }
  return out.filter((x) => x.usd > 0).sort((a, b) => a.index - b.index);
}

function sentenceAt(text: string, index: number): string {
  const start = Math.max(
    text.lastIndexOf(".", index - 1),
    text.lastIndexOf("!", index - 1),
    text.lastIndexOf("?", index - 1),
    text.lastIndexOf("\n", index - 1),
  );
  const rest = text.slice(index).search(/[.!?\n](?:\s|$)/);
  return text.slice(start + 1, rest === -1 ? text.length : index + rest);
}

const isRevenue = (text: string, m: Money) =>
  REVENUE_AFTER.test(text.slice(m.end, m.end + 25)) ||
  REVENUE_BEFORE.test(text.slice(Math.max(0, m.index - 25), m.index));

function detectSectors(text: string, ex: Extraction, triggers: Record<string, string>) {
  const offTaxonomy = text.match(OFF_TAXONOMY_RE);
  for (const { sector, strong, weak } of SECTOR_RES) {
    const strongHits = [...text.matchAll(strong)];
    const weakHits = weak ? [...text.matchAll(weak)] : [];
    // An off-taxonomy word ("gaming") outranks a taxonomy label heard only through weak terms.
    if (offTaxonomy && strongHits.length === 0) continue;
    const score = strongHits.length + 0.5 * weakHits.length;
    if (score === 0) continue;
    ex.sectors.push({ label: sector, confidence: Math.min(0.95, 0.45 + 0.2 * score) });
    triggers[sector] = (strongHits[0] ?? weakHits[0])[0];
  }
  if (offTaxonomy) {
    ex.sectors.push({ label: "other", confidence: OFF_TAXONOMY_CONFIDENCE });
    triggers.other = offTaxonomy[0];
  }
  ex.sectors.sort((a, b) => b.confidence - a.confidence);
  if (ex.sectors.length) triggers.sectors = triggers[ex.sectors[0].label];
}

function detectStage(text: string, ex: Extraction, triggers: Record<string, string>) {
  const hits: { stage: Stage; confidence: number; index: number; word: string }[] = [];
  for (const p of STAGE_PATTERNS) {
    for (const m of text.matchAll(p.re)) {
      hits.push({ stage: p.stage, confidence: p.confidence, index: m.index ?? 0, word: m[0] });
    }
  }
  if (!hits.length) return;
  hits.sort((a, b) => a.index - b.index);
  const inRaise = hits.find((h) => RAISE_STRONG.test(sentenceAt(text, h.index)));
  const pick = inRaise ?? hits[0];
  ex.stage = { value: pick.stage, confidence: pick.confidence };
  triggers.stage = pick.word;
}

function detectMoney(text: string, ex: Extraction, triggers: Record<string, string>) {
  const money = findMoney(text);
  const raises = money.filter((m) => !isRevenue(text, m));
  const pick =
    raises.find((m) => RAISE_STRONG.test(sentenceAt(text, m.index))) ??
    raises.find((m) => RAISE_WEAK.test(sentenceAt(text, m.index)));
  if (pick) {
    ex.raise_amount = { value: Math.round(pick.usd), confidence: pick.explicit ? 0.85 : 0.7 };
    triggers.raise_amount = pick.text;
  }
  const revenue = money.find((m) => isRevenue(text, m));
  return revenue;
}

const COUNT = "(\\d[\\d,.]*\\s?k?\\+?|one|two|three|four|five|six|seven|eight|nine|ten|twelve|twenty|dozens of|hundreds of|thousands of)";
const USERS_RE = new RegExp(
  `\\b${COUNT}\\s+(?:paying\\s+|active\\s+|monthly\\s+)?(users|customers|patients|clinics|hospitals|downloads|sign-?ups|subscribers|pilots?|labs|pharma partners|design partners)\\b`,
  "i",
);
const GROWTH_RE = /\b(?:growing\s+(?:at\s+)?)?\d+(?:\.\d+)?\s?%\s*(?:month[- ](?:on|over)[- ]month|mom|week[- ](?:on|over)[- ]week|wow|year[- ](?:on|over)[- ]year|yoy|growth|a month|per month|monthly|a week)/i;
const GROWING_RE = /\bgrowing\s+(?:at\s+)?\d+(?:\.\d+)?\s?%/i;

function detectTraction(text: string, revenue: Money | undefined, ex: Extraction, triggers: Record<string, string>) {
  const t: NonNullable<Extraction["traction"]> = { confidence: 0.8 };
  if (revenue) {
    const unit = text.slice(revenue.end).match(REVENUE_AFTER)?.[0] ?? "";
    t.revenue = `${revenue.text}${unit}`.replace(/\s+/g, " ").trim();
  } else if (/\bpre-?revenue\b/i.test(text)) {
    t.revenue = "pre-revenue";
  }
  const users = text.match(USERS_RE);
  if (users) t.users = users[0].trim();
  const growth = text.match(GROWTH_RE) ?? text.match(GROWING_RE);
  if (growth) t.growth = growth[0].trim();
  if (t.revenue || t.users || t.growth) {
    ex.traction = t;
    triggers.traction = (revenue?.text ?? users?.[0] ?? growth?.[0] ?? t.revenue ?? "").trim();
  }
}

function detectTeam(text: string, ex: Extraction, triggers: Record<string, string>) {
  const found: { value: string; confidence: number }[] = [];
  const add = (value: string, word: string) => {
    if (found.some((f) => f.value.toLowerCase() === value.toLowerCase())) return;
    found.push({ value, confidence: 0.8 });
    triggers.team_signals ??= word;
  };
  for (const p of TEAM_PATTERNS) {
    const m = text.match(p.re);
    if (m) add(p.value, m[0]);
  }
  for (const m of text.matchAll(/\bex[- ]([A-Za-z][\w&]+)/gi)) {
    add(`ex-${m[1][0].toUpperCase()}${m[1].slice(1)}`, m[0]);
  }
  for (const m of text.matchAll(/\b(?:formerly|previously)\s+at\s+([A-Z][\w&]+)/g)) {
    add(`ex-${m[1]}`, m[0]);
  }
  if (found.length) ex.team_signals = found;
}

// Identity (display only, never scored: spec 9.4). Names are matched case-sensitively on
// capitalised words, so lowercase STT output yields nothing rather than a wrong name.
const NAME_TOKEN = "[A-Z][A-Za-z0-9&]*(?:\\.[a-z]{2,4})?";
const COMPANY = `(${NAME_TOKEN}(?:\\s+${NAME_TOKEN}){0,2})`;
const PERSON_TOKEN = "[A-Z][a-z]+(?:[-'’][A-Z]?[a-z]+)?";
const PERSON = `(${PERSON_TOKEN}(?:\\s+${PERSON_TOKEN})?)`;

// Capitalised words that are never a company or person name on their own: sentence starters,
// stages and places (which the extractor reads as geography instead).
const NOT_A_NAME = new Set([
  "I", "We", "Our", "My", "The", "A", "An", "This", "That", "It", "There", "Today", "So", "And",
  "But", "Hi", "Hello", "Hey", "Thanks", "Everyone", "Everything", "What", "Here", "Now", "Series",
  "Pre", "Seed", "London", "Manchester", "Cambridge", "Oxford", "Edinburgh", "Bristol", "UK",
  "Britain", "British", "England", "Europe", "European", "Berlin", "Paris", "US", "USA",
  "America", "American", "Imperial", "UCL", "MIT", "Stanford", "Harvard", "Really", "Very", "Just",
]);
const INSTITUTION_RE = /\b(?:University|College|Institute|School|Hospital|Lab|Labs)\b/;
const PAST_ROLE_RE = /\b(?:was|previously|formerly|former|last|ex-?)\s*(?:a\s+|the\s+)?$/i;

function cleanName(raw: string): string | undefined {
  const tokens = raw.split(/\s+/);
  if (NOT_A_NAME.has(tokens[0])) return undefined;
  while (tokens.length > 1 && NOT_A_NAME.has(tokens[tokens.length - 1])) tokens.pop();
  const name = tokens.join(" ");
  return INSTITUTION_RE.test(name) ? undefined : name;
}

const COMPANY_PATTERNS: { re: RegExp; confidence: number }[] = [
  {
    re: new RegExp(
      `\\b(?:(?:[Cc]o-?)?[Ff]ounder(?:\\s+(?:and|&)\\s+(?:CEO|CTO|COO))?|CEO|CTO)\\s+(?:of|at)\\s+${COMPANY}`,
      "g",
    ),
    confidence: 0.85,
  },
  {
    re: new RegExp(
      `(?:^|[.!?]\\s+|,\\s+)${COMPANY}\\s+is\\s+an?\\s+(?:[\\w-]+\\s+){0,3}(?:startup|company)\\b`,
      "g",
    ),
    confidence: 0.75,
  },
  // "We're Helixa Bio, a London startup": only before an article or a sentence end, so
  // "We're Amara and Kwame" or "We're Series A, raising" never become a company.
  {
    re: new RegExp(`\\b[Ww]e(?:['’]re| are)\\s+${COMPANY}(?=,?\\s+an?\\s|[.!?](?:\\s|$))`, "g"),
    confidence: 0.7,
  },
  { re: new RegExp(`\\b[Aa]t\\s+${COMPANY},?\\s+we\\b`, "g"), confidence: 0.6 },
];

const I_AM = "(?:[Ii]['’]m|[Ii] am)";
const FOUNDER_NAME_PATTERNS = [
  new RegExp(
    `\\b(?:${I_AM}|[Mm]y name is|[Mm]y name['’]s)\\s+${PERSON}(?=,?\\s+(?:the\\s+|a\\s+)?(?:(?:[Cc]o-?)?[Ff]ounder|CEO|CTO)\\b|,?\\s+and\\s+I\\b)`,
    "g",
  ),
  new RegExp(
    `\\b(?:[Hh]i|[Hh]ello|[Hh]ey)(?:\\s+(?:everyone|all|there))?,?\\s+${I_AM}\\s+${PERSON}(?=[.!?](?:\\s|$))`,
    "g",
  ),
];

const ONE_LINER_RE =
  /\b[Ww]e(?:['’]re| are)\s+(?:building|making|developing|creating)\s+([^.!?;]+)|\b[Ww]e\s+(?:build|make|develop|create)\s+([^.!?;]+)|\b[Ww]e\s+help\s+([^.!?;]+)/g;
const ONE_LINER_BAD_START =
  /^(?:money|sure|it|its|them|this|that|these|those|our|my|your|their|up|out|progress|use|sense|something|things|everything|lots|a lot|decisions|mistakes)\b/i;
const ONE_LINER_CUT =
  /,\s+(?:specifically|and|but|so|which|because|while|then)\b|\s+[—–-]\s+|\s+(?:right now|today|at the moment)\b/;
const ONE_LINER_MAX = 80;

function cleanOneLiner(raw: string, prefix: string): string | undefined {
  const clause = raw.split(ONE_LINER_CUT)[0].trim().replace(/,$/, "");
  if (ONE_LINER_BAD_START.test(clause)) return undefined;
  let text = `${prefix}${clause.replace(/^(?:a|an|the)\s+/i, "")}`.replace(/\s+/g, " ");
  if (text.split(" ").length < 2) return undefined;
  if (text.length > ONE_LINER_MAX) {
    const comma = text.lastIndexOf(",", ONE_LINER_MAX);
    const space = text.lastIndexOf(" ", ONE_LINER_MAX);
    text = text.slice(0, comma > 20 ? comma : space).trim();
  }
  return text[0].toUpperCase() + text.slice(1);
}

function detectCompany(text: string) {
  let best: { value: string; confidence: number } | undefined;
  for (const p of COMPANY_PATTERNS) {
    for (const m of text.matchAll(p.re)) {
      const index = m.index ?? 0;
      if (PAST_ROLE_RE.test(text.slice(Math.max(0, index - 20), index))) continue;
      const value = cleanName(m[1]);
      if (!value) continue;
      if (!best || p.confidence > best.confidence) best = { value, confidence: p.confidence };
      break;
    }
  }
  return best;
}

function detectIdentity(text: string, ex: Extraction, triggers: Record<string, string>) {
  const company = detectCompany(text);
  if (company) {
    ex.company = company;
    triggers.company = company.value;
  }

  for (const re of FOUNDER_NAME_PATTERNS) {
    const value = [...text.matchAll(re)].map((m) => cleanName(m[1])).find(Boolean);
    if (value && value !== company?.value) {
      ex.founder_name = { value, confidence: 0.8 };
      triggers.founder_name = value;
      break;
    }
  }

  for (const m of text.matchAll(ONE_LINER_RE)) {
    const value = m[3] ? cleanOneLiner(m[3], "helps ") : cleanOneLiner(m[1] ?? m[2], "");
    if (value) {
      ex.one_liner = { value, confidence: 0.7 };
      triggers.one_liner = m[0].trim();
      break;
    }
  }
}

function firstMatch(text: string, patterns: { value: string; re: RegExp }[]) {
  let best: { value: string; word: string; index: number } | undefined;
  for (const p of patterns) {
    const m = p.re.exec(text);
    if (m && (!best || m.index < best.index)) best = { value: p.value, word: m[0], index: m.index };
  }
  return best;
}

export function fallbackExtract(text: string): Extraction {
  const ex: Extraction = { sectors: [] };
  const triggers: Record<string, string> = {};
  if (!text || !text.trim()) return ex;

  detectSectors(text, ex, triggers);
  detectStage(text, ex, triggers);
  const revenue = detectMoney(text, ex, triggers);
  detectTraction(text, revenue, ex, triggers);
  detectTeam(text, ex, triggers);
  detectIdentity(text, ex, triggers);

  const geo = firstMatch(text, GEO_PATTERNS);
  if (geo) {
    ex.geography = { value: geo.value, confidence: 0.8 };
    triggers.geography = geo.word;
  }
  const model = firstMatch(text, MODEL_PATTERNS);
  if (model) {
    ex.business_model = { value: model.value, confidence: 0.75 };
    triggers.business_model = model.word;
  }
  if (Object.keys(triggers).length) ex.triggers = triggers;
  return ex;
}
