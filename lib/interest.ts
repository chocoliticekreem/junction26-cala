import type { Interest, Message, SeatRequest, Verification } from "./types";

export type InterestStore = {
  interests: Interest[];
  messages: Message[];
  seats: SeatRequest[];
  verifications: Verification[];
};

export const INVESTOR_OPEN_CAP = 10;
export const EXPIRY_DAYS = 14;
const EXPIRY_MS = EXPIRY_DAYS * 86_400_000;

export type Result = { ok: true; store: InterestStore } | { ok: false; error: string };

const ERROR_COPY: Record<string, string> = {
  already_interested: "You already sent this founder a request",
  declined: "They said not now",
  cap_reached: `You have ${INVESTOR_OPEN_CAP} open requests; wait for answers before sending more`,
  not_found: "That request no longer exists",
  expired: "This request expired",
  chat_locked: "Chat opens once both sides are verified",
  empty_message: "Write a message first",
  open_request_exists: "You already have an open seat request",
  already_decided: "The host has already answered this seat request",
};

// Result error codes stay machine-readable; this is what a person sees.
export function errorMessage(code: string): string {
  return ERROR_COPY[code] ?? "That did not work; try again";
}

const ok = (store: InterestStore): Result => ({ ok: true, store });
const fail = (error: string): Result => ({ ok: false, error });

