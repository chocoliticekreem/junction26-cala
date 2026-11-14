import { describe, expect, it } from "vitest";
import { SNAPSHOT } from "@/lib/calaSnapshotData";
import { entityRouteKey, searchRouteKey, searchRouteKeyForName } from "@/lib/routeCache";

describe("route cache keys", () => {
  it("maps the panel's question to the key the seed script writes for that investor", () => {
    expect(searchRouteKey("What does 4BIO Capital invest in?")).toBe(searchRouteKeyForName("4BIO Capital"));
    expect(searchRouteKey("  what does  Zinc invest in ")).toBe(searchRouteKeyForName("zinc"));
  });

  it("covers every snapshot search with a panel-shaped key", () => {
    for (const nameKey of Object.keys(SNAPSHOT.searches)) {
      expect(searchRouteKey(`What does ${nameKey} invest in?`)).toBe(searchRouteKeyForName(nameKey));
    }
  });

  it("keeps other queries and entity ids in their own namespaces", () => {
    expect(searchRouteKey("funding rounds in 2025")).toContain(":search:q:");
    expect(entityRouteKey("AA87DDE8-7DC3-4FC0-957F-143DA6DDC0B7")).toBe(entityRouteKey("aa87dde8-7dc3-4fc0-957f-143da6ddc0b7"));
  });
});
