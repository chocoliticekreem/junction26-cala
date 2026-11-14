import { describe, expect, it } from "vitest";
import type { Verification } from "@/lib/types";
import {
  EXPIRY_DAYS,
  INVESTOR_OPEN_CAP,
  acceptInterest,
  errorMessage,
  declineInterest,
  decideSeat,
  emptyStore,
  expireStale,
  expressInterest,
  interestId,
  openInterestCount,
  recheckVerification,
  requestSeat,
  sendMessage,
  upsertVerification,
  type InterestStore,
  type Result,
} from "@/lib/interest";

const T0 = new Date("2026-11-14T10:00:00Z");
const later = (days: number) => new Date(T0.getTime() + days * 86_400_000);

function store(r: Result): InterestStore {
  if (!r.ok) throw new Error(r.error);
  return r.store;
}
const err = (r: Result) => (r.ok ? "ok" : r.error);

const pass = (subjectId: string, side: Verification["side"]): Verification => ({
  subjectId,
  side,
  checks: [{ name: "x", passed: true }],
});
const failV = (subjectId: string, side: Verification["side"]): Verification => ({
  subjectId,
  side,
  checks: [{ name: "x", passed: true }, { name: "y", passed: false }],
});

const ID = interestId("inv1", "f1");

describe("interest state machine", () => {
  it("none -> interested", () => {
    const s = store(expressInterest(emptyStore(), "inv1", "f1", T0));
    expect(s.interests).toHaveLength(1);
    expect(s.interests[0]).toMatchObject({ id: ID, state: "interested" });
    expect(openInterestCount(s, "inv1")).toBe(1);
  });

  it("rejects a duplicate active interest", () => {
    const s = store(expressInterest(emptyStore(), "inv1", "f1", T0));
    expect(err(expressInterest(s, "inv1", "f1", T0))).toBe("already_interested");
  });

  it("interested -> chat_open when both sides are verified", () => {
    let s = store(expressInterest(emptyStore(), "inv1", "f1", T0));
    s = upsertVerification(upsertVerification(s, pass("inv1", "investor")), pass("f1", "founder"));
    s = store(acceptInterest(s, ID, later(1)));
    expect(s.interests[0].state).toBe("chat_open");
  });

  it("interested -> pending_verification -> chat_open after recheck", () => {
    let s = store(expressInterest(emptyStore(), "inv1", "f1", T0));
    s = upsertVerification(s, pass("inv1", "investor"));
    s = upsertVerification(s, failV("f1", "founder"));
    s = store(acceptInterest(s, ID, later(1)));
    expect(s.interests[0].state).toBe("pending_verification");
    expect(store(recheckVerification(s, ID, later(1))).interests[0].state).toBe("pending_verification");
    s = upsertVerification(s, pass("f1", "founder"));
    expect(s.verifications).toHaveLength(2);
    s = store(recheckVerification(s, ID, later(2)));
    expect(s.interests[0].state).toBe("chat_open");
    expect(err(recheckVerification(s, ID, later(2)))).toBe("not_pending_chat_open");
  });

  it("interested -> declined, and a decline is final", () => {
    let s = store(expressInterest(emptyStore(), "inv1", "f1", T0));
    s = store(declineInterest(s, ID, later(1)));
    expect(s.interests[0].state).toBe("declined");
    expect(openInterestCount(s, "inv1")).toBe(0);
    expect(err(acceptInterest(s, ID, later(1)))).toBe("cannot_accept_from_declined");
    expect(err(expressInterest(s, "inv1", "f1", later(2)))).toBe("declined");
  });

  it("pending_verification -> declined", () => {
    let s = store(expressInterest(emptyStore(), "inv1", "f1", T0));
    s = store(acceptInterest(s, ID, later(1)));
    expect(store(declineInterest(s, ID, later(1))).interests[0].state).toBe("declined");
  });

  it("interested -> expired after 14 days, and can be renewed", () => {
    let s = store(expressInterest(emptyStore(), "inv1", "f1", T0));
    expect(expireStale(s, later(EXPIRY_DAYS - 1)).interests[0].state).toBe("interested");
    expect(expireStale(s, later(EXPIRY_DAYS - 1))).toBe(s);
    const expired = expireStale(s, later(EXPIRY_DAYS));
    expect(expired.interests[0].state).toBe("expired");
    expect(err(acceptInterest(s, ID, later(EXPIRY_DAYS + 1)))).toBe("expired");
    expect(err(declineInterest(s, ID, later(EXPIRY_DAYS + 1)))).toBe("expired");
    s = store(expressInterest(expired, "inv1", "f1", later(EXPIRY_DAYS + 1)));
    expect(s.interests).toHaveLength(1);
    expect(s.interests[0].state).toBe("interested");
  });

  it("caps an investor at 10 open interests; expiry frees slots", () => {
    let s = emptyStore();
    for (let i = 0; i < INVESTOR_OPEN_CAP; i++) s = store(expressInterest(s, "inv1", `f${i}`, T0));
    expect(openInterestCount(s, "inv1")).toBe(10);
    expect(err(expressInterest(s, "inv1", "f99", T0))).toBe("cap_reached");
    expect(err(expressInterest(s, "inv2", "f99", T0))).toBe("ok");
    expect(err(expressInterest(s, "inv1", "f99", later(EXPIRY_DAYS)))).toBe("ok");
    const accepted = store(acceptInterest(s, interestId("inv1", "f0"), T0));
    expect(err(expressInterest(accepted, "inv1", "f99", T0))).toBe("ok");
  });

  it("allows messages only when chat_open", () => {
    let s = store(expressInterest(emptyStore(), "inv1", "f1", T0));
    expect(err(sendMessage(s, ID, "investor", "hi", T0))).toBe("chat_locked");
    s = store(acceptInterest(s, ID, T0));
    expect(err(sendMessage(s, ID, "founder", "hi", T0))).toBe("chat_locked");
    s = upsertVerification(upsertVerification(s, pass("inv1", "investor")), pass("f1", "founder"));
    s = store(recheckVerification(s, ID, T0));
    expect(err(sendMessage(s, ID, "founder", "   ", T0))).toBe("empty_message");
    s = store(sendMessage(s, ID, "founder", "  Hello!  ", T0));
    expect(s.messages).toEqual([{ interestId: ID, from: "founder", text: "Hello!", at: T0.toISOString() }]);
    expect(err(sendMessage(s, "nope", "founder", "x", T0))).toBe("not_found");
  });

  it("never mutates the input store", () => {
    const s = emptyStore();
    expressInterest(s, "inv1", "f1", T0);
    expect(s).toEqual(emptyStore());
  });
});

