import { WATCH_PREFIX, storeGet, validStoreId } from "@/lib/context/store";
import type { Watchlist } from "@/lib/context/types";

export async function GET(_req: Request, ctx: RouteContext<"/api/actions/watch/[id]">) {
  const { id: raw } = await ctx.params;
  const id = raw.toLowerCase();
  if (!validStoreId(id)) return Response.json({ error: "invalid_id" }, { status: 400 });
  const empty: Watchlist = { id, items: [], updatedAt: "2026-11-14T00:00:00.000Z" };
  if (process.env.E2E_MOCK === "1") return Response.json({ watchlist: empty, mock: true });
  return Response.json({ watchlist: (await storeGet<Watchlist>(WATCH_PREFIX + id)) ?? empty });
}
