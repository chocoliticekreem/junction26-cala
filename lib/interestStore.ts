"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { FounderProfile, Room, Verification } from "@/lib/types";
import {
  acceptInterest,
  declineInterest,
  decideSeat,
  emptyStore,
  expireStale,
  expressInterest,
  recheckVerification,
  requestSeat,
  sendMessage,
  upsertVerification,
  SEED_ROOM,
  type InterestStore,
  type Result,
} from "@/lib/engine";

export const INTEREST_KEY = "room.interest.v1";
export const ROOMS_KEY = "room.rooms.v1";
export const LIVE_PROFILE_KEY = "room.liveProfile.v1";
export const IDENTITY_KEY = "room.identity.v1";

export const LIVE_FOUNDER_ID = "live";

type Identity = { founderId: string; investorId: string | null };
const DEFAULT_IDENTITY: Identity = { founderId: LIVE_FOUNDER_ID, investorId: null };

// One parsed snapshot per raw string so useSyncExternalStore sees a stable reference.
const parsedCache = new Map<string, { raw: string | null; value: unknown }>();
const listeners = new Set<() => void>();

function readKey<T>(key: string, fallback: () => T): T {
  if (typeof window === "undefined") return fallback();
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    raw = null;
  }
  const hit = parsedCache.get(key);
  if (hit && hit.raw === raw) return hit.value as T;
  let value: T;
  try {
    value = raw ? (JSON.parse(raw) as T) : fallback();
  } catch {
    value = fallback();
  }
  parsedCache.set(key, { raw, value });
  return value;
}

function writeKey(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or blocked: in-memory state still updates via the cache below
  }
  parsedCache.set(key, { raw: JSON.stringify(value), value });
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key.startsWith("room.")) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

const SERVER_STORE = emptyStore();
const SERVER_ROOMS: Room[] = [SEED_ROOM];

let expiredOnce = false;

function readStore(): InterestStore {
  const s = readKey<InterestStore>(INTEREST_KEY, emptyStore);
  if (!expiredOnce && typeof window !== "undefined") {
    expiredOnce = true;
    const expired = expireStale(s, new Date());
    if (expired !== s && JSON.stringify(expired) !== JSON.stringify(s)) {
      queueMicrotask(() => writeKey(INTEREST_KEY, expired));
    }
  }
  return s;
}

let roomsCache: { source: Room[]; value: Room[] } | null = null;
function readRooms(): Room[] {
  const rooms = readKey<Room[]>(ROOMS_KEY, () => []);
  if (roomsCache?.source === rooms) return roomsCache.value;
  const value = rooms.some((r) => r.id === SEED_ROOM.id) ? rooms : [SEED_ROOM, ...rooms];
  roomsCache = { source: rooms, value };
  return value;
}

export function useInterestStore() {
  const store = useSyncExternalStore(subscribe, readStore, () => SERVER_STORE);
  const identity = useSyncExternalStore(
    subscribe,
    () => readKey<Identity>(IDENTITY_KEY, () => DEFAULT_IDENTITY),
    () => DEFAULT_IDENTITY,
  );

  const apply = useCallback((fn: (s: InterestStore, now: Date) => Result): Result => {
    const current = readKey<InterestStore>(INTEREST_KEY, emptyStore);
    const r = fn(current, new Date());
    if (r.ok) writeKey(INTEREST_KEY, r.store);
    return r;
  }, []);

  const actions = useMemo(
    () => ({
      express: (investorId: string, founderId: string) => apply((s, now) => expressInterest(s, investorId, founderId, now)),
      accept: (interestId: string) => apply((s, now) => acceptInterest(s, interestId, now)),
      decline: (interestId: string) => apply((s, now) => declineInterest(s, interestId, now)),
      recheck: (interestId: string) => apply((s, now) => recheckVerification(s, interestId, now)),
      send: (interestId: string, from: "investor" | "founder", text: string) =>
        apply((s, now) => sendMessage(s, interestId, from, text, now)),
      requestSeat: (roomId: string, founderId: string) => apply((s, now) => requestSeat(s, roomId, founderId, now)),
      decideSeat: (roomId: string, founderId: string, decision: "seated" | "waitlisted") =>
        apply((s, now) => decideSeat(s, roomId, founderId, decision, now)),
      upsertVerification: (v: Verification) => {
        const current = readKey<InterestStore>(INTEREST_KEY, emptyStore);
        let next = upsertVerification(current, v);
        for (const i of next.interests) {
          if (i.state === "pending_verification" && (i.investorId === v.subjectId || i.founderId === v.subjectId)) {
            const r = recheckVerification(next, i.id, new Date());
            if (r.ok) next = r.store;
          }
        }
        writeKey(INTEREST_KEY, next);
      },
      setInvestorId: (investorId: string | null) => {
        const cur = readKey<Identity>(IDENTITY_KEY, () => DEFAULT_IDENTITY);
        writeKey(IDENTITY_KEY, { ...cur, investorId });
      },
      reset: () => writeKey(INTEREST_KEY, emptyStore()),
    }),
    [apply],
  );

  return { store, identity, ...actions };
}

export function useRooms() {
  const rooms = useSyncExternalStore(subscribe, readRooms, () => SERVER_ROOMS);
  const addRoom = useCallback((room: Room) => {
    const current = readRooms();
    writeKey(ROOMS_KEY, [...current.filter((r) => r.id !== room.id), room]);
  }, []);
  return { rooms, addRoom };
}

export function useLiveProfile(): FounderProfile | null {
  return useSyncExternalStore(
    subscribe,
    () => readKey<FounderProfile | null>(LIVE_PROFILE_KEY, () => null),
    () => null,
  );
}

export function writeLiveProfile(p: FounderProfile) {
  writeKey(LIVE_PROFILE_KEY, p);
}
