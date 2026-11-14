import { expect, test, type Page } from "@playwright/test";

// /path against the typed mock (E2E_MOCK=1, no engine routes): company -> pitch -> vision ->
// simulate -> realities + tree + particle map -> flip a branch -> reset clears everything.

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

test("path: interview, simulate, flip a branch, reset", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/path");
  await expect(page.getByTestId("interview")).toHaveAttribute("data-step", "company");
  await expect(page.getByTestId("nav-path")).toHaveClass(/is-active/);

  await page.getByTestId("company-name").fill("Cala");
  await expect(page.getByTestId("candidate").first()).toBeVisible();
  await page.getByTestId("candidate").first().click();
  await expect(page.getByTestId("company-found")).toContainText("Cala");

  await page.getByRole("button", { name: "Type", exact: true }).click();
  await page.getByTestId("pitch-text").fill("We are a seed stage B2B SaaS company building developer tools for investors, raising $5m.");
  await expect(page.locator('[data-chip^="sector"]').first()).toBeVisible();
  await page.getByTestId("next").click();

  await expect(page.getByTestId("interview")).toHaveAttribute("data-step", "vision");
  await page.getByTestId("vision-example").first().click();
  await expect(page.getByTestId("vision-basis")).toContainText("Target");
  await page.getByTestId("simulate").click();

  await expect(page.getByTestId("realities")).toBeVisible({ timeout: 20_000 });
  const realities = page.getByTestId("reality");
  expect(await realities.count()).toBeGreaterThanOrEqual(3);
  const branches = page.getByTestId("tree").locator('[data-testid="branch"][data-depth="1"]');
  expect(await branches.count()).toBeGreaterThanOrEqual(2);
  await expect(page.getByTestId("honesty")).toContainText("real rounds in Cala");
  await expect(page.getByTestId("precedent").first()).toBeVisible();
  await expect(page.getByTestId("company-file")).toBeVisible();
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

  expect(errors).toEqual([]);
});
