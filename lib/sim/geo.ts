// Geography: where a founder or company is, and how much of an investor's real deal flow is there.
//
// countryOf reads a free-text location (Cala's hq strings, a founder's "London" or "Barcelona,
// Spain") and returns the country whose name, alias or city appears EARLIEST in the text, so
// "Austin, Texas, USA (also offices in Budapest, London)" is US and "Karlsruhe, Germany (US
// address: ...)" is DE.
//
// Investor deal geography (built in fit.ts from the cohort's company hq):
//   share_region(i)  = (deals_i in region + B * cohort share of region) / (deals_i + B)
//   share_country(i) = (deals_i in country + B * share_region(i) * country share of its region) / (deals_i + B)
//   geoFit(i)        = GEO_FLOOR + (share_country + share_region) / 2,                B = 3
// so an investor with no located deals backs off to the cohort's mix, and one whose deals are all
// in another region keeps only the floor.
//
// Stage-dependent lead weight (stageGeoWeight): fit.ts measures, over every led round, where the
// lead is based relative to the company (same country / same region / elsewhere) by stage, since a
// seed is mostly local and a Series B+ often is not. The candidate's weight is that mix applied to
// its own deal shares relative to the cohort's:
//   geoFit_s(i) = GEO_FLOOR + p_country(s) * c_i / c_0 + p_region(s) * (r_i - c_i) / (r_0 - c_0)
//                           + p_elsewhere(s) * (1 - r_i) / (1 - r_0)
// c_i, r_i the investor's smoothed shares (geoShares), c_0, r_0 the cohort's. An investor whose deals
// mirror the cohort gets 1 + floor at every stage; a stage with fewer than MIN_STAGE_GEO measured
// rounds uses all stages pooled.
//
// precedentGeoWeight is exported for lib/sim/precedents.ts (owned by the path-ai branch): same
// country 1, same region 0.6, elsewhere 0.25, unknown 0.5.
import type { Cohort, LeadGeoShares } from "./types";

export type Region = "europe" | "north-america" | "middle-east" | "asia-pacific" | "latam" | "africa";
export type Geo = { country?: string; region?: Region; text?: string };

type Rule = { country: string; region: Region; names: RegExp; codes?: RegExp };

const R = (country: string, region: Region, words: string, codes?: string): Rule => ({
  country,
  region,
  names: new RegExp(`(?<![\\p{L}])(?:${words})(?![\\p{L}])`, "iu"),
  codes: codes ? new RegExp(`(?:^|,\\s*|\\(\\s*)(?:${codes})\\b`) : undefined,
});

