import { expect, test, type Page } from "@playwright/test";

async function actAsHeronMill(page: Page) {
  await page.goto("/investor");
  await page.getByTestId("investor-picker").click();
  await page.getByPlaceholder("Act as investor…").fill("Heron Mill");
  await page.getByTestId("pick-fx-009").click();
  await expect(page.locator("[data-testid^=founder-card-]").first()).toBeVisible();
}

const cards = (page: Page) => page.locator("[data-testid^=founder-card-]");

async function visibleCount(page: Page): Promise<number> {
  const text = (await page.getByText(/\d+\/\d+ · sorted by fit/).first().textContent()) ?? "";
  return Number(text.match(/(\d+)\/\d+/)![1]);
}

test("founder feed ranks cards by descending fit score", async ({ page }) => {
  await actAsHeronMill(page);
  const scores = await cards(page).evaluateAll((els) =>
    els.slice(0, 5).map((el) => parseInt(el.querySelector("span.tabular-nums")?.firstChild?.textContent ?? "", 10)),
  );
  expect(scores).toHaveLength(5);
  for (const s of scores) expect(Number.isFinite(s)).toBe(true);
  expect(scores).toEqual([...scores].sort((a, b) => b - a));
});

test("room suggestion appears for biotech with at least 12 founders", async ({ page }) => {
  await actAsHeronMill(page);
  const suggestion = page.getByTestId("room-suggestion").first();
  await expect(suggestion).toBeVisible();
  const text = (await suggestion.textContent()) ?? "";
  expect(text.toLowerCase()).toContain("biotech");
  const count = Number(/(\d+)\s*matched founders/.exec(text)?.[1]);
  expect(count).toBeGreaterThanOrEqual(12);
});

test("group by sector shows a Biotech group", async ({ page }) => {
  await actAsHeronMill(page);
  await page.getByRole("button", { name: "By sector" }).click();
  await expect(page.getByText("Biotech", { exact: true }).first()).toBeVisible();
});

test("Has revenue filter keeps only founders with revenue", async ({ page }) => {
  await actAsHeronMill(page);
  const before = await visibleCount(page);
  await page.getByRole("button", { name: "Has revenue" }).click();
  await expect.poll(() => visibleCount(page)).toBeLessThanOrEqual(before);
  const n = await cards(page).count();
  expect(n).toBeGreaterThan(0);
  expect(n).toBe(await visibleCount(page));
  for (const card of await cards(page).all()) {
    await expect(card).toContainText(/rev\s/);
  }
});
