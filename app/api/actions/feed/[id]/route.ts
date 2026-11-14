import { loadCohortLite } from "@/lib/context/cohortRead";
import { WATCH_PREFIX, storeGet, validStoreId } from "@/lib/context/store";
import type { Watchlist } from "@/lib/context/types";
import { buildFeed, defaultSince } from "@/lib/context/watch";
import { DATA_AS_OF, loadInvestors } from "@/lib/data";

const MAX_ITEMS = 100;
const AUTOMATION = { inApp: "live", emailDigest: "roadmap" } as const;

export async function GET(req: Request, ctx: RouteContext<"/api/actions/feed/[id]">) {
  const { id: raw } = await ctx.params;
  const id = raw.toLowerCase();
  if (!validStoreId(id)) return Response.json({ error: "invalid_id" }, { status: 400 });
  const q = new URL(req.url).searchParams.get("since") ?? "";
  const since = /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : defaultSince(DATA_AS_OF);

  const investors = loadInvestors();
  let list: Watchlist | undefined;
  if (process.env.E2E_MOCK === "1") {
    const first = investors.find((i) => i.deals.length > 0);
    list = { id, items: first ? [{ investorId: first.id, name: first.name, sectors: [], since }] : [], updatedAt: "2026-11-14T00:00:00.000Z" };
  } else {
    list = await storeGet<Watchlist>(WATCH_PREFIX + id);
  }
  if (!list) return Response.json({ items: [], since, watching: 0, automation: AUTOMATION });
  const cohort = process.env.E2E_MOCK === "1" ? null : loadCohortLite();
  const items = buildFeed(list, investors, cohort, since).slice(0, MAX_ITEMS);
  return Response.json({
    items,
    since,
    watching: list.items.length,
    automation: AUTOMATION,
    ...(process.env.E2E_MOCK === "1" ? { mock: true } : {}),
  });
}