// Names match case-insensitively; upper-case codes only at the start or after a comma or "(", so
// "Barcelona, ES" is Spain and the pronoun "us" never matches.
const RULES: Rule[] = [
  R("GB", "europe", "united kingdom|england|scotland|wales|northern ireland|london|edinburgh|manchester|bristol|oxford|cambridge, england|glasgow|leeds|great britain|britain", "UK|GB"),
  R("US", "north-america", "united states|usa|new york|san francisco|silicon valley|bay area|palo alto|menlo park|mountain view|sunnyvale|redwood city|los angeles|seattle|boston|austin|chicago|miami|denver|delaware|dover|california|texas|virginia|massachusetts|washington, d\\.?c\\.?|pittsburgh|cambridge, ma|newark", "US|USA|NY|CA|MA|TX|WA"),
  R("ES", "europe", "spain|españa|barcelona|madrid|valencia|catalonia|catalunya|seville|sevilla|bilbao|málaga|malaga|sant cugat|sabadell|cartagena|las palmas|pozuelo", "ES"),
  R("FR", "europe", "france|paris|lyon|marseille|toulouse|saint-mandé", "FR"),
  R("DE", "europe", "germany|deutschland|berlin|munich|münchen|hamburg|frankfurt|cologne|köln|stuttgart|karlsruhe|baden-württemberg"),
  R("NL", "europe", "netherlands|amsterdam|rotterdam|utrecht|eindhoven", "NL"),
  R("BE", "europe", "belgium|brussels|bruxelles|antwerp|ghent", "BE"),
  R("IE", "europe", "ireland|dublin|cork"),
  R("PT", "europe", "portugal|lisbon|lisboa|porto", "PT"),
  R("IT", "europe", "italy|italia|milan|milano|rome|roma|turin|torino|agropoli", "IT"),
  R("CH", "europe", "switzerland|zurich|zürich|geneva|lausanne|basel", "CH"),
  R("AT", "europe", "austria|vienna|wien", "AT"),
  R("SE", "europe", "sweden|stockholm|gothenburg|malmö", "SE"),
  R("DK", "europe", "denmark|copenhagen", "DK"),
  R("NO", "europe", "norway|oslo", "NO"),
  R("FI", "europe", "finland|helsinki|espoo|tampere|oulu", "FI"),
  R("EE", "europe", "estonia|tallinn|tartu", "EE"),
  R("PL", "europe", "poland|warsaw|kraków|krakow", "PL"),
  R("CZ", "europe", "czech republic|czechia|prague|brno", "CZ"),
  R("HU", "europe", "hungary|budapest", "HU"),
  R("RO", "europe", "romania|bucharest|cluj", "RO"),
  R("GR", "europe", "greece|athens", "GR"),
  R("LT", "europe", "lithuania|vilnius"),
  R("LV", "europe", "latvia|riga"),
  R("UA", "europe", "ukraine|kyiv|kiev"),
  R("IL", "middle-east", "israel|tel aviv|tel aviv-yafo|jerusalem|haifa", "IL"),
  R("AE", "middle-east", "united arab emirates|uae|dubai|abu dhabi"),
  R("CA", "north-america", "canada|toronto|montreal|montréal|vancouver|ottawa|waterloo"),
  R("MX", "latam", "mexico|méxico|mexico city"),
  R("BR", "latam", "brazil|brasil|são paulo|sao paulo|rio de janeiro", "BR"),
  R("AR", "latam", "argentina|buenos aires"),
  R("CO", "latam", "colombia|bogotá|bogota|medellín|medellin"),
  R("CL", "latam", "chile|santiago de chile"),
  R("IN", "asia-pacific", "india|bangalore|bengaluru|mumbai|delhi|hyderabad|pune", "IN"),
  R("SG", "asia-pacific", "singapore", "SG"),
  R("JP", "asia-pacific", "japan|tokyo", "JP"),
  R("CN", "asia-pacific", "china|beijing|shanghai|shenzhen|hong kong", "CN|HK"),
  R("KR", "asia-pacific", "south korea|korea|seoul", "KR"),
  R("AU", "asia-pacific", "australia|sydney|melbourne", "AU"),
  R("NG", "africa", "nigeria|lagos"),
  R("KE", "africa", "kenya|nairobi"),
  R("ZA", "africa", "south africa|cape town|johannesburg"),
];

const REGION_OF: Record<string, Region> = Object.fromEntries(RULES.map((r) => [r.country, r.region]));
const REGION_WORDS: [RegExp, Region][] = [
  [/\b(?:europe|european|eu|emea|nordics?|dach|benelux)\b/i, "europe"],
  [/\b(?:north america|us-based)\b/i, "north-america"],
  [/\b(?:latam|latin america)\b/i, "latam"],
  [/\b(?:asia|apac|southeast asia)\b/i, "asia-pacific"],
  [/\b(?:middle east|mena)\b/i, "middle-east"],
  [/\bafrica\b/i, "africa"],
];

export function countryOf(text: string | undefined): string | undefined {
  if (!text) return undefined;
  let best: { country: string; at: number } | undefined;
  for (const r of RULES) {
    for (const re of [r.names, r.codes]) {
      const m = re?.exec(text);
      if (m && (!best || m.index < best.at)) best = { country: r.country, at: m.index };
    }
  }
  return best?.country;
}

export function regionOf(country: string | undefined): Region | undefined {
  return country ? REGION_OF[country] : undefined;
}

