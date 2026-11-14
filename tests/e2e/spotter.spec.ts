import { expect, test, type Page } from "@playwright/test";

const rows = (page: Page) => page.locator('[data-testid^="spotter-pick-"]:not([data-testid^="spotter-pick-investor-"])');

// The page ranks the default fund (Seedcamp) on load across all early companies: nothing to click
// before the picks show. The mock returns 5 companies, 2 of them tagged with the one mock event,
// and 4 attendees when scoped to that event.
async function openSpotter(page: Page) {
  await page.goto("/path/investor");
  await expect(page.getByTestId("spotter-list")).toBeVisible();
  await expect(page.locator(".sp-h1")).toHaveText(/^\d+ picks for Seedcamp/i);
}

async function openEvents(page: Page) {
  await page.getByTestId("spotter-tab-events").click();
  await expect(page.locator(".sp-h1")).toContainText(/Meet at Mock Summit 2026: \d+ picks/i);
}

async function svgHasNodes(page: Page): Promise<number> {
  return page.evaluate(() => document.querySelectorAll('[data-testid="spotter-constellation"] svg .sp-node').length);
}

test("Picks: five one-sentence picks across everything, event-tagged, taste and the map, with no scrolling", async ({ page }) => {
  await openSpotter(page);
  await expect(page.getByTestId("spotter-events")).toHaveCount(0);
  await expect(page.getByTestId("spotter-hosts")).toHaveCount(0);

  await expect.poll(() => rows(page).count()).toBe(5);
  await expect(page.getByTestId("spotter-event-tag")).toHaveCount(2);
  await expect(page.getByTestId("spotter-event-tag").first()).toHaveText("Mock Summit · Nov 18");
  await expect(rows(page).first()).toContainText(/you’re on its path \d+%/i);

  await expect(page.getByTestId("spotter-taste")).toContainText("Your taste");
  await expect(page.getByTestId("spotter-taste")).toContainText(/from \d+ real rounds/);

  const svg = page.locator('[data-testid="spotter-constellation"] svg');
  await expect(svg).toBeVisible();
  const box = await svg.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(600);
  expect(box?.height ?? 0).toBeGreaterThan(500);
  await expect.poll(() => svgHasNodes(page)).toBe(5);
  await expect(page.locator('[data-testid="spotter-constellation"] svg .sp-event-ring')).toHaveCount(2);
  await expect(page.getByTestId("spotter-you")).toBeVisible();

  const railScrolls = await page.evaluate(() => {
    const rail = document.querySelector(".sp-rail");
    return rail ? rail.scrollHeight > rail.clientHeight + 1 : true;
  });
  expect(railScrolls).toBe(false);
});

test("Events: one row per event with attendees, the first scopes the picks, no padding to five", async ({ page }) => {
  await openSpotter(page);
  await openEvents(page);

  const events = page.getByTestId("spotter-events").locator(".sp-event");
  await expect(events).toHaveCount(1);
  await expect(events.first()).toHaveAttribute("aria-checked", "true");
  await expect(events.first()).toContainText("Mock Summit 2026");
  await expect(events.first()).toContainText(/Nov 18 · Helsinki · 2 fit attend/);

  await expect.poll(() => rows(page).count()).toBe(4);
  await expect(page.getByTestId("spotter-event-tag")).toHaveCount(0);
  await expect.poll(() => svgHasNodes(page)).toBe(4);
  await expect(page.locator('[data-testid="spotter-constellation"] svg .sp-event-ring')).toHaveCount(4);

  await rows(page).first().click();
  const card = page.getByTestId("spotter-card");
  const file = card.getByTestId("spotter-company-file");
  await expect(file).toContainText("Meet at Mock Summit 2026");
  await expect(file).toContainText(/Nov 18 · Mock Hall/);
  await expect(file).toHaveAttribute("href", /^\/\?company=/);
  await expect(card).not.toContainText(/email|intro/i);

  const railScrolls = await page.evaluate(() => {
    const rail = document.querySelector(".sp-rail");
    return rail ? rail.scrollHeight > rail.clientHeight + 1 : true;
  });
  expect(railScrolls).toBe(false);

  await page.getByTestId("spotter-tab-picks").click();
  await expect(page.locator(".sp-h1")).toHaveText(/^\d+ picks for Seedcamp/i);
  await expect.poll(() => rows(page).count()).toBe(5);
});

