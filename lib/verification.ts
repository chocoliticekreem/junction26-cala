import type { FounderProfile, Investor, Verification } from "./types";

const FREE_MAIL = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "hotmail.com",
  "hotmail.co.uk",
  "outlook.com",
  "live.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
]);

const EMAIL_RE = /^[^\s@]+@([a-z0-9-]+(?:\.[a-z0-9-]+)+)$/i;

export function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function emailDomain(email: string | undefined): string | undefined {
  const m = email?.trim().match(EMAIL_RE);
  return m ? m[1].toLowerCase() : undefined;
}

// Safe for scheme-less values such as "seedcamp.com"; undefined for anything unparseable.
export function hostOf(url: string | undefined): string | undefined {
  const raw = url?.trim();
  if (!raw) return undefined;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
    if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
    if (!u.hostname.includes(".")) return undefined;
    return u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

const sameOrSub = (domain: string, host: string) => domain === host || domain.endsWith(`.${host}`);

export function verifyInvestor(input: { name: string; email: string }, inv: Investor): Verification {
  const wanted = normalizeName(input.name);
  const partner = wanted ? inv.partners.find((p) => normalizeName(p.name) === wanted) : undefined;
  const nameCheck = partner
    ? { name: "Partner on Cala", passed: true, detail: `Matched ${partner.name} at ${inv.name} (Cala ${partner.calaId})` }
    : {
        name: "Partner on Cala",
        passed: false,
        detail: `No partner named "${input.name.trim()}" linked to ${inv.name} on Cala`,
      };

  const domain = emailDomain(input.email);
  const fundHost = hostOf(inv.website);
  let emailCheck: Verification["checks"][number];
  if (!domain) {
    emailCheck = { name: "Fund-domain email", passed: false, detail: "Not a valid email address" };
  } else if (fundHost) {
    const ok = sameOrSub(domain, fundHost);
    emailCheck = {
      name: "Fund-domain email",
      passed: ok,
      detail: ok ? `@${domain} matches ${fundHost} (format check only)` : `@${domain} is not ${fundHost}`,
    };
  } else {
    const ok = !FREE_MAIL.has(domain);
    emailCheck = {
      name: "Fund-domain email",
      passed: ok,
      detail: ok ? `@${domain} (format check only; fund has no website on file)` : `@${domain} is a personal mailbox`,
    };
  }
  return { subjectId: inv.id, side: "investor", checks: [nameCheck, emailCheck] };
}

export function verifyFounder(f: FounderProfile, opts: { calaFound?: boolean } = {}): Verification {
  const host = hostOf(f.website);
  const isLinkedIn = !!host && (host === "linkedin.com" || host.endsWith(".linkedin.com"));
  const siteCheck = host
    ? { name: "Website or LinkedIn", passed: true, detail: isLinkedIn ? "LinkedIn profile provided" : host }
    : { name: "Website or LinkedIn", passed: false, detail: "Add a company website or LinkedIn URL" };

  const domain = emailDomain(f.email);
  let emailCheck: Verification["checks"][number];
  if (!domain) emailCheck = { name: "Company-domain email", passed: false, detail: "Add a valid work email" };
  else if (FREE_MAIL.has(domain))
    emailCheck = { name: "Company-domain email", passed: false, detail: `@${domain} is a personal mailbox` };
  else emailCheck = { name: "Company-domain email", passed: true, detail: `@${domain} (format check only)` };

  const checks = [siteCheck, emailCheck];
  if (opts.calaFound) checks.push({ name: "Found on Cala", passed: true, detail: "Company resolves to a Cala entity" });
  return { subjectId: f.id, side: "founder", checks };
}
