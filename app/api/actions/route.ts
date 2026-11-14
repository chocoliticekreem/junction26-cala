import {
  buildAction,
  cacheOnlyCala,
  choosePrecedent,
  emailFacts,
  findInvestor,
  investorSources,
  mailtoFor,
  templateDraft,
} from "@/lib/context/actions";
import { mockDoc } from "@/lib/context/build";
import { loadCohortLite } from "@/lib/context/cohortRead";
import { CTX_PREFIX, storeGet, validStoreId } from "@/lib/context/store";
import type { ContextDoc, InvestorAction } from "@/lib/context/types";
import { loadInvestors } from "@/lib/data";

const MAX_INVESTORS = 10;

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const id = typeof body.calaIdOrSlug === "string" ? body.calaIdOrSlug.trim().toLowerCase() : "";
  if (!validStoreId(id)) return Response.json({ error: "invalid_id" }, { status: 400 });
  const ids = Array.isArray(body.investorIds)
    ? [...new Set(body.investorIds.filter((x): x is string => typeof x === "string" && !!x.trim()))].slice(0, MAX_INVESTORS)
    : [];
  if (!ids.length) return Response.json({ error: "missing_investor_ids" }, { status: 400 });

  const investors = loadInvestors();
  const found = ids.map((i) => findInvestor(investors, i));
  const unknown = ids.filter((_, i) => !found[i]);
  const known = found.filter((x) => !!x);

  if (process.env.E2E_MOCK === "1") {
    const doc = { ...mockDoc({ name: "Mock Company", calaId: undefined }), id };
    const actions: InvestorAction[] = known.map((inv) => {
      const precedent = choosePrecedent(inv, null, doc.company.sector, doc.company.stage);
      const emailDraft = templateDraft(emailFacts(doc, inv, precedent));
      return {
        investorId: inv.id,
        name: inv.name,
        ...(inv.website ? { website: inv.website } : {}),
        calaSources: investorSources(inv, precedent),
        ...(inv.partners[0] ? { leadPartner: { name: inv.partners[0].name, calaId: inv.partners[0].calaId } } : {}),
        ...(precedent ? { precedent } : {}),
        emailDraft,
        mailto: mailtoFor(emailDraft),
      };
    });
    return Response.json({ actions, unknown, mock: true });
  }

  const doc = await storeGet<ContextDoc>(CTX_PREFIX + id);
  if (!doc) return Response.json({ error: "doc_not_found" }, { status: 404 });
  const deps = { cohort: loadCohortLite(), cala: cacheOnlyCala() };
  const actions = await Promise.all(known.map((inv) => buildAction(doc, inv, deps)));
  return Response.json({ actions, unknown });
}
