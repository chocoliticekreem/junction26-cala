import { mockDoc } from "@/lib/context/build";
import { docToMarkdown } from "@/lib/context/doc";
import { CTX_PREFIX, storeGet, validStoreId } from "@/lib/context/store";
import type { ContextDoc } from "@/lib/context/types";

export async function GET(_req: Request, ctx: RouteContext<"/api/context/[id]">) {
  const { id } = await ctx.params;
  if (!validStoreId(id)) return Response.json({ error: "invalid_id" }, { status: 400 });
  if (process.env.E2E_MOCK === "1") {
    const doc = { ...mockDoc({ name: "Mock Company" }), id };
    return Response.json({ doc, markdown: docToMarkdown(doc), mock: true });
  }
  const doc = await storeGet<ContextDoc>(CTX_PREFIX + id.toLowerCase());
  if (!doc) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ doc, markdown: docToMarkdown(doc) });
}
