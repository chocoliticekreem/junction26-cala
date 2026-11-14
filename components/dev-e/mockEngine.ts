import type {
  Debrief,
  FounderProfile,
  Interest,
  InterestState,
  Investor,
  Message,
  ScoreBreakdown,
  SeatRequest,
  Verification,
} from "@/lib/types";
import { SECTOR_SHORT, STAGE_LABELS, stageIndex, type Sector, type Stage } from "@/lib/taxonomy";

// Temporary stand-in for lib/interest.ts, lib/verification.ts, lib/scoring.ts (rankFounders)
// and lib/roomBuilder.ts. Same signatures as the contract; swap by repointing components/dev-e/engine.ts.

// ---------- interest.ts ----------

export type InterestStore = { interests: Interest[]; messages: Message[]; seats: SeatRequest[]; verifications: Verification[] };
export const INVESTOR_OPEN_CAP = 10;
export const EXPIRY_DAYS = 14;
export type Result = { ok: true; store: InterestStore } | { ok: false; error: string };

export function emptyStore(): InterestStore {
  return { interests: [], messages: [], seats: [], verifications: [] };
}

function ok(store: InterestStore): Result {
  return { ok: true, store };
}
function fail(error: string): Result {
  return { ok: false, error };
}

export function openInterestCount(s: InterestStore, investorId: string): number {
  return s.interests.filter((i) => i.investorId === investorId && i.state === "interested").length;
}

function verified(s: InterestStore, subjectId: string, side: "investor" | "founder"): boolean {
  const v = s.verifications.find((x) => x.subjectId === subjectId && x.side === side);
  return !!v && v.checks.length > 0 && v.checks.every((c) => c.passed);
}

function setState(s: InterestStore, id: string, state: InterestState, now: Date): InterestStore {
  return {
    ...s,
    interests: s.interests.map((i) => (i.id === id ? { ...i, state, updatedAt: now.toISOString() } : i)),
  };
}