export function parseGeo(text: string | undefined): Geo {
  if (!text?.trim()) return {};
  const country = countryOf(text);
  if (country) return { country, region: regionOf(country), text };
  const region = REGION_WORDS.find(([re]) => re.test(text))?.[1];
  return region ? { region, text } : { text };
}

export const GEO_BACKOFF_B = 3;
export const GEO_FLOOR = 0.1;

export type GeoCounts = { n: number; country: Record<string, number>; region: Partial<Record<Region, number>> };

export function emptyGeoCounts(): GeoCounts {
  return { n: 0, country: {}, region: {} };
}

export function addGeo(g: GeoCounts, geo: Geo, w = 1) {
  if (!geo.region) return;
  g.n += w;
  g.region[geo.region] = (g.region[geo.region] ?? 0) + w;
  if (geo.country) g.country[geo.country] = (g.country[geo.country] ?? 0) + w;
}

// The investor's (smoothed) share of deals in the target's country and region; see the header.
export function geoShares(inv: GeoCounts | undefined, base: GeoCounts, target: Geo): { country: number; region: number } {
  if (!target.region) return { country: 0, region: 0 };
  const baseRegion = base.n ? (base.region[target.region] ?? 0) / base.n : 0;
  const n = inv?.n ?? 0;
  const region = ((inv?.region[target.region] ?? 0) + GEO_BACKOFF_B * baseRegion) / (n + GEO_BACKOFF_B);
  if (!target.country) return { country: region, region };
  const baseRegionCount = base.region[target.region] ?? 0;
  const countryInRegion = baseRegionCount ? (base.country[target.country] ?? 0) / baseRegionCount : 0;
  const country = ((inv?.country[target.country] ?? 0) + GEO_BACKOFF_B * region * countryInRegion) / (n + GEO_BACKOFF_B);
  return { country, region };
}

// Lead-candidate multiplier. 1 when the founder's geography is unknown, so nothing is reweighted.
export function investorGeoWeight(inv: GeoCounts | undefined, base: GeoCounts, target: Geo): number {
  if (!target.region) return 1;
  const s = geoShares(inv, base, target);
  return GEO_FLOOR + (s.country + s.region) / 2;
}

export const MIN_STAGE_GEO = 30;

export function stageGeoWeight(
  inv: GeoCounts | undefined,
  base: GeoCounts,
  target: Geo,
  measured: { stage?: LeadGeoShares; overall: LeadGeoShares },
): number {
  if (!target.region) return 1;
  const p = measured.stage && measured.stage.n >= MIN_STAGE_GEO ? measured.stage : measured.overall;
  if (!p.n || !base.n) return investorGeoWeight(inv, base, target);
  const s = geoShares(inv, base, target);
  const r0 = (base.region[target.region] ?? 0) / base.n;
  const c0 = target.country ? (base.country[target.country] ?? 0) / base.n : 0;
  const ratio = (x: number, y: number) => (y > 1e-9 ? Math.max(0, x) / y : 0);
  const lift = target.country && c0 > 0
    ? p.country * ratio(s.country, c0) + p.region * ratio(s.region - s.country, r0 - c0) + p.elsewhere * ratio(1 - s.region, 1 - r0)
    : (p.country + p.region) * ratio(s.region, r0) + p.elsewhere * ratio(1 - s.region, 1 - r0);
  return GEO_FLOOR + lift;
}

export const PRECEDENT_GEO_WEIGHT = { sameCountry: 1, sameRegion: 0.6, elsewhere: 0.25, unknown: 0.5 } as const;

// Weight of a cohort company as a precedent for a founder in `target`.
export function precedentGeoWeight(cohort: Cohort, companyId: string, target: Geo): number {
  if (!target.region) return 1;
  const g = parseGeo(cohort.companies[companyId]?.country ?? cohort.companies[companyId]?.hq);
  if (!g.region) return PRECEDENT_GEO_WEIGHT.unknown;
  if (target.country && g.country === target.country) return PRECEDENT_GEO_WEIGHT.sameCountry;
  if (g.region === target.region) return PRECEDENT_GEO_WEIGHT.sameRegion;
  return PRECEDENT_GEO_WEIGHT.elsewhere;
}
