import { expect, test, type Page } from "@playwright/test";

const rows = (page: Page) => page.locator('[data-testid^="spotter-pick-"]:not([data-testid^="spotter-pick-investor-"])');

// The page ranks the default fund (Seedcamp) on load, scoped to Slush 2026 attendees: nothing to
// click before the picks show. The mock returns 4 attendees in that scope and 5 companies in all.
async function openSpotter(page: Page) {
  await page.goto("/path/investor");
  await expect(page.getByTestId("spotter-list")).toBeVisible();
  await expect(page.locator(".sp-h1")).toContainText(/Meet at Slush: \d+ picks for Seedcamp/i);
}

async function showAll(page: Page) {
  await page.getByTestId("spotter-scope-all").click();
  await expect(page.locator(".sp-h1")).toHaveText(/^\d+ picks for Seedcamp/i);
}

async function svgHasNodes(page: Page): Promise<number> {
  return page.evaluate(() => document.querySelectorAll('[data-testid="spotter-constellation"] svg .sp-node').length);
}

test("default fund opens on Slush attendees, tagged, without padding to five", async ({ page }) => {
  await openSpotter(page);
  await expect.poll(() => rows(page).count()).toBe(4);
  await expect(page.getByTestId("spotter-event-tag")).toHaveCount(0);
  await expect.poll(() => svgHasNodes(page)).toBe(4);
  await expect(page.locator('[data-testid="spotter-constellation"] svg .sp-event-ring')).toHaveCount(4);

  await rows(page).first().click();
  const card = page.getByTestId("spotter-card");
  const file = card.getByTestId("spotter-company-file");
  await expect(file).toContainText("Meet at Slush 2026");
  await expect(file).toContainText(/Nov 18 · Messukeskus/);
  await expect(file).toHaveAttribute("href", /^\/\?company=/);
  await expect(card).not.toContainText(/email|intro/i);
});

test("all early companies: five one-sentence picks, taste and the map, with no scrolling", async ({ page }) => {
  await openSpotter(page);
  await showAll(page);

  await expect.poll(() => rows(page).count()).toBe(5);
  await expect(page.getByTestId("spotter-event-tag")).toHaveCount(2);
  await expect(page.getByTestId("spotter-event-tag").first()).toHaveText("At Slush · Nov 18");
  await expect(rows(page).first()).toContainText(/on its path \d+%/);
  await expect(rows(page).first()).toContainText(/you’re on its path \d+%/i);

  await expect(page.getByTestId("spotter-taste")).toContainText("Your taste");
  await expect(page.getByTestId("spotter-taste")).toContainText(/from \d+ real rounds/);
  await expect(page.getByTestId("spotter-basis")).toContainText(/as of \d{4}-\d{2}-\d{2}/);

  const svg = page.locator('[data-testid="spotter-constellation"] svg');
  await expect(svg).toBeVisible();
  const box = await svg.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(600);
  expect(box?.height ?? 0).toBeGreaterThan(500);
  await expect.poll(() => svgHasNodes(page)).toBe(5);
  await expect(page.getByTestId("spotter-you")).toBeVisible();

  const railScrolls = await page.evaluate(() => {
    const rail = document.querySelector(".sp-rail");
    return rail ? rail.scrollHeight > rail.clientHeight + 1 : true;
  });
  expect(railScrolls).toBe(false);
});

test("a fund chip re-ranks for that fund; the search picker still works", async ({ page }) => {
  await openSpotter(page);
  await showAll(page);
  await page.getByTestId("spotter-quick-lightspeed-venture-partners").click();
  await expect(page.locator(".sp-h1")).toContainText(/picks for Lightspeed/i);
  await expect(page.getByTestId("spotter-list")).toBeVisible();

  await page.getByTestId("spotter-picker").click();
  await page.getByTestId("spotter-picker").fill("Index");
  await page.getByTestId("spotter-pick-investor-index-ventures").click();
  await expect(page.locator(".sp-h1")).toContainText(/picks for index[- ]ventures/i);
});

test("the single (i) holds the method, evidence counts and the as-of date", async ({ page }) => {
  await openSpotter(page);
  await expect(page.getByTestId("spotter-how-pop")).toHaveCount(0);
  await page.getByTestId("spotter-how").click();
  const pop = page.getByTestId("spotter-how-pop");
  await expect(pop).toBeVisible();
  await expect(pop).toContainText("Your taste");
  await expect(pop).toContainText(/\d+ considered/);
  await expect(pop).toContainText(/as of \d{4}-\d{2}-\d{2}/);
  await expect(pop).toContainText(/Slush 2026 event: 2,989 companies/);
  await page.keyboard.press("Escape");
  await expect(pop).toHaveCount(0);
});

test("the vision line is on the page, once, understated", async ({ page }) => {
  await openSpotter(page);
  const vision = page.locator(".sp-vision");
  await expect(vision).toHaveCount(1);
  await expect(vision).toContainText(/network inside Cala/);
});

test("selecting a pick opens its card with why-it-fits, rounds, precedents and actions", async ({ page }) => {
  await openSpotter(page);
  await showAll(page);
  await rows(page).first().click();

  const card = page.getByTestId("spotter-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Why it fits you");
  await expect(card.getByTestId("spotter-rounds").locator(".sp-chip")).not.toHaveCount(0);
  await expect(card.getByTestId("spotter-precedents").locator(".sp-precedent")).not.toHaveCount(0);
  await expect(card.getByTestId("spotter-numbers")).not.toContainText("Unicorn-like odds");
  await expect(card.getByTestId("spotter-numbers")).toContainText("You’re on its path");
  await expect(card).toContainText(/n=\d+/);
  await expect(card.getByTestId("spotter-watch")).toHaveCount(0);

  const file = card.getByTestId("spotter-company-file");
  await expect(file).toHaveAttribute("href", /^\/\?company=/);
  await expect(file).toContainText("Company file");
  await card.getByTestId("spotter-sources").click();
  await expect(card.getByTestId("spotter-sources-list")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);

  await page.locator('[data-testid^="spotter-node-"]').first().click();
  await expect(page.getByTestId("spotter-card")).toBeVisible();
});

test("works at 1280x800", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openSpotter(page);
  await expect.poll(() => svgHasNodes(page)).toBe(4);
  await rows(page).first().click();
  await expect(page.getByTestId("spotter-card")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});
