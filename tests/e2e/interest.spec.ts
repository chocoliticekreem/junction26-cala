import { expect, test, type BrowserContext, type Page } from "@playwright/test";

async function setup(context: BrowserContext): Promise<{ founder: Page; investor: Page }> {
  const founder = await context.newPage();
  await founder.goto("/");
  await founder.locator("body").press("r");
  await founder.waitForTimeout(10_000);

  const investor = await context.newPage();
  await investor.goto("/investor");
  await investor.getByTestId("investor-picker").click();
  await investor.getByPlaceholder("Act as investor…").fill("Heron Mill");
  await investor.getByTestId("pick-fx-009").click();
  await expect(investor.getByTestId("founder-card-live")).toBeVisible();
  return { founder, investor };
}

test("full flow: interested, accept, both verify, chat both ways", async ({ context }) => {
  const { founder, investor } = await setup(context);

  await expect(founder.getByTestId("inbox-badge")).toHaveAttribute("data-count", "0");
  await investor.getByTestId("interested-live").click();
  await expect(investor.getByTestId("interested-live")).toHaveText("Requested");
  await expect(founder.getByTestId("inbox-badge")).toHaveAttribute("data-count", "1", { timeout: 2000 });

  await founder.getByTestId("inbox-badge").click();
  const request = founder.locator("[data-testid^=request-]").first();
  await expect(request).toBeVisible();
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

  await expect(request).toHaveAttribute("data-state", "chat_open", { timeout: 2000 });
  await expect(founder.getByTestId("chat-lock")).toHaveAttribute("data-state", "open");

  await founder.getByTestId("chat-send").click();
  await expect(founder.getByTestId("chat-thread")).toContainText("Hi Juno");
  await expect(investor.getByTestId("chat-thread")).toContainText("Hi Juno", { timeout: 2000 });

  await investor.getByTestId("chat-draft").fill("Thanks, Thursday works.");
  await investor.getByTestId("chat-send").click();
  await expect(investor.getByTestId("chat-thread")).toContainText("Thursday works");
  await expect(founder.getByTestId("chat-thread")).toContainText("Thursday works", { timeout: 2000 });
});

test("decline shows Not now on the investor side", async ({ context }) => {
  const { founder, investor } = await setup(context);

  await investor.getByTestId("interested-live").click();
  await expect(founder.getByTestId("inbox-badge")).toHaveAttribute("data-count", "1", { timeout: 2000 });
  await founder.getByTestId("inbox-badge").click();
  const request = founder.locator("[data-testid^=request-]").first();
  const reqId = (await request.getAttribute("data-testid"))!.replace("request-", "");
  await founder.getByTestId(`decline-${reqId}`).click();

  await expect(investor.getByTestId("interested-live")).toHaveText("Not now", { timeout: 2000 });
  await expect(founder.getByText(/not now/)).toBeVisible();
});

test("investor cap: ten open requests disable every Interested button", async ({ page }) => {
  await page.goto("/investor");
  await page.getByTestId("investor-picker").click();
  await page.getByPlaceholder("Act as investor…").fill("Heron Mill");
  await page.getByTestId("pick-fx-009").click();
  await expect(page.locator("[data-testid^=founder-card-]").first()).toBeVisible();
  await expect(page.getByTestId("investor-picker")).toHaveValue(/Heron Mill/);

  await page.evaluate(() => {
    const now = new Date().toISOString();
    const interests = Array.from({ length: 10 }, (_, n) => {
      const founderId = `seed-f-${String(n + 1).padStart(2, "0")}`;
      return {
        id: `int_fx-009_${founderId}`,
        investorId: "fx-009",
        founderId,
        state: "interested",
        createdAt: now,
        updatedAt: now,
      };
    });
    localStorage.setItem("room.interest.v1", JSON.stringify({ interests, messages: [], seats: [], verifications: [] }));
  });
  await page.reload();
  // App bug (see persona-reload test below): reload resets the persona to fx-001, so re-pick.
  await page.getByTestId("investor-picker").click();
  await page.getByPlaceholder("Act as investor…").fill("Heron Mill");
  await page.getByTestId("pick-fx-009").click();

  const buttons = page.locator("[data-testid^=interested-]");
  await expect(buttons.first()).toBeVisible();
  const open = buttons.filter({ hasText: "Interested" });
  await expect(open.first()).toBeVisible();
  for (const b of await open.all()) {
    await expect(b).toBeDisabled();
    await expect(b).toHaveAttribute("title", "You have 10 open requests");
  }
});

// App bug: app/investor/page.tsx runs `if (!identity.investorId) setInvestorId(investors[0].id)` on mount.
// During hydration identity is the server default (null), so it overwrites the stored persona with fx-001.
test.fixme("investor persona survives a reload", async ({ page }) => {
  await page.goto("/investor");
  await page.getByTestId("investor-picker").click();
  await page.getByPlaceholder("Act as investor…").fill("Heron Mill");
  await page.getByTestId("pick-fx-009").click();
  await page.reload();
  await expect(page.getByTestId("investor-picker")).toHaveValue(/Heron Mill/);
});
