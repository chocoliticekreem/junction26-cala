import { expect, test, type Page } from "@playwright/test";

async function pickSeedcamp(page: Page) {
  await page.goto("/path/investor");
  await expect(page.getByTestId("spotter-idle")).toBeVisible();
  await expect(page.getByTestId("spotter-idle")).toContainText("Which fund are you?");
  await page.getByTestId("spotter-picker").click();
  await page.getByTestId("spotter-picker").fill("Seedcamp");
  await page.getByTestId("spotter-pick-investor-seedcamp").click();
  await expect(page.getByTestId("spotter-list")).toBeVisible();
}

async function svgHasNodes(page: Page): Promise<number> {
  return page.evaluate(() => document.querySelectorAll('[data-testid="spotter-constellation"] svg .sp-node').length);
}

test("early spotter ranks at least five picks on a non-blank constellation", async ({ page }) => {
  await pickSeedcamp(page);

  const rows = page.locator('[data-testid^="spotter-pick-"]:not([data-testid^="spotter-pick-investor-"])');
  await expect.poll(() => rows.count()).toBeGreaterThanOrEqual(5);
  await expect(rows.first()).toContainText(/Unicorn-like odds \d+%/);
  await expect(rows.first()).toContainText(/You’re on its path \d+%/);

  await expect(page.getByTestId("spotter-taste")).toContainText("Your taste");
  await expect(page.getByTestId("spotter-taste")).toContainText(/from \d+ real rounds/);
  await expect(page.getByTestId("spotter-basis")).toContainText(/as of \d{4}-\d{2}-\d{2}/);

  const svg = page.locator('[data-testid="spotter-constellation"] svg');
  await expect(svg).toBeVisible();
  const box = await svg.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(600);
  expect(box?.height ?? 0).toBeGreaterThan(500);
  await expect.poll(() => svgHasNodes(page)).toBeGreaterThanOrEqual(5);
  await expect(page.getByTestId("spotter-you")).toBeVisible();
});

test("quick pick runs the spotter for that fund", async ({ page }) => {
  await page.goto("/path/investor");
  await page.getByTestId("spotter-quick-seedcamp").click();
  await expect(page.getByTestId("spotter-list")).toBeVisible();
  await expect(page.locator(".sp-title")).toContainText(/picks for seedcamp/i);
});

test("how-this-works popover holds the method, evidence counts and the as-of date", async ({ page }) => {
  await pickSeedcamp(page);
  await expect(page.getByTestId("spotter-how-pop")).toHaveCount(0);
  await page.getByTestId("spotter-how").click();
  const pop = page.getByTestId("spotter-how-pop");
  await expect(pop).toBeVisible();
  await expect(pop).toContainText("Your taste");
  await expect(pop).toContainText(/\d+ considered/);
  await expect(pop).toContainText(/as of \d{4}-\d{2}-\d{2}/);
  await page.keyboard.press("Escape");
  await expect(pop).toHaveCount(0);
});

test("selecting a pick opens its card with why-it-fits, rounds, precedents and actions", async ({ page }) => {
  await pickSeedcamp(page);
  const first = page.locator('[data-testid^="spotter-pick-"]:not([data-testid^="spotter-pick-investor-"])').first();
  await first.click();

  const card = page.getByTestId("spotter-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Why it fits you");
  await expect(card.getByTestId("spotter-rounds").locator(".sp-chip")).not.toHaveCount(0);
  await expect(card.getByTestId("spotter-precedents").locator(".sp-precedent")).not.toHaveCount(0);
  await expect(card.getByTestId("spotter-numbers")).toContainText("Unicorn-like odds");
  await expect(card.getByTestId("spotter-numbers")).toContainText("You’re on its path");
  await expect(card).toContainText(/n=\d+/);
  await expect(card.getByTestId("spotter-watch")).toHaveCount(0);

  const file = card.getByTestId("spotter-company-file");
  await expect(file).toHaveAttribute("href", /^\/\?company=/);
  await card.getByTestId("spotter-sources").click();
  await expect(card.getByTestId("spotter-sources-list")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);

  await page.locator('[data-testid^="spotter-node-"]').first().click();
  await expect(page.getByTestId("spotter-card")).toBeVisible();
});

test("works at 1280x800", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await pickSeedcamp(page);
  await expect.poll(() => svgHasNodes(page)).toBeGreaterThanOrEqual(5);
  await page.locator('[data-testid^="spotter-pick-"]:not([data-testid^="spotter-pick-investor-"])').first().click();
  await expect(page.getByTestId("spotter-card")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});
