// Pure assembly of the account memory: Cala graph facts + website facts + founder claims -> one
// ContextDoc, and its short Markdown export.
import { slugify, normaliseRound } from "@/lib/cala";
import { fallbackExtract } from "@/lib/fallbackExtract";
import { SECTOR_SHORT, STAGE_LABELS, isSector, type Sector, type Stage } from "@/lib/taxonomy";
import type { FounderProfile } from "@/lib/types";
import type { CalaFacts, Claim, ContextDoc, ContextRound, RankedSource, WebsiteFacts } from "./types";

export type DocInput = {
  name?: string;
  website?: string;
  cala?: CalaFacts;
  site?: WebsiteFacts;
  pitchProfile?: Partial<FounderProfile>;
  visionText?: string;
  founderClaims?: Claim[];
  now: Date;
};

const CALA_SOURCE: RankedSource = { name: "Cala" };

function usd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1).replace(/\.0$/, "")}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}k`;
  return `$${n}`;
}

export function roundLine(r: ContextRound): string {
  const amount = r.amountText ?? (r.amountUsd ? usd(r.amountUsd) : undefined);
  const parts = [r.label, amount ? `(${amount}${r.amountText && r.amountUsd ? `, ~${usd(r.amountUsd)}` : ""})` : ""];
  let s = parts.filter(Boolean).join(" ");
  if (r.date) s += `, ${r.date}`;
  if (r.leads.length) s += `, led by ${r.leads.join(", ")}`;
  const others = r.investors.filter((i) => !r.leads.includes(i));
  if (others.length) s += `${r.leads.length ? ", with" : ", investors:"} ${others.join(", ")}`;
  return s;
}

function topSector(sectors: Partial<Record<Sector, number>> | undefined): Sector | undefined {
  const e = Object.entries(sectors ?? {}).filter(([k, v]) => isSector(k) && k !== "other" && (v ?? 0) > 0);
  e.sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
  return e[0]?.[0] as Sector | undefined;
}

function inferSector(text: string): Sector | undefined {
  const s = fallbackExtract(text).sectors.find((x) => x.label !== "other");
  return s?.label;
}

function stageFrom(input: DocInput): Stage | undefined {
  if (input.pitchProfile?.stage) return input.pitchProfile.stage;
  const code = input.cala?.fundingStage?.replace(/_/g, " ");
  const fromCode = code ? normaliseRound(code) : undefined;
  if (fromCode && fromCode !== "unknown") return fromCode;
  const latest = input.cala?.rounds.find((r) => r.stage !== "unknown");
  return latest && latest.stage !== "unknown" ? latest.stage : undefined;
}

function calaClaims(c: CalaFacts): Claim[] {
  const out: Claim[] = [];
  const add = (text: string, source?: RankedSource) => out.push({ text, basis: "cala", source: source ?? CALA_SOURCE });
  if (c.description) add(c.description, c.source);
  if (c.founded) add(`Founded ${c.founded}${c.hq ? `, headquartered in ${c.hq}` : ""}.`, c.source);
  if (c.founders.length) add(`Founders: ${c.founders.map((f) => (f.role ? `${f.name} (${f.role})` : f.name)).join(", ")}.`, c.founders[0].source);
  for (const r of c.rounds) add(`Raised ${roundLine(r)}.`, r.sources[0]);
  if (c.headcount) add(`Headcount: ${c.headcount.value}.`, c.headcount.source);
  return out;
}

function siteClaims(s: WebsiteFacts): Claim[] {
  const out: Claim[] = [];
  const add = (text: string) => out.push({ text, basis: "website", source: s.source });
  if (s.product) add(s.product);
  if (s.customers.length) add(`Customers named on the website: ${s.customers.join(", ")}.`);
  if (s.pricing) add(`Pricing: ${s.pricing}`);
  if (s.team.length) add(`Team on the website: ${s.team.join("; ")}.`);
  return out;
}

function profileClaims(p: Partial<FounderProfile>): Claim[] {
  const out: Claim[] = [];
  const src: RankedSource = { name: "Founder pitch" };
  const add = (text: string) => out.push({ text, basis: "founder", source: src });
  if (p.oneLiner) add(p.oneLiner);
  if (p.traction?.revenue) add(`Revenue: ${p.traction.revenue}.`);
  if (p.traction?.users) add(`Users: ${p.traction.users}.`);
  if (p.traction?.growth) add(`Growth: ${p.traction.growth}.`);
  if (p.raise) add(`Raising ${usd(p.raise)}.`);
  for (const t of p.teamSignals ?? []) add(`Team: ${t}.`);
  if (p.businessModel) add(`Business model: ${p.businessModel}.`);
  return out;
}

export function assembleDoc(input: DocInput): ContextDoc {
  const { cala, site, pitchProfile } = input;
  const name = cala?.name ?? pitchProfile?.company ?? input.name?.trim() ?? "Untitled company";
  const vision = input.visionText?.trim() || undefined;

  const claims: Claim[] = [
    ...(cala ? calaClaims(cala) : []),
    ...(site ? siteClaims(site) : []),
    ...(pitchProfile ? profileClaims(pitchProfile) : []),
    ...(input.founderClaims ?? []),
  ];
  if (vision) claims.push({ text: `Vision: ${vision}`, basis: "founder", source: { name: "Founder vision" } });
  const seen = new Set<string>();
  const unique = claims.filter((c) => {
    const k = `${c.basis}:${c.text.toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const website = cala?.website ?? site?.url ?? input.website ?? pitchProfile?.website;
  const sector =
    topSector(pitchProfile?.sectors) ??
    inferSector([cala?.description, site?.product, pitchProfile?.oneLiner, ...(input.founderClaims ?? []).map((c) => c.text)].filter(Boolean).join(". "));
  const stage = stageFrom(input);

  const doc: ContextDoc = {
    id: cala?.calaIds[0] ?? (slugify(name) || "company"),
    calaIds: cala?.calaIds ?? [],
    company: { name },
    founders: cala?.founders ?? [],
    investors: cala?.investors ?? [],
    rounds: cala?.rounds ?? [],
    claims: unique,
    coverage: {
      cala: !!cala,
      website: !!site,
      founder: unique.some((c) => c.basis === "founder"),
    },
    updatedAt: input.now.toISOString(),
  };
  if (website) doc.company.website = website;
  if (cala?.hq ?? pitchProfile?.geography) doc.company.hq = cala?.hq ?? pitchProfile?.geography;
  if (cala?.founded) doc.company.founded = cala.founded;
  if (stage) doc.company.stage = stage;
  if (sector) doc.company.sector = sector;
  if (cala?.headcount) doc.headcount = cala.headcount;
  const product = site?.product ?? pitchProfile?.oneLiner ?? cala?.description;
  if (product) doc.product = product;
  if (site?.customers.length) doc.customers = site.customers;
  if (site?.pricing) doc.pricing = site.pricing;
  if (site?.team.length) doc.team = site.team;
  if (vision) doc.vision = vision;
  return doc;
}

