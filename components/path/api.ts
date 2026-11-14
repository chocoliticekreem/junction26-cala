// One seam between the page and the engine. Each call tries the real route first and falls back
// to the mock with `demo: true`, which the page shows as a small "demo data" tag. Swapping to the
// engine for good means deleting the mock branches here, nothing else.
import { contextMarkdown, mockActions, mockCompany, mockContext, mockFeed, mockNetwork, mockResolve, mockSimulate } from "./mockSim";
import type { ActionCard, CompanyCandidate, CompanyState, ContextBuildBody, ContextDoc, NetworkData, SimResult, SimulateBody, WatchEvent } from "./types";

export type Sourced<T> = { data: T; demo: boolean };

async function tryJson<T>(url: string, init?: RequestInit): Promise<T | undefined> {
  try {
    const res = await fetch(url, init);
    if (!res.ok) return undefined;
    return (await res.json()) as T;
  } catch {
    return undefined;
  }
}

export async function fetchNetwork(): Promise<Sourced<NetworkData>> {
  const live = await tryJson<NetworkData>("/api/network");
  if (live && Array.isArray(live.nodes) && live.nodes.length) return { data: live, demo: false };
  return { data: mockNetwork(), demo: true };
}

export async function lookupCompany(name: string): Promise<Sourced<CompanyState>> {
  const live = await tryJson<CompanyState>(`/api/company?name=${encodeURIComponent(name)}`);
  if (live && typeof live.found === "boolean") return { data: live, demo: false };
  return { data: mockCompany(name), demo: true };
}

export async function runSimulate(body: SimulateBody): Promise<Sourced<SimResult>> {
  const live = await tryJson<SimResult>("/api/simulate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (live && live.tree && Array.isArray(live.highways)) return { data: live, demo: false };
  // The mock is synchronous; a short beat keeps the "gathering" animation readable on video.
  await new Promise((r) => setTimeout(r, 1400));
  return { data: mockSimulate(body), demo: true };
}

export function calaEntityHref(companyId: string): string {
  return `/api/cala/entity/${encodeURIComponent(companyId)}`;
}

const post = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export async function resolveCompany(name: string): Promise<Sourced<CompanyCandidate[]>> {
  const live = await tryJson<{ candidates: CompanyCandidate[] }>("/api/company/resolve", post({ name }));
  if (live && Array.isArray(live.candidates)) return { data: live.candidates, demo: false };
  return { data: mockResolve(name), demo: true };
}

export async function buildContext(body: ContextBuildBody): Promise<Sourced<{ doc: ContextDoc; markdown: string }>> {
  const live = await tryJson<{ doc: ContextDoc; markdown: string }>("/api/context/build", post(body));
  if (live && live.doc) return { data: live, demo: false };
  const doc = mockContext(body);
  return { data: { doc, markdown: contextMarkdown(doc) }, demo: true };
}

export async function fetchActions(calaIdOrSlug: string, investorIds: string[], company: string): Promise<Sourced<ActionCard[]>> {
  const live = await tryJson<ActionCard[] | { actions: ActionCard[] }>("/api/actions", post({ calaIdOrSlug, investorIds }));
  const list = Array.isArray(live) ? live : live?.actions;
  if (list && list.length) return { data: list, demo: false };
  return { data: mockActions(company, investorIds), demo: true };
}

export async function watchInvestor(calaIdOrSlug: string, investorId: string): Promise<void> {
  await tryJson("/api/actions/watch", post({ calaIdOrSlug, investorId }));
}

export async function fetchFeed(id: string, watchedNames: string[]): Promise<Sourced<WatchEvent[]>> {
  const live = await tryJson<WatchEvent[] | { events: WatchEvent[] }>(`/api/actions/feed/${encodeURIComponent(id)}`);
  const list = Array.isArray(live) ? live : live?.events;
  if (list) return { data: list, demo: false };
  return { data: mockFeed(watchedNames), demo: true };
}
