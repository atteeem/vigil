import { test, expect } from "@playwright/test";
import { closeWorldControls, openWorldControls } from "./helpers/world-controls";

test.describe("World map (/world)", () => {
  test("loads with the map, zoom controls, and basemap mode switch", async ({ page }) => {
    await page.goto("/world");
    await expect(page.getByRole("application", { name: "Operational conflict map" })).toBeVisible();
    await openWorldControls(page, "layers");
    const basemapGroup = page.getByRole("radiogroup", { name: "Basemap" });
    await expect(basemapGroup.getByRole("radio", { name: "Intel" })).toBeVisible();
    await expect(basemapGroup.getByRole("radio", { name: "Street" })).toBeVisible();
    await expect(basemapGroup.getByRole("radio", { name: "Satellite" })).toBeVisible();
    // MapLibre's NavigationControl (+/- zoom buttons).
    await expect(page.locator(".maplibregl-ctrl-zoom-in")).toBeVisible();
    await expect(page.locator(".maplibregl-ctrl-zoom-out")).toBeVisible();
  });

  test("switching basemap mode does not drop the event feed", async ({ page, isMobile }) => {
    if (isMobile) {
      // Desktop-only feed column — mobile uses a bottom sheet instead
      // (covered by responsive.spec.ts), so there's no count to compare.
      test.skip();
    }
    await page.goto("/world");
    // /world merges mock events with live published DB events fetched
    // asynchronously on mount (hooks/use-live-events.ts) — wait for that
    // initial fetch to settle so the "before" and "after" reads below
    // aren't racing it (this suite doesn't reset the DB between spec
    // files, so other specs' published test events are visible here too).
    await page.waitForTimeout(500);
    await page.getByTestId("left-tab-events").click();
    await expect(page.getByText(/events in range/)).toBeVisible();
    const countBefore = await page.getByText(/events in range/).textContent();

    const basemapGroup = page.getByRole("radiogroup", { name: "Basemap" });
    await basemapGroup.getByRole("radio", { name: "Street" }).click();
    await expect(basemapGroup.getByRole("radio", { name: "Street" })).toHaveAttribute("aria-checked", "true");
    await page.waitForTimeout(300);

    const countAfter = await page.getByText(/events in range/).textContent();
    expect(countAfter).toBe(countBefore);

    // Whether the "no MapTiler key" fallback notice shows in Street mode
    // depends on whether this environment has NEXT_PUBLIC_MAPTILER_KEY set
    // (it does in local dev once configured, but not in every environment
    // this suite might run in) — the one invariant true either way is that
    // the notice never shows in Intel mode (world-map.tsx only shows it
    // when basemapMode !== "intel" && no key).
    await basemapGroup.getByRole("radio", { name: "Intel" }).click();
    await expect(page.getByText(/MapTiler key/)).not.toBeVisible();
  });

  test("markers/clustering render on the map canvas", async ({ page }) => {
    await page.goto("/world");
    await page.waitForTimeout(1000); // MapLibre style + first paint
    // MapLibre draws everything to a single <canvas>; presence + non-zero
    // size is the practical signal the map actually rendered (no canvas
    // access from outside the worker to assert pixel content here).
    const canvas = page.locator(".maplibregl-canvas");
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box?.width).toBeGreaterThan(100);
    expect(box?.height).toBeGreaterThan(100);
  });

  test("selecting an event from the feed opens the detail panel", async ({ page, isMobile }) => {
    await page.goto("/world");
    const feed = page.getByRole("heading", { name: "Live Event Feed" });
    if (isMobile) {
      // Desktop-only feed column; mobile uses the bottom sheet instead —
      // covered by responsive.spec.ts.
      test.skip();
    }
    await page.getByTestId("left-tab-events").click();
    await expect(feed).toBeVisible();
    await feed.locator("..").locator("button").first().click();
    await expect(page.getByRole("button", { name: "Close" })).toBeVisible();
  });
});
