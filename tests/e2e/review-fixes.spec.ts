import { expect, test } from "@playwright/test";

test("investor view opens on a London investor with partners, so verification can pass", async ({ page }) => {
  await page.goto("/investor");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Speedinvest");
  await expect(page.locator("[data-testid^=founder-card-]").first()).toBeVisible();
});

test("a stored interest blob of the wrong shape falls back to an empty store", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("room.interest.v1", JSON.stringify({ interests: "nope" })));
  await page.goto("/investor");
  await expect(page.locator("[data-testid^=founder-card-]").first()).toBeVisible();
  await expect(page.getByTestId("open-requests")).toContainText("0/10");
});

test("an investor can withdraw an unanswered request, freeing a slot", async ({ page }) => {
  await page.goto("/investor");
  const first = page.locator("[data-testid^=founder-card-]").first();
  const id = (await first.getAttribute("data-testid"))!.replace("founder-card-", "");
  await page.getByTestId(`interested-${id}`).click();
  await expect(page.getByTestId("open-requests")).toContainText("1/10");
  await page.getByTestId(`withdraw-${id}`).click();
  await expect(page.getByTestId("open-requests")).toContainText("0/10");
  await expect(page.getByTestId(`interested-${id}`)).toHaveText("Interested");
});

test("API edge cases answer cleanly", async ({ request }) => {
  const nullBody = await request.post("/api/extract", { data: "null", headers: { "content-type": "application/json" } });
  expect(nullBody.status()).toBe(400);
  const stt = await request.get("/api/stt-token");
  expect(stt.status()).toBe(200);
  expect(await stt.json()).toEqual({ configured: false });
});
