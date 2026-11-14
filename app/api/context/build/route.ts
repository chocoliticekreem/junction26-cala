import { UUID_RE } from "@/lib/cala";
import { buildContext, mockDoc, type BuildInput } from "@/lib/context/build";
import { docToMarkdown } from "@/lib/context/doc";
import { MAX_UPLOAD_CHARS } from "@/lib/context/founderClaims";
import type { Upload } from "@/lib/context/types";
import type { FounderProfile } from "@/lib/types";

const MAX_UPLOADS = 5;
const TEXT_FILE = /\.(md|markdown|txt)$/i;

const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);

function cleanUploads(raw: unknown): Upload[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((u) => ({ name: str(u?.name, 80) ?? "notes", text: str(u?.text, MAX_UPLOAD_CHARS) ?? "" }))
    .filter((u) => u.text)
    .slice(0, MAX_UPLOADS);
}

class UnsupportedUpload extends Error {}

// multipart/form-data: fields calaId, website, name, visionText, pitchProfile (JSON), text, and
// files. Text and Markdown files only; PDF needs a parser this repo does not ship.
async function fromForm(req: Request): Promise<Record<string, unknown>> {
  const form = await req.formData();
  const out: Record<string, unknown> = {};
  for (const k of ["calaId", "website", "name", "visionText"]) {
    const v = form.get(k);
    if (typeof v === "string") out[k] = v;
  }
  const profile = form.get("pitchProfile");
  if (typeof profile === "string" && profile.trim()) out.pitchProfile = JSON.parse(profile);
  const uploads: Upload[] = [];
  const pasted = form.get("text");
  if (typeof pasted === "string" && pasted.trim()) uploads.push({ name: "pasted text", text: pasted });
  for (const v of form.getAll("files")) {
    if (typeof v === "string") continue;
    if (!TEXT_FILE.test(v.name) && !v.type.startsWith("text/")) throw new UnsupportedUpload(v.name);
    uploads.push({ name: v.name, text: (await v.text()).slice(0, MAX_UPLOAD_CHARS) });
  }
  out.uploads = uploads;
  return out;
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    const multipart = (req.headers.get("content-type") ?? "").includes("multipart/form-data");
    body = multipart ? await fromForm(req) : ((await req.json()) as Record<string, unknown>);
  } catch (e) {
    if (e instanceof UnsupportedUpload)
      return Response.json(
        { error: "unsupported_upload", detail: `${e.message}: only .md, .markdown and .txt files (or pasted text) are accepted; PDF is not supported yet.` },
        { status: 415 },
      );
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const calaId = str(body.calaId, 64);
  if (calaId && !UUID_RE.test(calaId)) return Response.json({ error: "invalid_cala_id" }, { status: 400 });
  const profile = body.pitchProfile && typeof body.pitchProfile === "object" ? (body.pitchProfile as Partial<FounderProfile>) : undefined;
  const input: BuildInput = {
    calaId,
    name: str(body.name, 100),
    website: str(body.website, 200),
    pitchProfile: profile,
    visionText: str(body.visionText, 1000),
    uploads: cleanUploads(body.uploads),
  };
  if (!input.calaId && !input.name && !input.website && !profile?.company && !input.uploads?.length && !input.visionText)
    return Response.json({ error: "empty_input" }, { status: 400 });

  if (process.env.E2E_MOCK === "1") {
    const doc = mockDoc(input);
    return Response.json({ doc, markdown: docToMarkdown(doc), mock: true });
  }
  try {
    const { doc, markdown, stored, notes } = await buildContext(input);
    return Response.json({ doc, markdown, stored, notes });
  } catch (e) {
    console.warn("context build:", e instanceof Error ? e.message : e);
    const doc = mockDoc(input);
    return Response.json({ doc, markdown: docToMarkdown(doc), mock: true, notes: ["Build failed; returned a placeholder doc."] });
  }
}
