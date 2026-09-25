import { test, expect, type Page } from "@playwright/test";

// Phone /world: the map owns the screen; filters, layers (incl. Territorial Control) and the legend open in sheets.
// After closing any sheet the map must take touches again at once: drag, pinch and marker taps, with no leftover
// backdrop, one sheet at a time, no stale state after back/forward, and no sheet/map animation for reduced motion.

test.describe.configure({ timeout: 150_000 });

const center = (page: Page) => page.evaluate(() => {
  const m = (window as unknown as { __vigilMap?: { getCenter(): { lng: number; lat: number }; getZoom(): number } }).__vigilMap!;
  const c = m.getCenter();
  return { lng: c.lng, lat: c.lat, zoom: m.getZoom() };
});

async function openWorld(page: Page) {
  await page.goto("/world");
  await expect(page.getByTestId("mobile-map-controls")).toBeVisible();
  await page.waitForFunction(() => {
    const m = (window as unknown as { __vigilMap?: { loaded(): boolean } }).__vigilMap;
    return !!m && m.loaded();
  }, undefined, { timeout: 60_000 });
}

/** What the finger would hit at the middle of the map. */
const hitAtMapCenter = (page: Page) => page.evaluate(() => {
  const c = document.querySelector("canvas.maplibregl-canvas")!.getBoundingClientRect();
  return document.elementFromPoint(c.left + c.width / 2, c.top + c.height / 2)?.tagName;
});

async function drag(page: Page) {
  const box = (await page.locator("canvas.maplibregl-canvas").boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let i = 1; i <= 8; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + i * 12, y: y + i * 6 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

async function pinch(page: Page) {
  const box = (await page.locator("canvas.maplibregl-canvas").boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x - 20, y, id: 1 }, { x: x + 20, y, id: 2 }] });
  for (let i = 1; i <= 10; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x - 20 - i * 10, y, id: 1 }, { x: x + 20 + i * 10, y, id: 2 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

async function expectMapTakesTouches(page: Page) {
  // Immediately after closing: nothing (not even a fading backdrop) sits over the map.
  expect(await hitAtMapCenter(page)).toBe("CANVAS");
  const before = await center(page);
  await drag(page);
  await expect.poll(async () => Math.abs((await center(page)).lng - before.lng), { timeout: 5_000 }).toBeGreaterThan(0.5);
  const z = (await center(page)).zoom;
  await pinch(page);
  await expect.poll(async () => (await center(page)).zoom, { timeout: 5_000 }).toBeGreaterThan(z + 0.2);
}

const dialogs = (page: Page) => page.locator('[role="dialog"]');

test.describe("Phone /world sheets", () => {
  test.beforeEach(({ isMobile }) => test.skip(!isMobile, "phone layout"));

  test("the map owns the screen: controls are one compact row", async ({ page }) => {
    await openWorld(page);
    const map = (await page.locator("canvas.maplibregl-canvas").boundingBox())!;
    const controls = (await page.getByTestId("mobile-map-controls").boundingBox())!;
    const vh = page.viewportSize()!.height;
    expect(controls.height).toBeLessThan(48);
    expect(map.height).toBeGreaterThan(vh * 0.6);
    // Nothing but the compact row, the Pulse/Overview buttons and the zoom control overlaps the map.
    await expect(page.getByTestId("territorial-toggle")).toHaveCount(0);
    await expect(page.getByTestId("what-changed")).toHaveCount(0);
  });

  for (const [button, label, close] of [
    ["mobile-filters-button", "Map filters", "escape"],
    ["mobile-layers-button", "Map layers", "button"],
    ["map-legend-button", "Map legend", "backdrop"],
  ] as const) {
    test(`${label}: opens, closes by ${close}, and the map takes drag and pinch at once`, async ({ page }) => {
      await openWorld(page);
      await page.getByTestId(button).tap();
      await expect(dialogs(page)).toHaveCount(1);
      await expect(page.getByRole("dialog", { name: label })).toBeVisible();
      if (close === "escape") await page.keyboard.press("Escape");
      else if (close === "button") await page.getByRole("button", { name: "Close sheet" }).tap();
      else await page.touchscreen.tap(200, 150); // the backdrop above the sheet
      await expect(page.getByRole("dialog", { name: label })).toHaveCount(0);
      await expectMapTakesTouches(page);
    });
  }

  test("Territorial Control is usable from the Layers sheet, and a marker tap works after closing", async ({ page }) => {
    await openWorld(page);
    await page.getByTestId("mobile-layers-button").tap();
    const sheet = page.getByRole("dialog", { name: "Map layers" });
    await sheet.getByTestId("territorial-toggle").tap();
    await expect(sheet.locator("#territory-selector")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialogs(page)).toHaveCount(0);
    await expectMapTakesTouches(page);

    // Tap an active-conflict marker: its context opens in a bottom sheet (the only open sheet).
    await page.evaluate(() => {
      const m = (window as unknown as { __vigilMap: { jumpTo(o: object): void } }).__vigilMap;
      m.jumpTo({ center: [31, 49], zoom: 2 });
    });
    const point = await page.waitForFunction(() => {
      type F = { geometry: { coordinates: [number, number] } };
      const m = (window as unknown as { __vigilMap: { queryRenderedFeatures(): (F & { layer: { id: string } })[]; project(c: [number, number]): { x: number; y: number }; getCanvas(): HTMLCanvasElement } }).__vigilMap;
      const f = m.queryRenderedFeatures().find((x) => x.layer.id === "conflict-core");
      if (!f) return null;
      const p = m.project(f.geometry.coordinates);
      const r = m.getCanvas().getBoundingClientRect();
      return { x: r.left + p.x, y: r.top + p.y };
    }, undefined, { timeout: 30_000 });
    const { x, y } = (await point.jsonValue())!;
    await page.touchscreen.tap(x, y);
    await expect(page.getByRole("dialog", { name: "Conflict context" })).toBeVisible();
    await expect(dialogs(page)).toHaveCount(1);
  });

  test("one sheet at a time: a control sheet closes the Pulse panel", async ({ page }) => {
    await openWorld(page);
    await page.getByTestId("drawer-pulse").tap();
    await expect(page.getByTestId("drawer-panel")).toBeVisible();
    await page.getByTestId("mobile-filters-button").tap();
    await expect(page.getByTestId("drawer-panel")).toHaveCount(0);
    await expect(dialogs(page)).toHaveCount(1);
  });

  test("back / forward never restores a stale open sheet", async ({ page }) => {
    await page.goto("/conflicts");
    await openWorld(page);
    await page.getByTestId("mobile-layers-button").tap();
    await expect(dialogs(page)).toHaveCount(1);
    await page.goBack();
    await expect(page).toHaveURL(/\/conflicts$/);
    await page.goForward();
    await expect(page.getByTestId("mobile-map-controls")).toBeVisible();
    await expect(dialogs(page)).toHaveCount(0);
    await expect(page.locator(".bg-black\\/50")).toHaveCount(0);
  });

  test("reduced motion: sheets appear and close without animating", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openWorld(page);
    await page.getByTestId("map-legend-button").tap();
    const sheet = page.getByRole("dialog", { name: "Map legend" });
    await expect(sheet).toBeVisible();
    // No slide: the sheet is at its resting position straight away.
    expect(await sheet.evaluate((el) => getComputedStyle(el).transform)).toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0, { timeout: 500 });
    expect(await hitAtMapCenter(page)).toBe("CANVAS");
  });
});
