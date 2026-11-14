import { expect, test } from "@playwright/test";
import { STAGES, type Stage } from "../../lib/taxonomy";
import { sectorLabel, stageLabel } from "../../lib/revealed";
import { INVESTORS, replayTopIds } from "./expected";

// The build time of data/investors.json (scripts/refinalize.ts --now): the 24-month window the
// stored lines were counted in. Recounting against today would drift as the window moves.
const BUILD_NOW = Date.parse("2026-11-14T05:31:21.300Z");
const MONTH_MS = 30.4375 * 86_400_000;
const LINE_RE = /^Says (.+); (\d+) of last (\d+) deals were (.+)$/;

// Independent recount: dated deals inside 24 months (up to one month ahead counts as now).
function recount(investorId: string, was: string): { count: number; total: number } {
  const inv = INVESTORS.find((i) => i.id === investorId);
  if (!inv) throw new Error(`unknown investor ${investorId}`);
  const inWindow = inv.deals.filter((d) => {
    if (!d.date) return false;
    const m = (BUILD_NOW - Date.parse(d.date)) / MONTH_MS;
    return m >= -1 && m <= 24;
  });
  const stage = STAGES.find((s) => stageLabel(s as Stage) === was);
  if (stage) {
    const known = inWindow.filter((d) => d.round !== "unknown");
    return { count: known.filter((d) => d.round === stage).length, total: known.length };
  }
  return { count: inWindow.filter((d) => sectorLabel(d.sector) === was).length, total: inWindow.length };
}

test("after the replay a counted stated-vs-revealed contradiction is on screen", async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto("/match");
  await expect(page.getByTestId("match-row")).toHaveCount(10);
  await page.locator("body").press("r");
  const expected = replayTopIds();
  await expect
    .poll(
      () => page.getByTestId("match-row").evaluateAll((rows) => rows.map((r) => r.getAttribute("data-investor-id"))),
      { timeout: 80_000 },
    )
    .toEqual(expected);

  const row = page.getByTestId("match-row").filter({ has: page.getByTestId("match-contradiction") }).first();
  await expect(row).toBeVisible();
  const id = (await row.getAttribute("data-investor-id")) as string;
  const inv = INVESTORS.find((i) => i.id === id);
  const line = inv?.contradictionLine as string;
  expect(line).toMatch(LINE_RE);
  await expect(row.getByTestId("match-contradiction")).toContainText(line);

  const [, said, count, total, was] = line.match(LINE_RE) as RegExpMatchArray;
  expect(said).not.toContain(was);
  expect(recount(id, was)).toEqual({ count: Number(count), total: Number(total) });
  expect(Number(count) / Number(total)).toBeGreaterThanOrEqual(0.25);

  // Selecting it (from the list or the graph) opens the panel with the same counted line.
  await row.locator("button").first().click();
  await expect(page.getByTestId("profile-panel").getByTestId("contradiction")).toContainText(line);
  console.log(`contradiction on screen: ${inv?.name}: ${line}`);
});
