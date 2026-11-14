import { CalaBudgetError, getRouteCala } from "@/lib/cala";
import { resolveCompany } from "@/lib/context/calaFacts";
import type { ResolveResult } from "@/lib/context/types";

const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);

function mock(name: string, website?: string): ResolveResult {
  return {
    candidates: [
      {
        calaId: "00000000-0000-4000-8000-000000000001",
        name,
        website: website ?? "https://example.com",
        hq: "London, United Kingdom",
        foundingDate: "2024",
        description: "Mock candidate (E2E_MOCK=1 or no Cala key).",
        confidence: website ? "website" : "name",
        score: website ? 1 : 0.5,
      },
      {
        calaId: "00000000-0000-4000-8000-000000000002",
        name: `${name} Holdings Ltd`,
        hq: "Manchester, United Kingdom",
        description: "Second mock candidate, so the UI shows the 'Is this you?' choice.",
        confidence: "name",
        score: 0.3,
      },
    ],
    ...(website ? { autoPick: "00000000-0000-4000-8000-000000000001" } : {}),
    mock: true,
  };
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const name = str(body.name, 100);
  if (!name) return Response.json({ error: "missing_name" }, { status: 400 });
  const website = str(body.website, 200);
  const hq = str(body.hq, 80);

  const cala = getRouteCala();
  if (!cala) return Response.json(mock(name, website));
  try {
    return Response.json(await resolveCompany(cala, { name, website, hq }));
  } catch (e) {
    if (e instanceof CalaBudgetError) return Response.json({ candidates: [], budgetExhausted: true });
    console.warn("company resolve:", e instanceof Error ? e.message : e);
    return Response.json({ error: "upstream_error" }, { status: 502 });
  }
}
