import { describe, expect, it } from "vitest";
import { correctCompanyName, soundsLike } from "@/lib/nameFix";

describe("correctCompanyName", () => {
  it("rewrites sound-alike spellings of the company name, keeping the founder's spelling", () => {
    expect(correctCompanyName("Kala is a knowledge graph.", "Cala")).toBe("Cala is a knowledge graph.");
    expect(correctCompanyName("we built kala for agents", "Cala")).toBe("we built Cala for agents");
    expect(correctCompanyName("Calla and Kola", "Cala")).toBe("Cala and Cala");
    expect(correctCompanyName("Kala's graph", "Cala")).toBe("Cala's graph");
  });

  it("handles c/k, ph/f and doubled letters", () => {
    expect(correctCompanyName("Fonic raised", "Phonic")).toBe("Phonic raised");
    expect(correctCompanyName("Pikkle is hiring", "Pickle")).toBe("Pickle is hiring");
  });

  it("leaves words that are near in spelling but not in sound", () => {
    // Distance 1 from Cala, but r and l are different sounds: not a transcription slip.
    expect(correctCompanyName("Cara is a friend", "Cala")).toBe("Cara is a friend");
    expect(correctCompanyName("Dana is here", "Cala")).toBe("Dana is here");
  });

  it("never touches other words or the name itself", () => {
    expect(correctCompanyName("Check my calendar for Cala", "Cala")).toBe("Check my calendar for Cala");
    expect(correctCompanyName("a scalable call to Kalamazoo", "Cala")).toBe("a scalable call to Kalamazoo");
  });

  it("requires a name of at least four letters and only corrects words of that length", () => {
    expect(correctCompanyName("Kal is here", "Cal")).toBe("Kal is here");
    expect(correctCompanyName("Kal is here", "Cala")).toBe("Kal is here");
    expect(correctCompanyName("Kala is here", "")).toBe("Kala is here");
  });

  it("corrects each long word of a multi-word name", () => {
    expect(correctCompanyName("Kala Labs ships, so does Kala", "Cala Labs")).toBe("Cala Labs ships, so does Cala");
    expect(correctCompanyName("Open AI is big", "Cala AI")).toBe("Open AI is big");
  });
});

describe("soundsLike", () => {
  it("is false for an exact match and for distance over 2", () => {
    expect(soundsLike("Cala", "Cala")).toBe(false);
    expect(soundsLike("Kalaah", "Cala")).toBe(false);
    expect(soundsLike("Kalla", "Cala")).toBe(true);
  });
});