export function expressInterest(s: InterestStore, investorId: string, founderId: string, now: Date): Result {
  const existing = s.interests.find(
    (i) => i.investorId === investorId && i.founderId === founderId && i.state !== "declined" && i.state !== "expired",
  );
  if (existing) return fail("Request already open for this founder");
  if (openInterestCount(s, investorId) >= INVESTOR_OPEN_CAP) return fail(`You have ${INVESTOR_OPEN_CAP} open requests`);
  const at = now.toISOString();
  const interest: Interest = {
    id: `int-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    investorId,
    founderId,
    state: "interested",
    createdAt: at,
    updatedAt: at,
  };
  return ok({ ...s, interests: [...s.interests, interest] });
}

export function acceptInterest(s: InterestStore, interestId: string, now: Date): Result {
  const i = s.interests.find((x) => x.id === interestId);
  if (!i) return fail("Request not found");
  if (i.state !== "interested") return fail(`Cannot accept from state ${i.state}`);
  const both = verified(s, i.investorId, "investor") && verified(s, i.founderId, "founder");
  return ok(setState(s, interestId, both ? "chat_open" : "pending_verification", now));
}

export function declineInterest(s: InterestStore, interestId: string, now: Date): Result {
  const i = s.interests.find((x) => x.id === interestId);
  if (!i) return fail("Request not found");
  if (i.state !== "interested") return fail(`Cannot decline from state ${i.state}`);
  return ok(setState(s, interestId, "declined", now));
}

export function recheckVerification(s: InterestStore, interestId: string, now: Date): Result {
  const i = s.interests.find((x) => x.id === interestId);
  if (!i) return fail("Request not found");
  if (i.state !== "pending_verification") return ok(s);
  const both = verified(s, i.investorId, "investor") && verified(s, i.founderId, "founder");
  return ok(both ? setState(s, interestId, "chat_open", now) : s);
}

export function expireStale(s: InterestStore, now: Date): InterestStore {
  const cutoff = now.getTime() - EXPIRY_DAYS * 86_400_000;
  return {
    ...s,
    interests: s.interests.map((i) =>
      i.state === "interested" && new Date(i.createdAt).getTime() < cutoff
        ? { ...i, state: "expired", updatedAt: now.toISOString() }
        : i,
    ),
  };
}

export function sendMessage(s: InterestStore, interestId: string, from: "investor" | "founder", text: string, now: Date): Result {
  const i = s.interests.find((x) => x.id === interestId);
  if (!i) return fail("Request not found");
  if (i.state !== "chat_open") return fail("Chat is locked until both sides verify");
  const trimmed = text.trim();
  if (!trimmed) return fail("Message is empty");
  return ok({ ...s, messages: [...s.messages, { interestId, from, text: trimmed, at: now.toISOString() }] });
}

export function requestSeat(s: InterestStore, roomId: string, founderId: string, now: Date): Result {
  if (s.seats.some((x) => x.roomId === roomId && x.founderId === founderId)) return fail("Already requested for this room");
  if (s.seats.some((x) => x.founderId === founderId && x.state === "requested")) return fail("You already have one open seat request");
  return ok({ ...s, seats: [...s.seats, { roomId, founderId, state: "requested", at: now.toISOString() }] });
}

export function decideSeat(s: InterestStore, roomId: string, founderId: string, decision: "seated" | "waitlisted", now: Date): Result {
  const seat = s.seats.find((x) => x.roomId === roomId && x.founderId === founderId);
  if (!seat) return fail("No seat request for this founder");
  return ok({
    ...s,
    seats: s.seats.map((x) => (x === seat ? { ...x, state: decision, at: now.toISOString() } : x)),
  });
}

export function upsertVerification(s: InterestStore, v: Verification): InterestStore {
  const rest = s.verifications.filter((x) => !(x.subjectId === v.subjectId && x.side === v.side));
  return { ...s, verifications: [...rest, v] };
}

// ---------- verification.ts ----------

function normalise(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const EMAIL_RE = /^[^\s@]+@([^\s@]+\.[^\s@]{2,})$/;

function fundDomain(inv: Investor): string | undefined {
  if (!inv.website) return undefined;
  try {
    return new URL(inv.website).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

export function verifyInvestor(input: { name: string; email: string }, inv: Investor): Verification {
  const n = normalise(input.name);
  const partner = n ? inv.partners.find((p) => normalise(p.name) === n) : undefined;
  const m = input.email.trim().match(EMAIL_RE);
  const domain = fundDomain(inv);
  const emailOk = !!m && (!domain || m[1].toLowerCase().endsWith(domain));
  return {
    subjectId: inv.id,
    side: "investor",
    checks: [
      {
        name: "Cala partner record",
        passed: !!partner,
        detail: partner ? `Verified via Cala partner record: ${partner.name}${partner.role ? `, ${partner.role}` : ""}` : "Name does not match a partner on Cala",
      },
      {
        name: "Fund-domain email",
        passed: emailOk,
        detail: emailOk ? `Format check only: @${m![1]}` : domain ? `Expected an @${domain} address` : "Enter a valid email",
      },
    ],
  };
}

export function verifyFounder(f: FounderProfile, opts?: { calaFound?: boolean }): Verification {
  const url = f.website?.trim() ?? "";
  const urlOk = /^https?:\/\/[^\s/]+\.[^\s/]{2,}/i.test(url) || /linkedin\.com\/in\//i.test(url);
  const m = (f.email ?? "").trim().match(EMAIL_RE);
  const freeMail = ["gmail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com"];
  const emailOk = !!m && !freeMail.includes(m[1].toLowerCase());
  const checks: Verification["checks"] = [
    { name: "Company website or LinkedIn", passed: urlOk, detail: urlOk ? url : "Add a company website or LinkedIn URL" },
    { name: "Company-domain email", passed: emailOk, detail: emailOk ? `Format check only: @${m![1]}` : "Add a company-domain email" },
  ];
  if (opts?.calaFound) checks.push({ name: "Found on Cala", passed: true, detail: "Company resolves to a Cala entity" });
  return { subjectId: f.id, side: "founder", checks };
}

// ---------- scoring.ts (rankFounders) ----------

export type FounderMatch = { founderId: string; score: number; breakdown: ScoreBreakdown; reason: string };

function stageFit(inv: Investor, stage?: Stage): number {
  if (!stage) return 0.5;
  const G = inv.revealed.G;
  let fit = G[stage] ?? 0;
  const idx = stageIndex(stage);
  for (const [k, v] of Object.entries(G) as [Stage, number][]) {
    if (Math.abs(stageIndex(k) - idx) === 1) fit += 0.5 * v;
  }
  return Math.min(1, fit);
}

export function rankFounders(inv: Investor, founders: FounderProfile[], debriefs?: Debrief[]): FounderMatch[] {
  const mine = (debriefs ?? []).filter((d) => d.investorId === inv.id);
  const debriefAdj = mine.length
    ? (1 + mine.reduce((a, d) => a + (d.fit === "yes" ? 1 : d.fit === "maybe" ? 0.5 : 0), 0)) / (2 + mine.length)
    : 0.5;
  return founders
    .map((f) => {
      const sectorEntries = Object.entries(f.sectors) as [Sector, number][];
      const sectorFit = sectorEntries.reduce((a, [s, w]) => a + w * (inv.revealed.S[s] ?? 0), 0);
      const sf = stageFit(inv, f.stage);
      const [lo, hi] = inv.revealed.chequeBand;
      let chequeFit = 0.5;
      if (f.raise) {
        if (f.raise >= lo && f.raise <= hi) chequeFit = 1;
        else {
          const dist = f.raise < lo ? (lo - f.raise) / lo : (f.raise - hi) / hi;
          chequeFit = Math.max(0, 1 - dist / 2);
        }
      }
      const breakdown: ScoreBreakdown = { sectorFit, stageFit: sf, chequeFit, activity: inv.revealed.activity, debriefAdj };
      const score = Math.round(100 * (0.4 * sectorFit + 0.3 * sf + 0.15 * chequeFit + 0.1 * inv.revealed.activity + 0.05 * debriefAdj));
      const topSector = sectorEntries.sort((a, b) => b[1] - a[1])[0]?.[0];
      const sectorDeals = inv.deals.filter((d) => d.sector === topSector).length;
      const parts: string[] = [];
      if (topSector && sectorFit > 0.2) parts.push(`${sectorDeals} ${SECTOR_SHORT[topSector].toLowerCase()} deals in 24 months`);
      if (f.stage && sf > 0.3) parts.push(`${Math.round((inv.revealed.G[f.stage] ?? 0) * 100)}% of deals at ${STAGE_LABELS[f.stage].toLowerCase()}`);
      if (!parts.length) parts.push(topSector ? `weak sector overlap; matched on stage` : "sector unclear, matched on stage");
      return { founderId: f.id, score, breakdown, reason: parts.join(" · ") };
    })
    .sort((a, b) => b.score - a.score);
}

// ---------- roomBuilder.ts ----------

export type RoomSuggestion = { sector: Sector; count: number; founderIds: string[] };

export function suggestRooms(
  inv: Investor,
  ranked: FounderMatch[],
  founders: FounderProfile[],
  threshold = 12,
  minScore = 40,
): RoomSuggestion[] {
  const byId = new Map(founders.map((f) => [f.id, f]));
  const buckets = new Map<Sector, string[]>();
  for (const m of ranked) {
    if (m.score < minScore) continue;
    const f = byId.get(m.founderId);
    if (!f) continue;
    const top = (Object.entries(f.sectors) as [Sector, number][]).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!top) continue;
    buckets.set(top, [...(buckets.get(top) ?? []), m.founderId]);
  }
  return [...buckets.entries()]
    .filter(([, ids]) => ids.length >= threshold)
    .map(([sector, ids]) => ({ sector, count: ids.length, founderIds: ids }))
    .sort((a, b) => b.count - a.count);
}

export function buildRoom(
  sector: Sector,
  founders: FounderProfile[],
  investors: Investor[],
  debriefs?: Debrief[],
): { founderIds: string[]; investorIds: string[] } {
  const inSector = founders.filter((f) => (f.sectors[sector] ?? 0) >= 0.3);
  const invRanked = investors
    .map((inv) => ({ inv, fit: inv.revealed.S[sector] ?? 0 }))
    .filter((x) => x.fit > 0)
    .sort((a, b) => b.fit - a.fit)
    .slice(0, 3)
    .map((x) => x.inv);
  const totals = new Map<string, number>();
  for (const inv of invRanked) {
    for (const m of rankFounders(inv, inSector, debriefs)) totals.set(m.founderId, (totals.get(m.founderId) ?? 0) + m.score);
  }
  const founderIds = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id]) => id);
  return { founderIds, investorIds: invRanked.map((i) => i.id) };
}
