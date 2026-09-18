import { test, expect } from "@playwright/test";

test.describe("Admin Source Manager (/admin/sources)", () => {
  // Reaching a row past the first few requires Playwright's pre-click
  // auto-scroll. On the Mobile project, Chromium's `isMobile: true`
  // viewport emulation (which simulates the on-device browser's
  // address-bar show/hide-on-scroll behavior) was confirmed — via
  // boundingBox()/elementFromPoint()/window.visualViewport logging — to
  // leave visualViewport.offsetTop non-zero after that scroll, desyncing
  // the visual viewport from the layout viewport Playwright's own click
  // hit-testing uses, and misses the target. Reproduced identically on
  // this project's plain, unmodified /admin/conflicts table, i.e.
  // independent of any particular page's markup — a real tap in an actual
  // browser (verified manually) hits the button correctly; this is an
  // artifact of Chromium's automated mobile-viewport emulation, not a
  // real device's behavior. `isMobile: false` here keeps every other
  // Pixel 7 trait (412x839 viewport, UA, touch events, DPR) — which is
  // what this suite actually needs to exercise the `max-sm:`/`sm:` CSS
  // breakpoints — while opting out of just the buggy address-bar
  // simulation, scoped to this file only since other suites' tests rely
  // on isMobile's touch/hover media-query behavior.
  test.use({ isMobile: false });

  test("seeded Telegram sources are disabled and report the adapter-disabled error on test", async ({ page }) => {
    await page.goto("/admin/sources");
    // Source rows render as a <tr> on desktop and a separate <div> card list
    // on mobile (only one is visible at a given viewport); matching on the
    // shared data-testid prefix works for both without depending on tag name.
    const row = page.locator('[data-testid^="source-row-"]:visible', { hasText: "Liveuamap Source" });
    await expect(row).toBeVisible();
    await expect(row.getByRole("button", { name: "Off" })).toBeVisible();
    await expect(row).toContainText("unauthorized");

    await row.getByRole("button", { name: "Test" }).click();
    await expect(row).toContainText(/Telegram adapter disabled/);
  });

  test("add, disable, and delete a source", async ({ page }) => {
    const name = `E2E Source ${Date.now()}`;
    await page.goto("/admin/sources");
    await page.getByRole("button", { name: "Add Source" }).click();
    await page.getByLabel("Name").fill(name);
    await page.getByLabel("Type").selectOption("manual");
    await page.getByRole("button", { name: "Create Source" }).click();

    const row = page.locator('[data-testid^="source-row-"]:visible', { hasText: name });
    await expect(row).toBeVisible();
    await expect(row.getByRole("button", { name: "On" })).toBeVisible();

    await row.getByRole("button", { name: "On" }).click();
    await expect(row.getByRole("button", { name: "Off" })).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await row.getByRole("button", { name: "Delete source" }).click();
    await expect(page.locator('[data-testid^="source-row-"]:visible', { hasText: name })).toHaveCount(0);
  });
});

test.describe("Admin Incoming Reports (/admin/incoming)", () => {
  test("manual submission → publish removes it from the pending queue and it reaches /api/events", async ({
    page,
    request,
  }) => {
    const title = `E2E Publish Test ${Date.now()}`;

    const sourceRes = await request.post("/api/admin/sources", {
      data: { name: `E2E Manual Source ${Date.now()}`, type: "manual" },
    });
    expect(sourceRes.ok()).toBeTruthy();
    const source = await sourceRes.json();

    const itemRes = await request.post("/api/admin/incoming/manual", {
      data: { sourceId: source.id, originalTitle: title, originalText: "E2E test summary." },
    });
    expect(itemRes.ok()).toBeTruthy();
    const item = await itemRes.json();

    await page.goto("/admin/incoming");
    const card = page.getByTestId(`incoming-item-${item.id}`);
    await expect(card).toBeVisible();
    await expect(card).toContainText(title);

    await card.getByRole("button", { name: "Review" }).click();
    await card.getByLabel("Latitude").fill("48.8566");
    await card.getByLabel("Longitude").fill("2.3522");
    await card.getByRole("button", { name: "Publish" }).click();

    await expect(page.getByTestId(`incoming-item-${item.id}`)).toHaveCount(0);

    const eventsRes = await request.get("/api/events");
    const events = await eventsRes.json();
    expect(events.some((e: { title: string }) => e.title === title)).toBe(true);
  });

  test("manual submission → reject removes it from the pending queue", async ({ page, request }) => {
    const title = `E2E Reject Test ${Date.now()}`;

    const sourceRes = await request.post("/api/admin/sources", {
      data: { name: `E2E Manual Source B ${Date.now()}`, type: "manual" },
    });
    const source = await sourceRes.json();
    const itemRes = await request.post("/api/admin/incoming/manual", {
      data: { sourceId: source.id, originalTitle: title, originalText: "E2E test summary." },
    });
    const item = await itemRes.json();

    await page.goto("/admin/incoming");
    const card = page.getByTestId(`incoming-item-${item.id}`);
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Reject" }).click();
    await expect(page.getByTestId(`incoming-item-${item.id}`)).toHaveCount(0);
  });
});
