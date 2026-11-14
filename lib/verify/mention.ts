// String-level checks: does a page or a source title name the company, the amount, an investor?
// Deliberately conservative: a miss means "not shown to mention", never "proven wrong" on its own.

const LEGAL = /\b(limited|ltd|llp|lp|plc|inc|incorporated|corp|corporation|gmbh|ag|sa|sas|sl|s\.l|bv|nv|oy|ab|srl|spa|llc|co|company|holdings?|group|technologies|technology|labs?|ai|hq|io)\b\.?/g;

export function normText(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[‐-―]/g, "-")
    .replace(/[^a-z0-9€£$.,%\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// "TOGL ENERGY LIMITED" -> ["togl energy limited", "togl energy", "togl"]; parentheticals dropped.
export function nameVariants(name: string): string[] {
  const base = normText(name.replace(/\(.*?\)/g, " ")).replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
  const out = new Set<string>();
  if (base) out.add(base);
  const stripped = base.replace(LEGAL, " ").replace(/\s+/g, " ").trim();
  if (stripped && stripped.length >= 3) out.add(stripped);
  // Double-barrelled surnames are often shortened: "Elisenda Bou-Balust" -> "elisenda bou".
  if (/\s\S+-\S+$/.test(base)) out.add(base.replace(/-\S+$/, ""));
  const first = stripped.split(" ")[0];
  // A distinctive first word stands for the company ("togl"), but never a generic one.
  if (first && first.length >= 4 && stripped.split(" ").length > 1 && !GENERIC.has(first)) out.add(first);
  return [...out];
}

const GENERIC = new Set(["the", "open", "smart", "global", "first", "next", "data", "digital", "green", "health", "energy", "capital", "ventures", "partners", "fund", "bio", "tech", "life", "deep", "north", "east", "west", "south"]);

export function mentionsName(text: string, name: string): boolean {
  const t = ` ${normText(text).replace(/[.,]/g, " ")} `;
  return nameVariants(name).some((v) => new RegExp(`[^a-z0-9]${escapeRe(v)}[^a-z0-9]`).test(t));
}

export function mentionsAny(text: string, names: string[]): boolean {
  return names.some((n) => mentionsName(text, n));
}

// The figure in its source currency when the text says one ("EUR 7,000,000", "€7M"), else USD.
export function rawAmount(amountText: string | undefined, amountUsd: number | undefined): number | undefined {
  if (amountText) {
    const m = amountText.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*(k|m|mn|million|b|bn|billion)?\b/i);
    if (m) {
      const scale = m[2] ? ({ k: 1e3, m: 1e6, mn: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9 } as Record<string, number>)[m[2].toLowerCase()] : 1;
      const v = parseFloat(m[1]) * scale;
      if (v >= 1000) return v;
    }
  }
  return amountUsd;
}

function trimNum(n: number): string {
  return (+n.toFixed(2)).toString();
}

// Regexes for one figure as press writes it: 7M, 7 million, 7.0m, 7 millones, 7,000,000, 7.000.000.
export function amountPatterns(value: number): RegExp[] {
  const out: RegExp[] = [];
  const unit = (v: number, words: string) => {
    const s = trimNum(v);
    const alt = s.includes(".") ? `(?:${escapeRe(s)}|${escapeRe(s.replace(".", ","))})` : `${escapeRe(s)}(?:[.,]0+)?`;
    out.push(new RegExp(`(?<![0-9.,])${alt}\\s?(?:${words})(?![a-z])`));
  };
  if (value >= 1e9) unit(value / 1e9, "b|bn|billion|billones|mil millones");
  if (value >= 1e6) unit(value / 1e6, "m|mn|mm|million|millions|millones|milioner|miljoonaa|millionen|mio");
  if (value >= 1e3 && value < 1e7) unit(value / 1e3, "k|thousand|mil");
  const digits = Math.round(value).toString();
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  out.push(new RegExp(`(?<![0-9])(?:${escapeRe(grouped)}|${escapeRe(grouped.replace(/,/g, "."))}|${escapeRe(grouped.replace(/,/g, " "))})(?![0-9])`));
  return out;
}

export function mentionsAmount(text: string, values: (number | undefined)[]): boolean {
  const t = normText(text).replace(/[€£$]/g, " ").replace(/\b(eur|usd|gbp|us)\b/g, " ").replace(/\s+/g, " ");
  return values.some((v) => !!v && v >= 1000 && amountPatterns(v).some((re) => re.test(t)));
}

// Plain-text body of an HTML page (scripts, styles and tags removed).
export function htmlToText(html: string): { title?: string; text: string } {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const body = html
    .replace(/<(script|style|noscript|svg)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  return { title: title ? decode(title).trim() : undefined, text: decode(body).replace(/\s+/g, " ").trim() };
}

function decode(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&rsquo;|&lsquo;/g, "'")
    .replace(/&euro;/g, "€")
    .replace(/&pound;/g, "£")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n));
}

// A window of text around the first mention of any name, for an LLM to judge.
export function excerptAround(text: string, names: string[], width = 1500): string {
  const lower = normText(text);
  for (const n of names.flatMap(nameVariants)) {
    const i = lower.indexOf(n);
    if (i >= 0) return lower.slice(Math.max(0, i - width / 2), i + width / 2);
  }
  return lower.slice(0, width);
}
