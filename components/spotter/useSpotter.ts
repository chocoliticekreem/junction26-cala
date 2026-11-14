"use client";

import { useCallback, useEffect, useState } from "react";
import type { SpotterResult } from "@/lib/sim/spotter";
import type { SpotterInvestorOption } from "@/lib/sim/spotter/investors";
import { adaptSpotter } from "./adapt";
import type { SpotterRequest, SpotterResponse } from "./types";

export type SpotterState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; data: SpotterResponse }
  | { status: "no_cohort" }
  | { status: "error"; message: string };

type Settled = Exclude<SpotterState, { status: "idle" | "loading" }>;

const MESSAGES: Record<string, string> = {
  investor_not_found: "This investor is not in the Cala cohort.",
  missing_investor: "Pick an investor first.",
  invalid_json: "The request was malformed.",
};

// POST /api/spotter. A 503 (no cohort file) or a synthetic-fixture answer is reported as no_cohort,
// never rendered: the page shows real Cala evidence or an honest empty state.
export async function fetchSpotter(req: SpotterRequest, signal?: AbortSignal): Promise<Settled> {
  const res = await fetch("/api/spotter", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
    signal,
  });
  if (res.status === 503) return { status: "no_cohort" };
  const body = (await res.json().catch(() => null)) as (SpotterResult & { fixture?: boolean }) | { error?: string; message?: string } | null;
  if (!res.ok || !body || !("picks" in body)) {
    const code = body && "error" in body && body.error ? body.error : `HTTP ${res.status}`;
    return { status: "error", message: MESSAGES[code] ?? `The spotter answered ${code}.` };
  }
  if (body.fixture) return { status: "no_cohort" };
  return { status: "ok", data: adaptSpotter(body) };
}

export function useSpotter(req: SpotterRequest | null): { state: SpotterState; retry: () => void } {
  const [settled, setSettled] = useState<{ key: string; state: Settled } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = req ? `${attempt}:${JSON.stringify(req)}` : null;

  useEffect(() => {
    if (!key) return;
    const ctrl = new AbortController();
    fetchSpotter(JSON.parse(key.slice(key.indexOf(":") + 1)) as SpotterRequest, ctrl.signal)
      .then((state) => {
        if (!ctrl.signal.aborted) setSettled({ key, state });
      })
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setSettled({ key, state: { status: "error", message: e instanceof Error ? e.message : "Could not reach the spotter." } });
      });
    return () => ctrl.abort();
  }, [key]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  if (!key) return { state: { status: "idle" }, retry };
  if (settled?.key === key) return { state: settled.state, retry };
  return { state: { status: "loading" }, retry };
}

export type InvestorOptionsState = { status: "loading" } | { status: "ok"; options: SpotterInvestorOption[] } | { status: "no_cohort" } | { status: "error"; message: string };

// GET /api/spotter/investors: the cohort investors the spotter can rank for.
export function useInvestorOptions(): InvestorOptionsState {
  const [state, setState] = useState<InvestorOptionsState>({ status: "loading" });
  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/spotter/investors", { signal: ctrl.signal })
      .then(async (res) => {
        if (res.status === 503) return { status: "no_cohort" } as const;
        const body = (await res.json().catch(() => null)) as { investors?: SpotterInvestorOption[] } | null;
        if (!res.ok || !Array.isArray(body?.investors)) return { status: "error", message: `Investor list answered HTTP ${res.status}.` } as const;
        return { status: "ok", options: body.investors } as const;
      })
      .catch((e: unknown) => ({ status: "error", message: e instanceof Error ? e.message : "Could not load investors." }) as const)
      .then((next) => {
        if (!ctrl.signal.aborted) setState(next);
      });
    return () => ctrl.abort();
  }, []);
  return state;
}
