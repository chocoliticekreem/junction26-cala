import { expect, test } from "@playwright/test";

// An uncached Cala search takes 40-70 s. The panel must say so, keep the rest usable, and not
// ask again for the same investor in the same session.
test("slow Cala search shows a loading state, never blocks the panel, and is cached", async ({ page }) => {
  let searches = 0;
  await page.route("**/api/cala/search", async (route) => {
    searches++;
    await new Promise((r) => setTimeout(r, 3000));
    await route.fulfill({ json: { answer: "Slow answer from Cala.", sources: [{ name: "slow-source" }] } });
  });
  await page.goto("/match");
  await expect(page.getByTestId("match-row")).toHaveCount(10);
  // The top-10 rail is a placeholder until the profile has a signal; start the replay first.
  await page.locator("body").press("r");
  await expect(page.getByTestId("chip").first()).toBeVisible({ timeout: 15_000 });
  const first = page.getByTestId("match-row").first().locator("button").first();
  await first.click();

  const panel = page.getByTestId("profile-panel");
  await expect(panel.getByTestId("cala-loading")).toContainText("this can take up to a minute");
  await expect(panel.locator(".cala-progress")).toBeVisible();
  await expect(panel.getByTestId("profile-fit")).toBeVisible();
  await expect(page.getByTestId("profile-sources")).toBeVisible();
  await page.screenshot({ path: "tests/screenshots/cala-loading.png" });

  await expect(panel.getByTestId("cala-live")).toContainText("Slow answer from Cala.", { timeout: 10_000 });
  await expect(panel.getByTestId("cala-loading")).toHaveCount(0);

  await page.getByRole("button", { name: "Close profile" }).click();
  await first.click();
  await expect(page.getByTestId("profile-panel").getByTestId("cala-live")).toContainText("Slow answer from Cala.");
  expect(searches).toBe(1);
});
