import { expect, test, type Page } from "@playwright/test";

// The Scalaxy founder flow against the typed mock (E2E_MOCK=1, no engine routes): one CTA with
// company -> pitch -> vision -> simulate -> the CTA collapses into the brief bar, realities + tree
// slide in beside the galaxy map -> flip a branch -> no recent-companies list (
// focus) -> reset clears everything.

async function mapHasContent(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="path-map"] canvas');
    if (!canvas || canvas.width === 0 || canvas.height === 0) return false;
    const probe = document.createElement("canvas");
    probe.width = canvas.width;
    probe.height = canvas.height;
    const ctx = probe.getContext("2d");
    if (!ctx) return false;
    ctx.drawImage(canvas, 0, 0);
    const data = ctx.getImageData(0, 0, probe.width, probe.height).data;
    let lit = 0;
    for (let i = 3; i < data.length; i += 4 * 7) if (data[i] > 40) lit++;
    return lit > 200;
  });
}

test("founder flow: CTA, simulate, flip a branch, remembered company, reset", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/");
  await expect(page.getByTestId("interview")).toHaveAttribute("data-step", "company");
  await expect(page.getByTestId("nav-founder")).toHaveClass(/is-active/);
  await expect(page.locator(".brand-name")).toHaveText("sCALAxy");

  await page.getByTestId("company-name").fill("Cala");
  await expect(page.getByTestId("candidate").first()).toBeVisible();
  await page.getByTestId("candidate").first().click();
  await expect(page.getByTestId("company-found")).toContainText("Cala");
  await expect(page.getByTestId("candidates")).toHaveCount(0);

  // A website makes the match certain: no "Is this you?" even after the name is re-resolved.
  await expect(page.getByTestId("company-website")).toHaveCount(0);
  await page.getByTestId("add-website").click();
  await page.getByTestId("company-website").fill("cala.ai");
  await expect(page.getByTestId("company-found")).toContainText("Cala");
  await expect(page.getByTestId("candidates")).toHaveCount(0);

  await page.getByTestId("pitch-text").fill("We are a seed stage B2B SaaS company building developer tools for investors, raising $5m.");
  await expect(page.getByTestId("pitch-read")).toContainText("Seed");
  await expect(page.getByTestId("interview")).toHaveAttribute("data-step", "vision");
  await page.getByTestId("vision-example").first().click();
  await expect(page.getByTestId("vision-basis")).toContainText("Read as");
  await expect(page.getByTestId("interview")).toHaveAttribute("data-step", "ready");
  await page.getByTestId("simulate").click();

  await expect(page.getByTestId("realities")).toBeVisible({ timeout: 20_000 });
  const realities = page.getByTestId("reality");
  expect(await realities.count()).toBeGreaterThanOrEqual(3);
  const branches = page.getByTestId("tree").locator('[data-testid="branch"][data-depth="1"]');
  expect(await branches.count()).toBeGreaterThanOrEqual(2);
  await expect(page.getByTestId("brief")).toContainText("Cala");
  await expect(page.getByTestId("interview")).toHaveCount(0);
  await expect(page.getByTestId("precedent").first()).toBeVisible();
  await expect(page.getByTestId("company-file")).toBeVisible();

  // Every explanation lives behind the one (i); the cache counter is gone from the founder UI.
  await expect(page.getByTestId("honesty")).toHaveCount(0);
  await page.getByTestId("how-this-works").click();
  await expect(page.getByTestId("honesty")).toContainText("real rounds in Cala");
  await expect(page.getByTestId("cache-stats")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("how-popover")).toHaveCount(0);
  await page.waitForTimeout(1500);
  expect(await mapHasContent(page)).toBe(true);

  // Selecting a reality highlights it and re-routes the map.
  await realities.nth(1).click();
  await expect(realities.nth(1)).toHaveAttribute("aria-pressed", "true");
  await realities.nth(1).click();

  // Flipping a branch re-simulates with that decision and selects it.
  const first = branches.first();
  await first.locator("button").first().click();
  await expect(first).toHaveClass(/is-selected/, { timeout: 15_000 });
  await expect(first.locator(".path-bands")).toBeVisible();
  await page.waitForTimeout(800);
  expect(await mapHasContent(page)).toBe(true);
  await expect(page.getByTestId("action-card").first()).toBeVisible();

  await page.getByTestId("new-simulation").click();
  await expect(page.getByTestId("interview")).toHaveAttribute("data-step", "company");
  await expect(page.getByTestId("company-name")).toHaveValue("");
  await expect(page.getByTestId("realities")).toHaveCount(0);
  await expect(page.getByTestId("tree")).toHaveCount(0);

  // No recent-companies list is ever shown (demo privacy).
  await page.getByTestId("company-name").click();
  await expect(page.getByTestId("my-companies-menu")).toHaveCount(0);

  expect(errors).toEqual([]);
});