describe("seat requests", () => {
  it("allows one open request per founder", () => {
    let s = store(requestSeat(emptyStore(), "room1", "f1", T0));
    expect(s.seats[0].state).toBe("requested");
    expect(err(requestSeat(s, "room2", "f1", T0))).toBe("open_request_exists");
    expect(err(requestSeat(s, "room1", "f2", T0))).toBe("ok");
    s = store(decideSeat(s, "room1", "f1", "waitlisted", T0));
    expect(s.seats[0].state).toBe("waitlisted");
    expect(err(requestSeat(s, "room1", "f1", T0))).toBe("already_decided");
    s = store(requestSeat(s, "room2", "f1", T0));
    expect(s.seats).toHaveLength(2);
  });

  it("requested -> seated | waitlisted; waitlisted -> seated", () => {
    let s = store(requestSeat(emptyStore(), "room1", "f1", T0));
    s = store(decideSeat(s, "room1", "f1", "seated", T0));
    expect(s.seats[0].state).toBe("seated");
    expect(err(decideSeat(s, "room1", "f1", "waitlisted", T0))).toBe("cannot_waitlisted_from_seated");
    let w = store(requestSeat(emptyStore(), "room1", "f1", T0));
    w = store(decideSeat(w, "room1", "f1", "waitlisted", T0));
    expect(store(decideSeat(w, "room1", "f1", "seated", T0)).seats[0].state).toBe("seated");
    expect(err(decideSeat(emptyStore(), "room1", "f1", "seated", T0))).toBe("not_found");
  });
});

describe("errorMessage", () => {
  it("turns result codes into human copy", () => {
    expect(errorMessage("cap_reached")).toBe(`You have ${INVESTOR_OPEN_CAP} open requests; wait for answers before sending more`);
    expect(errorMessage("declined")).toBe("They said not now");
    expect(errorMessage("open_request_exists")).toBe("You already have an open seat request");
    expect(errorMessage("cannot_accept_from_declined")).not.toMatch(/_/);
  });
});
