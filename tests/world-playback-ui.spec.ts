import { test, expect } from "@playwright/test";

// Real-browser coverage for Animated Global Timeline Playback (spec
// "turn the existing historical timeline into smooth Play/Pause
// playback"), complementing tests/world-playback.spec.ts's pure
// step/progress math with an actual render + a real ticking interval.
// All of these are desktop-only (playback controls live in the same
// floating map overlay as the rest of TimelineControls, which renders
// on both viewports, but reading the numeric progress label reliably
// needs a stable layout — kept consistent with this suite's other
// desktop-scoped checks rather than fighting mobile layout for no
// additional coverage value).

function progressLabel(page: import("@playwright/test").Page) {
  return page.getByTestId("playback-progress-label");
}

async function currentProgress(page: import("@playwright/test").Page): Promise<number> {
  const text = await progressLabel(page).textContent();
  return Number((text ?? "0%").replace("%", ""));
}

async function selectSixHourRange(page: import("@playwright/test").Page) {
  await page.goto("/world");
  const timeline = page.getByTestId("timeline-controls");
  await timeline.getByRole("radio", { name: "6H" }).click();
  await expect(page.getByTestId("playback-controls")).toBeVisible();
}

test("1. Play advances the timestamp; Pause stops it exactly where it was", async ({ page, isMobile }) => {
  test.skip(isMobile);
  await selectSixHourRange(page);

  expect(await currentProgress(page)).toBe(0);
  await page.getByTestId("playback-play").click();
  await expect(page.getByTestId("playback-pause")).toBeVisible();

  await page.waitForTimeout(1300); // ~2-3 ticks at PLAYBACK_TICK_MS=500
  const whilePlaying = await currentProgress(page);
  expect(whilePlaying).toBeGreaterThan(0);

  await page.getByTestId("playback-pause").click();
  await expect(page.getByTestId("playback-play")).toBeVisible();
  const atPause = await currentProgress(page);

  await page.waitForTimeout(800);
  const afterWaiting = await currentProgress(page);
  expect(afterWaiting).toBe(atPause);
});

test("2. Step forward and step backward move by one increment each, symmetrically", async ({ page, isMobile }) => {
  test.skip(isMobile);
  await selectSixHourRange(page);

  expect(await currentProgress(page)).toBe(0);
  await page.getByTestId("playback-step-forward").click();
  const afterOneStep = await currentProgress(page);
  expect(afterOneStep).toBeGreaterThan(0);

  await page.getByTestId("playback-step-forward").click();
  const afterTwoSteps = await currentProgress(page);
  expect(afterTwoSteps).toBeGreaterThan(afterOneStep);

  await page.getByTestId("playback-step-backward").click();
  const afterStepBack = await currentProgress(page);
  expect(afterStepBack).toBeLessThan(afterTwoSteps);
  expect(afterStepBack).toBeCloseTo(afterOneStep, 0);
});

test("3. A higher speed advances further than 1x over the same wait", async ({ page, isMobile }) => {
  test.skip(isMobile);
  await selectSixHourRange(page);

  await page.getByTestId("playback-speed-1x").click();
  await page.getByTestId("playback-play").click();
  await page.waitForTimeout(1200);
  await page.getByTestId("playback-pause").click();
  const progressAt1x = await currentProgress(page);

  // Fresh range, same wait, higher speed.
  await selectSixHourRange(page);
  await page.getByTestId("playback-speed-4x").click();
  await expect(page.getByTestId("playback-speed-4x")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("playback-play").click();
  await page.waitForTimeout(1200);
  await page.getByTestId("playback-pause").click();
  const progressAt4x = await currentProgress(page);

  expect(progressAt4x).toBeGreaterThan(progressAt1x);
});

test("4. Return to Live stops playback and removes the playback controls entirely", async ({ page, isMobile }) => {
  test.skip(isMobile);
  await selectSixHourRange(page);

  await page.getByTestId("playback-play").click();
  await expect(page.getByTestId("playback-pause")).toBeVisible();

  await page.getByTestId("return-to-live-button").click();
  await expect(page.getByTestId("playback-controls")).not.toBeVisible();
  await expect(page.getByTestId("historical-indicator")).not.toBeVisible();
});

test("5. Dragging the scrubber pauses playback cleanly and jumps to that position", async ({ page, isMobile }) => {
  test.skip(isMobile);
  await selectSixHourRange(page);

  await page.getByTestId("playback-play").click();
  await expect(page.getByTestId("playback-pause")).toBeVisible();
  await page.waitForTimeout(600);

  const scrubber = page.getByTestId("playback-scrubber");
  await scrubber.fill("500"); // ~50% through the range (0-1000 resolution)
  await expect(page.getByTestId("playback-play")).toBeVisible(); // back to a Play icon = not playing
  const afterScrub = await currentProgress(page);
  expect(afterScrub).toBeGreaterThanOrEqual(45);
  expect(afterScrub).toBeLessThanOrEqual(55);

  await page.waitForTimeout(800);
  expect(await currentProgress(page)).toBe(afterScrub); // still paused, no drift
});

test("6. Playback does not flood the network — request count over a playback window stays bounded", async ({ page, isMobile }) => {
  test.skip(isMobile);
  const eventsRequests: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("/api/events")) eventsRequests.push(req.url());
  });

  await selectSixHourRange(page);
  await page.getByTestId("playback-play").click();
  await page.waitForTimeout(3000); // ~6 ticks at PLAYBACK_TICK_MS=500
  await page.getByTestId("playback-pause").click();

  // One request per tick at most (display fetch), plus at most one
  // prefetch per tick — nowhere near "every animation frame" (which at
  // 3s would be ~180 frames). A generous but real ceiling.
  expect(eventsRequests.length).toBeLessThan(20);
});

test("7. Rapidly switching presets settles on the LAST selection and never flips back to an earlier one arriving late", async ({ page, isMobile }) => {
  test.skip(isMobile);
  await page.goto("/world");
  const timeline = page.getByTestId("timeline-controls");

  await timeline.getByRole("radio", { name: "1H" }).click();
  await timeline.getByRole("radio", { name: "24H" }).click();
  await timeline.getByRole("radio", { name: "7D" }).click();
  await timeline.getByRole("radio", { name: "6H" }).click();

  await expect(page.getByTestId("historical-indicator")).toBeVisible();
  await expect(timeline.getByRole("radio", { name: "6H" })).toHaveAttribute("aria-checked", "true");
  const settledText = await page.getByTestId("historical-indicator").textContent();

  // If an earlier (1H/24H/7D) request's response were to arrive late and
  // overwrite state instead of being ignored/aborted, this text would
  // change out from under the user after the fact.
  await page.waitForTimeout(1500);
  expect(await page.getByTestId("historical-indicator").textContent()).toBe(settledText);
  await expect(timeline.getByRole("radio", { name: "6H" })).toHaveAttribute("aria-checked", "true");
});

test("8. No console errors during a play/pause/step/speed/return-to-live cycle", async ({ page, isMobile }) => {
  test.skip(isMobile);
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  await selectSixHourRange(page);
  await page.getByTestId("playback-play").click();
  await page.waitForTimeout(800);
  await page.getByTestId("playback-speed-2x").click();
  await page.waitForTimeout(800);
  await page.getByTestId("playback-pause").click();
  await page.getByTestId("playback-step-forward").click();
  await page.getByTestId("playback-step-backward").click();
  await page.getByTestId("return-to-live-button").click();

  expect(errors).toEqual([]);
});
