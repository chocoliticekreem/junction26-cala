import { expect, test } from "@playwright/test";

// DoD 3 without a microphone: window.__roomPitch (exposed only when __ROOM_TEST__ is set) calls
// the same onInterim/onFinal handlers the STT provider gets, so everything after the mic runs.
// Latency is measured in the page, from the interim call that carries the trigger word to the
// first frame where a biotech investor is in the top 3 and the Biotech chip is visible.
const SENTENCE = "We are a pre-seed therapeutics company developing antibody drugs";
const TRIGGER = "therapeutics";
const BUDGET_MS = 2500;
const WORD_GAP_MS = 60;

test("live loop moves biotech into the top 3 within 2.5 s, three pitches in a row", async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    window.__ROOM_TEST__ = true;
  });
  const times: number[] = [];
  for (let run = 1; run <= 3; run++) {
    await page.goto("/match");
    await expect(page.getByTestId("match-row")).toHaveCount(10);
    await page.waitForFunction(() => !!window.__roomPitch);

    const ms = await page.evaluate(
      async ({ sentence, trigger, gap }) => {
        const done = () => {
          const top3 = [...document.querySelectorAll('[data-testid="match-row"]')]
            .slice(0, 3)
            .map((r) => r.getAttribute("data-sector"));
          const chip = [...document.querySelectorAll<HTMLElement>('[data-chip^="sector"]')].some(
            (c) => c.textContent?.includes("Biotech") && c.offsetParent !== null,
          );
          return top3.includes("biotech/therapeutics") && chip;
        };
        if (done()) throw new Error("biotech already on screen before the pitch");
        const pitch = window.__roomPitch;
        if (!pitch) throw new Error("test hook missing");
        let t0: number | undefined;
        const reached = new Promise<number>((resolve) => {
          const tick = () => (t0 !== undefined && done() ? resolve(performance.now() - t0) : requestAnimationFrame(tick));
          tick();
        });
        const words = sentence.split(" ");
        for (let i = 1; i <= words.length; i++) {
          pitch.interim(words.slice(0, i).join(" "));
          if (t0 === undefined && words[i - 1].toLowerCase().includes(trigger)) t0 = performance.now();
          await new Promise((r) => setTimeout(r, gap));
        }
        pitch.final(`${sentence}.`);
        return reached;
      },
      { sentence: SENTENCE, trigger: TRIGGER, gap: WORD_GAP_MS },
    );
    times.push(Math.round(ms));
    console.log(`live loop run ${run}: ${Math.round(ms)} ms from "${TRIGGER}" to biotech top 3 + chip`);

    // The final transcript commits the profile; the result must survive the interim preview ending.
    await page.waitForTimeout(500);
    await expect(page.locator('[data-chip^="sector"]').filter({ hasText: "Biotech" }).first()).toBeVisible();
    const top3 = await page
      .getByTestId("match-row")
      .evaluateAll((rows) => rows.slice(0, 3).map((r) => r.getAttribute("data-sector")));
    expect(top3).toContain("biotech/therapeutics");
  }
  console.log(`live loop times (ms): ${times.join(", ")}`);
  for (const t of times) expect(t).toBeLessThan(BUDGET_MS);
});
