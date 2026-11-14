import { describe, expect, it } from "vitest";
import { EXTRACTION_TOOL, parseExtraction } from "@/lib/extractSchema";
import { ALL_SECTORS, STAGES } from "@/lib/taxonomy";

describe("EXTRACTION_TOOL", () => {
  it("enumerates the taxonomy sectors and stages", () => {
    const props = (EXTRACTION_TOOL.input_schema as { properties: Record<string, { items?: { properties: Record<string, { enum?: string[] }> }; properties?: Record<string, { enum?: string[] }> }> }).properties;
    expect(props.sectors.items?.properties.label.enum).toEqual([...ALL_SECTORS]);
    expect(props.stage.properties?.value.enum).toEqual([...STAGES]);
    expect(EXTRACTION_TOOL.name).toMatch(/^[a-z_]+$/);
  });
});

describe("parseExtraction", () => {
  it("rejects non-objects", () => {
    expect(parseExtraction(null)).toBeNull();
    expect(parseExtraction("x")).toBeNull();
    expect(parseExtraction([])).toBeNull();
  });

  it("clamps confidences, drops unknown labels and dedupes", () => {
    const e = parseExtraction({
      sectors: [
        { label: "biotech/therapeutics", confidence: 1.4 },
        { label: "biotech/therapeutics", confidence: 0.3 },
        { label: "defence", confidence: 0.9 },
        { label: "fintech", confidence: -2 },
        { label: "healthtech" },
      ],
      stage: { value: "Series A", confidence: 0.7 },
      raise_amount: { value: 1500000, confidence: 2 },
      traction: { revenue: "£10k MRR", confidence: 0.6 },
      team_signals: [{ value: "PhD", confidence: 0.9 }, { value: "", confidence: 0.9 }],
      geography: { value: "London", confidence: 0.8 },
      business_model: { value: 3, confidence: 0.8 },
      triggers: { stage: "Series A", bad: 4 },
    });
    expect(e).toEqual({
      sectors: [
        { label: "biotech/therapeutics", confidence: 1 },
        { label: "fintech", confidence: 0 },
      ],
      stage: { value: "series-a", confidence: 0.7 },
      raise_amount: { value: 1500000, confidence: 1 },
      traction: { revenue: "£10k MRR", confidence: 0.6 },
      team_signals: [{ value: "PhD", confidence: 0.9 }],
      geography: { value: "London", confidence: 0.8 },
      triggers: { stage: "Series A" },
    });
  });

  it("drops an invalid stage and tolerates missing sectors", () => {
    expect(parseExtraction({ stage: { value: "growth hacking", confidence: 0.9 } })).toEqual({ sectors: [] });
  });
});
