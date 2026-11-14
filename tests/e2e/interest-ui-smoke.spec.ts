import { expect, test } from "@playwright/test";

// Two pages in one browser context share localStorage, so the founder page sees the
// investor's request through the `storage` event (spec 4.1) without a reload.
test("investor taps Interested; founder accepts; both verify; chat unlocks", async ({ context }) => {
  const investor = await context.newPage();
  await investor.goto("/investor");
  await investor.getByTestId("investor-picker").click();
  await investor.getByPlaceholder("Act as investor…").fill("Heron Mill");
  await investor.getByTestId("pick-fx-009").click();
  await expect(investor.locator("[data-testid^=founder-card-]").first()).toBeVisible();

  const founder = await context.newPage();
  await founder.goto("/investor/inbox-test");
  await founder.getByTestId("seed-live-profile").click();
  await expect(founder.getByTestId("inbox-badge")).toHaveAttribute("data-count", "0");

  await expect(investor.getByTestId("founder-card-live")).toBeVisible();
  await investor.getByTestId("interested-live").click();
  await expect(investor.getByTestId("interested-live")).toHaveText("Requested");

  const request = founder.locator("[data-testid^=request-]").first();
  await expect(request).toBeVisible({ timeout: 2000 });
  await expect(founder.getByTestId("inbox-badge")).toHaveAttribute("data-count", "1", { timeout: 2000 });
  await expect(request).toContainText("backed");

  const reqId = (await request.getAttribute("data-testid"))!.replace("request-", "");
  await founder.getByTestId(`accept-${reqId}`).click();
  await expect(request).toHaveAttribute("data-state", "pending_verification");
  await expect(founder.getByTestId("chat-lock")).toHaveAttribute("data-state", "locked");

  await founder.getByTestId("founder-url").fill("https://cellwright.bio");
  await founder.getByTestId("founder-email").fill("anson@cellwright.bio");
  await founder.getByTestId("founder-verify-submit").click();
  await expect(request).toHaveAttribute("data-state", "pending_verification");

  await investor.getByTestId("verify-name").fill("Juno Marchetti");
  await investor.getByTestId("verify-email").fill("juno@heron-mill-bio-capital.example");
  await investor.getByTestId("verify-submit").click();
  await expect(investor.getByText("Verified via Cala partner record", { exact: true })).toBeVisible();

  await expect(request).toHaveAttribute("data-state", "chat_open", { timeout: 2000 });
  await expect(founder.getByTestId("chat-lock")).toHaveAttribute("data-state", "open");
  const draft = founder.getByTestId("chat-draft");
  await expect(draft).not.toHaveValue("");
  await founder.getByTestId("chat-send").click();
  await expect(founder.getByTestId("chat-thread")).toContainText("Hi Juno");
  await expect(investor.getByTestId("chat-thread")).toContainText("Hi Juno", { timeout: 2000 });

  await founder.screenshot({ path: "tests/screenshots/interest-mock.png" });
});

test("room suggestion builds a room; founder requests a seat; host seats them", async ({ page }) => {
  await page.goto("/investor");
  await page.getByTestId("investor-picker").click();
  await page.getByPlaceholder("Act as investor…").fill("Heron Mill");
  await page.getByTestId("pick-fx-009").click();
  await page.getByTestId("open-room-builder").click();
  await page.getByTestId("create-room").click();
  await page.waitForURL(/\/room\//);
  await page.getByTestId("request-seat").click();
  await expect(page.getByTestId("seat-state")).toHaveAttribute("data-state", "requested");
  await page.getByTestId("role-host").click();
  await page.getByTestId("seat-live").click();
  await page.getByTestId("role-founder").click();
  await expect(page.getByTestId("seat-state")).toHaveAttribute("data-state", "seated");
});
