import type { CompanyCandidate } from "@/lib/context/types";

// Every company a founder has simulated on this browser, newest first. The dropdown under
// "Your company" reads it through useSyncExternalStore; a simulate writes it. localStorage
// only: nothing leaves the device.

export type SavedCompany = {
  name: string;
  website?: string;
  candidate?: CompanyCandidate;
  pitch: string;
  vision: string;
  updatedAt: number;
};

const KEY = "scalaxy.companies";
const MAX = 12;
const EMPTY: SavedCompany[] = [];

let cache: SavedCompany[] | undefined;
const listeners = new Set<() => void>();

function read(): SavedCompany[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return EMPTY;
    return list.filter((x): x is SavedCompany => !!x && typeof x === "object" && typeof (x as SavedCompany).name === "string");
  } catch {
    return EMPTY;
  }
}

export function getMyCompanies(): SavedCompany[] {
  if (typeof window === "undefined") return EMPTY;
  cache ??= read();
  return cache;
}

export function getMyCompaniesServer(): SavedCompany[] {
  return EMPTY;
}

export function subscribeMyCompanies(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function saveMyCompany(entry: Omit<SavedCompany, "updatedAt">): void {
  const name = entry.name.trim();
  if (!name) return;
  const key = name.toLowerCase();
  const rest = getMyCompanies().filter((c) => c.name.trim().toLowerCase() !== key);
  cache = [{ ...entry, name, updatedAt: Date.now() }, ...rest].slice(0, MAX);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // Private mode or a full quota: the dropdown still shows this session's list.
  }
  for (const cb of listeners) cb();
}
