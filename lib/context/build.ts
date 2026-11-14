// Orchestrates one context-doc build: Cala facts (when a calaId is given), website facts, founder
// claims, then assembly and persistence. Every source is optional; a missing key skips that source.
import { CalaBudgetError, getRouteCala, type CalaClient } from "@/lib/cala";
import type { FounderProfile } from "@/lib/types";
import { fetchCalaFacts } from "./calaFacts";
import { assembleDoc, docToMarkdown } from "./doc";
import { founderClaims } from "./founderClaims";
import { CTX_PREFIX, storeSet } from "./store";
import type { CalaFacts, ContextDoc, Upload, WebsiteFacts } from "./types";
import { fetchWebsiteFacts } from "./website";

export type BuildInput = {
  calaId?: string;
  name?: string;
  website?: string;
  pitchProfile?: Partial<FounderProfile>;
  visionText?: string;
  uploads?: Upload[];
};

export type BuildResult = {
  doc: ContextDoc;
  markdown: string;
  stored: { valkey: boolean; local: boolean };
  notes: string[];
};

export async function buildContext(
  input: BuildInput,
  deps: { cala?: CalaClient | null; now?: Date } = {},
): Promise<BuildResult> {
  const now = deps.now ?? new Date();
  const notes: string[] = [];
  let cala: CalaFacts | undefined;
  if (input.calaId) {
    const client = deps.cala === undefined ? getRouteCala() : deps.cala;
    if (!client) notes.push("Cala not configured: built without graph facts.");
    else {
      try {
        cala = await fetchCalaFacts(client, input.calaId);
      } catch (e) {
        notes.push(e instanceof CalaBudgetError ? "Cala credit budget spent: built without graph facts." : "Cala lookup failed: built without graph facts.");
        if (!(e instanceof CalaBudgetError)) console.warn("context build cala:", e instanceof Error ? e.message : e);
      }
    }
  }
  const website = input.website ?? cala?.website ?? input.pitchProfile?.website;
  const [site, claims] = await Promise.all([
    website ? fetchWebsiteFacts(website) : Promise.resolve<WebsiteFacts | undefined>(undefined),
    founderClaims(input.uploads ?? []),
  ]);
  if (website && !site) notes.push("Website facts unavailable (no Context.dev key, budget spent, or scrape failed).");

  const doc = assembleDoc({
    name: input.name,
    website,
    cala,
    site,
    pitchProfile: input.pitchProfile,
    visionText: input.visionText,
    founderClaims: claims,
    now,
  });
  const stored = await storeSet(CTX_PREFIX + doc.id, doc);
  if (!stored.valkey) notes.push("Valkey unavailable: doc stored locally only.");
  return { doc, markdown: docToMarkdown(doc), stored, notes };
}

// E2E_MOCK=1: deterministic, no network.
export function mockDoc(input: BuildInput): ContextDoc {
  const name = input.pitchProfile?.company ?? input.name ?? "Mock Company";
  const doc = assembleDoc({
    name,
    website: input.website ?? "https://example.com",
    cala: input.calaId
      ? {
          calaIds: [input.calaId],
          name,
          website: input.website ?? "https://example.com",
          hq: "London, United Kingdom",
          founded: "2024",
          description: "Mock company returned because E2E_MOCK=1.",
          fundingStage: "SEED",
          founders: [{ name: "Alex Founder (mock)", role: "CEO" }],
          investors: [{ name: "Mock Ventures", round: "Seed", lead: true }],
          rounds: [
            {
              label: "Seed",
              stage: "seed",
              date: "2025-06-01",
              amountText: "GBP 2,000,000",
              amountUsd: 2_540_000,
              leads: ["Mock Ventures"],
              investors: ["Mock Ventures", "Mock Angels"],
              sources: [{ name: "mock", url: "https://cala.ai" }],
            },
          ],
          headcount: { value: "12" },
        }
      : undefined,
    pitchProfile: input.pitchProfile,
    visionText: input.visionText ?? "Mock vision: Series B in five years.",
    founderClaims: (input.uploads ?? []).map((u) => ({
      text: u.text.slice(0, 160),
      basis: "founder" as const,
      source: { name: `Founder upload: ${u.name}` },
    })),
    now: new Date("2026-11-14T00:00:00Z"),
  });
  return { ...doc, mock: true };
}
