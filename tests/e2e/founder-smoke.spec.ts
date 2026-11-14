import { expect, test } from "@playwright/test";

test("founder view renders the graph and ten matches", async ({ page }) => {
  await page.goto("/");
  const canvas = page.locator('[data-testid="graph"] canvas').first();
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(600);
  expect(box?.height ?? 0).toBeGreaterThan(400);

  await expect(page.getByTestId("match-row")).toHaveCount(10);
  await expect(page.getByTestId("fixture-banner")).toBeVisible();

  await page.locator("body").press("r");
  await page.waitForTimeout(9000);
  await expect(page.getByTestId("chip").first()).toBeVisible();

  await page.getByTestId("match-row").first().locator("button").click();
  await expect(page.getByTestId("profile-panel")).toBeVisible();
  await expect(page.getByTestId("door-panel")).toBeVisible();
  await page.waitForTimeout(1500);

  await page.screenshot({ path: "tests/screenshots/founder-selected.png" });
});
