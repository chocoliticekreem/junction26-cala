import { expect, test } from "@playwright/test";

// Spec 12.5: press R, the biotech chip appears and a biotech investor enters the top 3
// within the replay window. Runs offline: replay never calls the network.
test("replay moves a biotech investor into the top 3", async ({ page }) => {
  await page.goto("/match");
  // Pressed straight after load, before hydration may have finished: the early key script
  // in app/layout.tsx must hand it to the page instead of dropping it.
  await page.keyboard.press("r");
  await expect(page.getByTestId("match-row")).toHaveCount(10);

  await expect(page.locator('[data-chip^="sector"]').filter({ hasText: "Biotech" }).first()).toBeVisible({
    timeout: 15_000,
  });
  await expect
    .poll(
      async () =>
        page
          .getByTestId("match-row")
          .evaluateAll((rows) => rows.slice(0, 3).map((r) => r.getAttribute("data-sector"))),
      { timeout: 30_000 },
    )
    .toContain("biotech/therapeutics");
  await expect(page.locator('[data-chip="stage"]')).toContainText("Pre-seed", { timeout: 40_000 });
  await page.screenshot({ path: "tests/screenshots/replay-settled.png" });
});