function link(s: RankedSource | undefined): string {
  if (!s) return "";
  return s.url ? ` ([${s.name}](${s.url}))` : ` (${s.name})`;
}

const BASIS_TITLE = { cala: "From Cala", website: "From the website", founder: "From the founder" } as const;
const MISSING_LABEL = { cala: "Cala", website: "website", founder: "founder" } as const;

export function docToMarkdown(doc: ContextDoc): string {
  const c = doc.company;
  const meta = [
    c.website,
    c.hq,
    c.founded ? `founded ${c.founded}` : undefined,
    c.stage ? STAGE_LABELS[c.stage] : undefined,
    c.sector ? SECTOR_SHORT[c.sector] : undefined,
    doc.headcount ? `${doc.headcount.value} people` : undefined,
  ].filter(Boolean);
  const lines: string[] = [`# ${c.name}`, ""];
  if (meta.length) lines.push(meta.join(" · "), "");
  if (doc.product) lines.push("## Product", doc.product, "");
  if (doc.vision) lines.push("## Vision", doc.vision, "");
  if (doc.founders.length) {
    lines.push("## Founders");
    for (const f of doc.founders) lines.push(`- ${f.name}${f.role ? `, ${f.role}` : ""}${link(f.source)}`);
    lines.push("");
  }
  if (doc.rounds.length) {
    lines.push("## Funding");
    for (const r of doc.rounds) lines.push(`- ${roundLine(r)}${link(r.sources[0])}`);
    lines.push("");
  }
  if (doc.investors.length) {
    lines.push("## Investors");
    for (const i of doc.investors.slice(0, 15))
      lines.push(`- ${i.name}${i.round ? ` (${i.round}${i.lead ? ", lead" : ""})` : i.lead ? " (lead)" : ""}`);
    if (doc.investors.length > 15) lines.push(`- and ${doc.investors.length - 15} more`);
    lines.push("");
  }
  if (doc.customers?.length || doc.pricing) {
    lines.push("## Customers and pricing");
    if (doc.customers?.length) lines.push(`- Customers: ${doc.customers.join(", ")}`);
    if (doc.pricing) lines.push(`- Pricing: ${doc.pricing}`);
    lines.push("");
  }
  for (const basis of ["cala", "website", "founder"] as const) {
    const cs = doc.claims.filter((x) => x.basis === basis);
    if (!cs.length) continue;
    lines.push(`## ${BASIS_TITLE[basis]}`);
    for (const x of cs) lines.push(`- ${x.text}${link(x.source)}`);
    lines.push("");
  }
  const missing = (["cala", "website", "founder"] as const).filter((k) => !doc.coverage[k]);
  if (missing.length) lines.push(`_No ${missing.map((m) => MISSING_LABEL[m]).join(", ")} data yet._`, "");
  lines.push(`_Updated ${doc.updatedAt.slice(0, 10)}. Evidence from public sources and the founder; not a forecast._`);
  return lines.join("\n") + "\n";
}
