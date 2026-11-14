// Builds SourceChecks from a source title (free) or a fetched page's text (budgeted, cached).
import { mentionsAmount, mentionsAny, mentionsName, rawAmount } from "./mention";
import { isSpecificUrl } from "./rules";
import type { Claim, ClaimSource, SourceCheck } from "./types";

// Titles that only name a site or a profile ("pitchbook.com", "Cala | LinkedIn", "Home Page") carry
// no information about a round, so they are not checked.
export function isInformativeTitle(name: string | undefined, url: string | undefined): boolean {
  if (!name) return false;
  const n = name.trim();
  if (n.length < 20 || /^https?:\/\//i.test(n)) return false;
  if (/^[\w.-]+\.[a-z]{2,}$/i.test(n)) return false;
  if (/\|\s*linkedin$/i.test(n) || /^(home|home page|portfolio|about|team)\b/i.test(n)) return false;
  try {
    if (url && n.toLowerCase() === new URL(url).hostname.replace(/^www\./, "")) return false;
  } catch {}
  return true;
}

function detail(c: Claim, text: string): Pick<SourceCheck, "mentionsSubject" | "mentionsAmount" | "mentionsInvestor" | "mentionsPerson"> {
  const out: Pick<SourceCheck, "mentionsSubject" | "mentionsAmount" | "mentionsInvestor" | "mentionsPerson"> = {
    mentionsSubject: mentionsName(text, c.subject),
  };
  if (c.amountUsd !== undefined) out.mentionsAmount = mentionsAmount(text, [rawAmount(c.amountText, c.amountUsd), c.amountUsd]);
  const names = [...new Set([...(c.leads ?? []), ...(c.investors ?? [])])];
  if (names.length) out.mentionsInvestor = mentionsAny(text, names);
  if (c.person) out.mentionsPerson = mentionsName(text, c.person);
  return out;
}

export function titleCheck(c: Claim, s: ClaimSource): SourceCheck | undefined {
  if (!isInformativeTitle(s.name, s.url)) return undefined;
  const d = detail(c, s.name);
  if (!d.mentionsSubject) return undefined; // a title that omits the company proves nothing either way
  return { url: s.url ?? `title:${s.name}`, method: "title", status: "ok", ...d };
}

export function pageCheck(c: Claim, url: string, page: { text: string; title?: string } | undefined): SourceCheck {
  if (!isSpecificUrl(url)) return { url, method: "page", status: "not_specific" };
  if (!page || page.text.length < 200) return { url, method: "page", status: "unreachable" };
  return { url, method: "page", status: "ok", ...detail(c, `${page.title ?? ""} ${page.text}`) };
}

// A page that names the company but not the amount or any investor, or names none of them in a
// long article, is worth a second look by Haiku before it counts either way.
export function isBorderline(c: Claim, chk: SourceCheck): boolean {
  if (chk.status !== "ok" || chk.method !== "page") return false;
  if (c.person) return chk.mentionsSubject !== chk.mentionsPerson;
  if (!chk.mentionsSubject) return true;
  const wantsDetail = c.amountUsd !== undefined || (c.investors?.length ?? 0) > 0;
  return wantsDetail && !chk.mentionsAmount && !chk.mentionsInvestor;
}
