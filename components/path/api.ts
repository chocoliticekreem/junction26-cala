// One seam between the page and the engine routes. Every call returns real data or throws an
// ApiError; the page turns that into an honest empty state, never a stand-in number.
import type { ContextBuildBody, ContextDoc, FeedItem, InvestorAction, NetworkData, ResolveResult, SimulateBody, SimulateResponse } from "./types";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

const MESSAGES: Record<string, string> = {
  no_cohort: "No cohort on this server yet",
  no_cala: "Cala is not configured on this server",
  budget_exhausted: "Cala budget used up for today",
  doc_not_found: "Build the company file first",
};

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError && MESSAGES[e.code]) return MESSAGES[e.code];
  return "Couldn't reach Cala — try again";
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new ApiError(0, "network");
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ApiError(res.status, "bad_json");
  }
  if (!res.ok) {
    const code = body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string" ? (body as { error: string }).error : `http_${res.status}`;
    throw new ApiError(res.status, code);
  }
  return body as T;
}

const post = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export async function fetchNetwork(): Promise<NetworkData> {
  const net = await json<NetworkData>("/api/network");
  if (!Array.isArray(net.nodes) || !Array.isArray(net.edges)) throw new ApiError(200, "bad_shape");
  return net;
}

export async function resolveCompany(name: string, website?: string): Promise<ResolveResult> {
  const r = await json<ResolveResult>("/api/company/resolve", post({ name, website: website || undefined }));
  if (!Array.isArray(r.candidates)) throw new ApiError(200, "bad_shape");
  if (r.budgetExhausted && !r.candidates.length) throw new ApiError(200, "budget_exhausted");
  return r;
}

export async function runSimulate(body: SimulateBody): Promise<SimulateResponse> {
  const r = await json<SimulateResponse>("/api/simulate", post(body));
  if (!r.tree || !Array.isArray(r.realities) || !Array.isArray(r.highways) || !r.visionBasis || !r.start) throw new ApiError(200, "bad_shape");
  return r;
}

export async function buildContext(body: ContextBuildBody): Promise<{ doc: ContextDoc; markdown: string }> {
  const r = await json<{ doc: ContextDoc; markdown: string }>("/api/context/build", post(body));
  if (!r.doc) throw new ApiError(200, "bad_shape");
  return r;
}

export async function fetchActions(docId: string, investorIds: string[]): Promise<{ actions: InvestorAction[]; unknown: string[] }> {
  const r = await json<{ actions: InvestorAction[]; unknown?: string[] }>("/api/actions", post({ calaIdOrSlug: docId, investorIds }));
  if (!Array.isArray(r.actions)) throw new ApiError(200, "bad_shape");
  return { actions: r.actions, unknown: r.unknown ?? [] };
}

export async function watchInvestor(docId: string, investorId: string): Promise<void> {
  await json("/api/actions/watch", post({ id: docId, investorId }));
}

export async function fetchFeed(docId: string): Promise<FeedItem[]> {
  const r = await json<{ items: FeedItem[] }>(`/api/actions/feed/${encodeURIComponent(docId)}`);
  if (!Array.isArray(r.items)) throw new ApiError(200, "bad_shape");
  return r.items;
}

export function calaEntityHref(companyId: string): string {
  return `/api/cala/entity/${encodeURIComponent(companyId)}`;
}
