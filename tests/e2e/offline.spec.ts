import { expect, test } from "@playwright/test";
import { BIOTECH, replayTopIds } from "./expected";

// DoD 2: replay reproduces the demo with the network off (only the page load needs it).
test("replay runs offline and ends on the same ranking as online", async ({ page, context }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/");
  await expect(page.getByTestId("match-row")).toHaveCount(10);
  await context.setOffline(true);
  await page.locator("body").press("r");

  await expect(page.locator('[data-chip^="sector"]').filter({ hasText: "Biotech" }).first()).toBeVisible({
    timeout: 15_000,
  });
  await expect
    .poll(
      () => page.getByTestId("match-row").evaluateAll((rows) => rows.slice(0, 3).map((r) => r.getAttribute("data-sector"))),
      { timeout: 30_000 },
    )
    .toContain(BIOTECH);
  await expect(page.locator('[data-chip="stage"]')).toContainText("Pre-seed", { timeout: 40_000 });

  const expected = replayTopIds();
  await expect
    .poll(
      () => page.getByTestId("match-row").evaluateAll((rows) => rows.map((r) => r.getAttribute("data-investor-id"))),
      { timeout: 75_000 },
    )
    .toEqual(expected);

  // The profile panel asks Cala live; offline it must say so and keep the cached data.
  await page.getByTestId("match-row").first().locator("button").first().click();
  const panel = page.getByTestId("profile-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("cala-live")).toContainText("unavailable", { timeout: 10_000 });
  await expect(panel.locator(".deals li").first()).toBeVisible();
  await expect(page.getByTestId("door-panel")).toBeVisible();
  expect(errors).toEqual([]);
  await context.setOffline(false);
});