test("a fund chip re-ranks for that fund; the search picker still works", async ({ page }) => {
  await openSpotter(page);
  await page.getByTestId("spotter-quick-lightspeed-venture-partners").click();
  await expect(page.locator(".sp-h1")).toContainText(/picks for Lightspeed/i);
  await expect(page.getByTestId("spotter-list")).toBeVisible();

  await page.getByTestId("spotter-picker").click();
  await page.getByTestId("spotter-picker").fill("Index");
  await page.getByTestId("spotter-pick-investor-index-ventures").click();
  await expect(page.locator(".sp-h1")).toContainText(/picks for index[- ]ventures/i);
});

test("the single (i) holds the method, evidence counts, the as-of date and the event sources", async ({ page }) => {
  await openSpotter(page);
  await expect(page.getByTestId("spotter-how-pop")).toHaveCount(0);
  await page.getByTestId("spotter-how").click();
  const pop = page.getByTestId("spotter-how-pop");
  await expect(pop).toBeVisible();
  await expect(pop).toContainText("Your taste");
  await expect(pop).toContainText(/\d+ considered/);
  await expect(pop.getByTestId("spotter-basis")).toContainText(/\d+ real rounds in Cala · as of \d{4}-\d{2}-\d{2}/);
  await expect(page.getByTestId("spotter-basis")).toHaveCount(1);
  await expect(pop.getByTestId("spotter-events-source")).toContainText(/Cala Event entities.*Mock Summit 2026 \(4 companies, mock\.example via Cala\)/);
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

test("Events: the host rows open the invite list in the card container, with Cala links only for real ids", async ({ page }) => {
  await openSpotter(page);
  await openEvents(page);
  const hostRows = page.getByTestId("spotter-hosts").getByTestId("spotter-host");
  await expect(hostRows).toHaveCount(2);
  await expect(hostRows.first()).toHaveText(/Fintech founders breakfast.*4 fit · 2 attend/);
  await expect(hostRows.last()).toHaveText(/Applied AI founders breakfast.*3 fit/);
  await expect(page.getByTestId("spotter-host-card")).toHaveCount(0);

  await hostRows.first().click();
  const card = page.getByTestId("spotter-host-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Host your own");
  await expect(card).toContainText("Fintech founders breakfast");
  await expect(card).toContainText("4 fit");
  const invites = card.getByTestId("spotter-invites").locator("li");
  await expect(invites).toHaveCount(4);
  await expect(invites.first()).toContainText(/Seed · 2025/);
  await expect(card.getByTestId("spotter-invite-event")).toHaveCount(2);
  await expect(card.getByTestId("spotter-invite-event").first()).toHaveText("Mock Summit · Nov 18");
  await expect(invites.locator("a")).toHaveCount(0);
  await expect(invites.last().locator("b")).toHaveText("Mock Company 4");

  await hostRows.last().click();
  await expect(card).toContainText("Applied AI founders breakfast");
  await expect(card.getByTestId("spotter-invites").locator("li")).toHaveCount(3);

  await rows(page).first().click();
  await expect(page.getByTestId("spotter-host-card")).toHaveCount(0);
  await expect(page.getByTestId("spotter-card")).toBeVisible();
  await hostRows.first().click();
  await expect(page.getByTestId("spotter-card")).toHaveCount(0);
  await expect(page.getByTestId("spotter-host-card")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("spotter-host-card")).toHaveCount(0);
});

test("works at 1280x800", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openSpotter(page);
  await expect.poll(() => svgHasNodes(page)).toBe(5);
  await rows(page).first().click();
  await expect(page.getByTestId("spotter-card")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});