export function emptyStore(): InterestStore {
  return { interests: [], messages: [], seats: [], verifications: [] };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const strings = (o: Record<string, unknown>, keys: string[]) => keys.every((k) => typeof o[k] === "string");
const arrayOf = (v: unknown, ok: (o: Record<string, unknown>) => boolean) =>
  Array.isArray(v) && v.every((x) => isObj(x) && ok(x));

// localStorage is user-editable and survives schema changes; anything that is not this shape is
// dropped rather than crashing the page.
export function isInterestStore(v: unknown): v is InterestStore {
  return (
    isObj(v) &&
    arrayOf(v.interests, (i) => strings(i, ["id", "investorId", "founderId", "state", "createdAt", "updatedAt"])) &&
    arrayOf(v.messages, (m) => strings(m, ["interestId", "from", "text", "at"])) &&
    arrayOf(v.seats, (s) => strings(s, ["roomId", "founderId", "state", "at"])) &&
    arrayOf(v.verifications, (x) => strings(x, ["subjectId", "side"]) && arrayOf(x.checks, (c) => typeof c.passed === "boolean"))
  );
}

export function interestId(investorId: string, founderId: string): string {
  return `int_${investorId}_${founderId}`;
}

function isStale(i: Interest, now: Date): boolean {
  return i.state === "interested" && now.getTime() - Date.parse(i.updatedAt) >= EXPIRY_MS;
}

function replaceInterest(s: InterestStore, next: Interest): InterestStore {
  return { ...s, interests: s.interests.map((i) => (i.id === next.id ? next : i)) };
}

export function expireStale(s: InterestStore, now: Date): InterestStore {
  if (!s.interests.some((i) => isStale(i, now))) return s;
  const at = now.toISOString();
  return {
    ...s,
    interests: s.interests.map((i) => (isStale(i, now) ? { ...i, state: "expired", updatedAt: at } : i)),
  };
}

export function openInterestCount(s: InterestStore, investorId: string): number {
  return s.interests.filter((i) => i.investorId === investorId && i.state === "interested").length;
}

const ACTIVE: Interest["state"][] = ["interested", "accepted", "pending_verification", "chat_open"];

export function expressInterest(
  s: InterestStore,
  investorId: string,
  founderId: string,
  now: Date,
): Result {
  const store = expireStale(s, now);
  const id = interestId(investorId, founderId);
  const existing = store.interests.find((i) => i.id === id);
  if (existing && ACTIVE.includes(existing.state)) return fail("already_interested");
  // A decline is final for the pair; only an expired request can be renewed.
  if (existing?.state === "declined") return fail("declined");
  if (openInterestCount(store, investorId) >= INVESTOR_OPEN_CAP) return fail("cap_reached");
  const at = now.toISOString();
  if (existing) return ok(replaceInterest(store, { ...existing, state: "interested", createdAt: at, updatedAt: at }));
  const interest: Interest = { id, investorId, founderId, state: "interested", createdAt: at, updatedAt: at };
  return ok({ ...store, interests: [...store.interests, interest] });
}

function verified(s: InterestStore, subjectId: string, side: Verification["side"]): boolean {
  const v = s.verifications.find((x) => x.subjectId === subjectId && x.side === side);
  return !!v && v.checks.length > 0 && v.checks.every((c) => c.passed);
}

function bothVerified(s: InterestStore, i: Interest): boolean {
  return verified(s, i.investorId, "investor") && verified(s, i.founderId, "founder");
}

function findLive(s: InterestStore, interestId: string, now: Date) {
  const store = expireStale(s, now);
  return { store, interest: store.interests.find((i) => i.id === interestId) };
}

export function acceptInterest(s: InterestStore, interestId: string, now: Date): Result {
  const { store, interest } = findLive(s, interestId, now);
  if (!interest) return fail("not_found");
  if (interest.state === "expired") return fail("expired");
  if (interest.state !== "interested") return fail(`cannot_accept_from_${interest.state}`);
  const state = bothVerified(store, interest) ? "chat_open" : "pending_verification";
  return ok(replaceInterest(store, { ...interest, state, updatedAt: now.toISOString() }));
}

export function declineInterest(s: InterestStore, interestId: string, now: Date): Result {
  const { store, interest } = findLive(s, interestId, now);
  if (!interest) return fail("not_found");
  if (interest.state === "expired") return fail("expired");
  if (interest.state !== "interested" && interest.state !== "pending_verification")
    return fail(`cannot_decline_from_${interest.state}`);
  return ok(replaceInterest(store, { ...interest, state: "declined", updatedAt: now.toISOString() }));
}

// The investor takes back an unanswered request, which frees its slot under the cap at once
// instead of waiting out the 14-day expiry. The pair can be asked again later.
export function withdrawInterest(s: InterestStore, interestId: string, now: Date): Result {
  const { store, interest } = findLive(s, interestId, now);
  if (!interest) return fail("not_found");
  if (interest.state === "expired") return fail("expired");
  if (interest.state !== "interested") return fail(`cannot_withdraw_from_${interest.state}`);
  return ok(replaceInterest(store, { ...interest, state: "withdrawn", updatedAt: now.toISOString() }));
}

export function recheckVerification(s: InterestStore, interestId: string, now: Date): Result {
  const interest = s.interests.find((i) => i.id === interestId);
  if (!interest) return fail("not_found");
  if (interest.state !== "pending_verification") return fail(`not_pending_${interest.state}`);
  if (!bothVerified(s, interest)) return ok(s);
  return ok(replaceInterest(s, { ...interest, state: "chat_open", updatedAt: now.toISOString() }));
}

export function sendMessage(
  s: InterestStore,
  interestId: string,
  from: "investor" | "founder",
  text: string,
  now: Date,
): Result {
  const interest = s.interests.find((i) => i.id === interestId);
  if (!interest) return fail("not_found");
  if (interest.state !== "chat_open") return fail("chat_locked");
  const body = text.trim();
  if (!body) return fail("empty_message");
  return ok({ ...s, messages: [...s.messages, { interestId, from, text: body, at: now.toISOString() }] });
}

export function requestSeat(s: InterestStore, roomId: string, founderId: string, now: Date): Result {
  if (s.seats.some((x) => x.founderId === founderId && x.state === "requested"))
    return fail("open_request_exists");
  if (s.seats.some((x) => x.founderId === founderId && x.roomId === roomId))
    return fail("already_decided");
  const seat: SeatRequest = { roomId, founderId, state: "requested", at: now.toISOString() };
  return ok({ ...s, seats: [...s.seats, seat] });
}

export function decideSeat(
  s: InterestStore,
  roomId: string,
  founderId: string,
  decision: "seated" | "waitlisted",
  now: Date,
): Result {
  const seat = s.seats.find((x) => x.roomId === roomId && x.founderId === founderId);
  if (!seat) return fail("not_found");
  const allowed = seat.state === "requested" || (seat.state === "waitlisted" && decision === "seated");
  if (!allowed) return fail(`cannot_${decision}_from_${seat.state}`);
  const next: SeatRequest = { ...seat, state: decision, at: now.toISOString() };
  return ok({ ...s, seats: s.seats.map((x) => (x === seat ? next : x)) });
}

export function upsertVerification(s: InterestStore, v: Verification): InterestStore {
  const rest = s.verifications.filter((x) => !(x.subjectId === v.subjectId && x.side === v.side));
  return { ...s, verifications: [...rest, v] };
}
