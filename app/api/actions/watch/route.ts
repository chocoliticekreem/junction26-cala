import { findInvestor } from "@/lib/context/actions";
import { CTX_TTL_SECONDS, WATCH_PREFIX, storeGet, storeSet, validStoreId } from "@/lib/context/store";
import type { Watchlist } from "@/lib/context/types";
import { cleanSectors, upsertWatch } from "@/lib/context/watch";
import { loadInvestors } from "@/lib/data";

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id.trim().toLowerCase() : "";
  if (!validStoreId(id)) return Response.json({ error: "invalid_id" }, { status: 400 });
  const inv = typeof body.investorId === "string" ? findInvestor(loadInvestors(), body.investorId) : undefined;
  if (!inv) return Response.json({ error: "unknown_investor" }, { status: 400 });
  const sectors = cleanSectors(body.sectors);

  const mock = process.env.E2E_MOCK === "1";
  const prev = mock ? undefined : await storeGet<Watchlist>(WATCH_PREFIX + id);
  const list = upsertWatch(prev, id, inv, sectors, mock ? new Date("2026-11-14T00:00:00Z") : new Date());
  if (mock) return Response.json({ watchlist: list, mock: true });
  const stored = await storeSet(WATCH_PREFIX + id, list, CTX_TTL_SECONDS);
  return Response.json({ watchlist: list, stored });
}
