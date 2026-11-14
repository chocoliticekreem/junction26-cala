import { expect, test, type Page } from "@playwright/test";

const SHOTS = "tests/screenshots";

function trackConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    const url = msg.location().url;
    if (/\/api\/cala\/|favicon/.test(url) || /\/api\/cala\/|favicon/.test(text)) return;
    errors.push(`${text} (${url})`);
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

async function canvasHasContent(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="graph"] canvas');
    if (!canvas || canvas.width === 0 || canvas.height === 0) return false;
    const probe = document.createElement("canvas");
    probe.width = canvas.width;
    probe.height = canvas.height;
    const ctx = probe.getContext("2d");
    if (!ctx) return false;
    ctx.drawImage(canvas, 0, 0);
    const data = ctx.getImageData(0, 0, probe.width, probe.height).data;
    const [r0, g0, b0, a0] = [data[0], data[1], data[2], data[3]];
    let different = 0;
    for (let i = 0; i < data.length; i += 4 * 7) {
      const d = Math.abs(data[i] - r0) + Math.abs(data[i + 1] - g0) + Math.abs(data[i + 2] - b0) + Math.abs(data[i + 3] - a0);
      if (d > 40) different++;
    }
    return different > 50;
  });
}

test("replay screenshots, canvas content, no console errors", async ({ page }) => {
  test.setTimeout(150_000);
  const errors = trackConsoleErrors(page);
  await page.goto("/match");
  await expect(page.getByTestId("match-row")).toHaveCount(10);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/replay-t0.png` });

  const start = Date.now();
  await page.locator("body").press("r");
  await page.waitForTimeout(30_000 - (Date.now() - start));
  await page.screenshot({ path: `${SHOTS}/replay-t30.png` });
  expect(await canvasHasContent(page)).toBe(true);

  await page.waitForTimeout(62_000 - (Date.now() - start));
  await page.screenshot({ path: `${SHOTS}/replay-settled.png` });
  expect(await canvasHasContent(page)).toBe(true);
  expect(errors).toEqual([]);
});

test("investor view and unlocked chat screenshots", async ({ context }) => {
  test.setTimeout(120_000);
  const founder = await context.newPage();
  const errors = trackConsoleErrors(founder);
  await founder.goto("/match");
  await founder.locator("body").press("r");
  await founder.waitForTimeout(10_000);

  const investor = await context.newPage();
  errors.push(...trackConsoleErrors(investor));
  await investor.goto("/investor");
  await investor.getByTestId("investor-picker").click();
  await investor.getByPlaceholder("Act as investor…").fill("Medicxi");
  await investor.getByTestId("pick-medicxi").click();
  await expect(investor.getByTestId("founder-card-live")).toBeVisible();
  await investor.waitForTimeout(1500);
  await investor.screenshot({ path: `${SHOTS}/investor-medicxi.png` });

  await investor.getByTestId("interested-live").click();
  await founder.getByTestId("inbox-badge").click();
  const request = founder.locator("[data-testid^=request-]").first();
  const reqId = (await request.getAttribute("data-testid"))!.replace("request-", "");
  await founder.getByTestId(`accept-${reqId}`).click();
  await founder.getByTestId("founder-url").fill("https://cellwright.bio");
  await founder.getByTestId("founder-email").fill("anson@cellwright.bio");
  await founder.getByTestId("founder-verify-submit").click();
  await investor.getByTestId("verify-name").fill("Francesco De Rubertis");
  await investor.getByTestId("verify-email").fill("francesco@medicxi.com");
  await investor.getByTestId("verify-submit").click();
  await expect(founder.getByTestId("chat-lock")).toHaveAttribute("data-state", "open", { timeout: 2000 });
  await founder.waitForTimeout(800);
  await founder.screenshot({ path: `${SHOTS}/interest-unlocked.png` });
  expect(errors).toEqual([]);
});
