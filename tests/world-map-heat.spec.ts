import { test, expect, type Page } from "@playwright/test";

// Heatmap mode = the continuous global conflict-intensity surface (lib/heat).
// The field maths are covered in heat-field.spec.ts; this file covers the
// browser side: the surface layer, legend, report-count labels, timeline
// integration and the globe layer toggle.

const mapEval = <T,>(page: Page, fn: (map: any) => T) => page.evaluate(`(${fn.toString()})(window.__vigilMap)`) as Promise<T>;

async function openHeatmap(page: Page) {
  await page.goto("/world");
  await page.getByRole("button", { name: "Heatmap" }).click();
  await expect(page.locator("[data-heat-signature]")).toHaveCount(1);
  await expect.poll(() => page.evaluate(`Boolean(window.__vigilMap && window.__vigilMap.getStyle() && window.__vigilMap.getLayer("heat-surface"))`)).toBe(true);
}
const signature = (page: Page) => page.locator("[data-heat-signature]").getAttribute("data-heat-signature");

test.describe("World map heatmap (continuous surface)", () => {
  test("Heatmap mode shows one land-clipped intensity surface, borders and a legend — and no isolated blob layers", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    page.on("console", (msg) => msg.type() === "error" && errors.push(msg.text()));
    await openHeatmap(page);

    const state = await mapEval(page, (map) => ({
      surface: map.getLayoutProperty("heat-surface", "visibility"),
      borders: map.getLayoutProperty("heat-borders", "visibility"),
      layers: map.getStyle().layers.map((l: { id: string }) => l.id),
      type: map.getLayer("heat-surface").type,
    }));
    expect(state.surface).toBe("visible");
    expect(state.borders).toBe("visible");
    expect(state.type).toBe("raster");
    expect(state.layers.filter((id: string) => /^(events-heat|conflict-base-heat)/.test(id))).toEqual([]);
    // The image actually loads (a blob URL is swapped in once the field is rasterized).
    await expect.poll(() => mapEval(page, (map) => String(map.getSource("heat-surface").url))).toMatch(/^blob:/);

    await expect(page.getByTestId("heat-legend")).toBeVisible();
    await expect(page.getByTestId("heat-legend")).toContainText("Low observed intensity");
    await expect(page.getByTestId("heat-legend")).toContainText("Extreme");
    await expect(page.getByTestId("heat-legend")).not.toContainText(/safe/i);
    const peak = Number(await page.locator("[data-heat-peak]").getAttribute("data-heat-peak"));
    expect(peak).toBeGreaterThanOrEqual(90); // curated full-scale war reaches the deepest band

    // Markers mode hides the surface and computes nothing.
    await page.getByRole("button", { name: "Markers" }).click();
    await expect(page.locator("[data-heat-signature]")).toHaveCount(0);
    expect(await mapEval(page, (map) => map.getLayoutProperty("heat-surface", "visibility"))).toBe("none");
    await expect(page.getByTestId("heat-legend")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("the legend's info tooltip says what the color means and what it does not", async ({ page }) => {
    await openHeatmap(page);
    await page.getByTestId("heat-legend-info").click();
    const tip = page.getByTestId("heat-legend-tooltip");
    await expect(tip).toBeVisible();
    await expect(tip).toContainText("observed conflict intensity");
    await expect(tip).toContainText("not a prediction");
    await expect(tip).toContainText("blue does not mean guaranteed safety");
    await expect(tip).toContainText("Report counts do not set the color");
  });

  test("report-count labels stay available in Heatmap mode and are separate from the intensity color", async ({ page }) => {
    await openHeatmap(page);
    expect(await mapEval(page, (map) => map.getLayoutProperty("report-heat-label", "visibility"))).toBe("visible");
    await expect.poll(() => mapEval(page, (map) => map.querySourceFeatures("report-heat-labels").length)).toBeGreaterThan(0);
    // Labels and borders sit above the surface in the stack.
    const order = await mapEval(page, (map) => {
      const ids = map.getStyle().layers.map((l: { id: string }) => l.id);
      return { surface: ids.indexOf("heat-surface"), label: ids.indexOf("report-heat-label"), borders: ids.indexOf("heat-borders") };
    });
    expect(order.label).toBeGreaterThan(order.surface);
    expect(order.borders).toBeGreaterThan(order.surface);
  });

  test("real published events feed the same surface and it renders without console errors", async ({ request, page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    page.on("console", (msg) => msg.type() === "error" && errors.push(msg.text()));
    const source = await request.post("/api/admin/sources", { data: { name: `Heat Test Source ${Date.now()}`, type: "manual" } }).then((r) => r.json());
    async function publish(title: string, lat: number, lng: number, severity: string, occurredAt: string) {
      const item = await request.post("/api/admin/incoming/manual", { data: { sourceId: source.id, externalId: `heat-${title}-${Date.now()}`, originalTitle: title, originalText: "heat test fixture" } }).then((r) => r.json());
      return request.post(`/api/admin/incoming/${item.id}/publish`, { data: { title, summary: "Heat surface fixture.", eventType: "other", latitude: lat, longitude: lng, occurredAt, severity } }).then((r) => r.json());
    }
    await publish("Heat test: severe single-source incident", 33.0, 44.0, "severe", new Date().toISOString());
    await publish("Heat test: old isolated low-severity report", 10.0, 20.0, "guarded", new Date(Date.now() - 45 * 24 * 3_600_000).toISOString());
    await openHeatmap(page);
    await expect.poll(() => mapEval(page, (map) => String(map.getSource("heat-surface").url))).toMatch(/^blob:/);
    await expect(page.locator(".maplibregl-canvas")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("the surface follows the global timeline: a historical asOf changes it, Live restores it", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "Mobile", "Timeline panel is a desktop workflow");
    await openHeatmap(page);
    const live = await signature(page);
    expect(live).toMatch(/^[0-9a-f]{8}$/);
    await page.getByTestId("timeline-controls").getByRole("radio", { name: "7D", exact: true }).click();
    await expect(page.getByTestId("historical-indicator")).toBeVisible();
    await expect.poll(() => signature(page)).not.toBe(live);
    expect(await signature(page)).toMatch(/^[0-9a-f]{8}$/);
    await page.getByTestId("return-to-live-button").click();
    await expect.poll(() => signature(page)).toBe(live);
  });
});

test.describe("Globe heat layer", () => {
  test("the globe paints the same intensity field behind a Heat layer toggle, with the shared legend", async ({ page }) => {
    await page.goto("/");
    const globe = page.locator('[aria-label="Interactive global conflict map"]');
    await expect(globe).toHaveAttribute("data-heat-signature", /^[0-9a-f]{8}$/, { timeout: 30000 });
    await expect(page.getByTestId("heat-legend")).toBeVisible();
    expect(Number(await globe.getAttribute("data-heat-peak"))).toBeGreaterThanOrEqual(90);

    await page.getByRole("button", { name: "Globe layers" }).click();
    const heat = page.getByRole("checkbox", { name: "Heat" });
    await expect(heat).toBeChecked();
    await heat.uncheck();
    await expect(globe).not.toHaveAttribute("data-heat-signature", /.+/);
    await expect(page.getByTestId("heat-legend")).toHaveCount(0);
    await heat.check();
    await expect(globe).toHaveAttribute("data-heat-signature", /^[0-9a-f]{8}$/);
    await expect(page.getByTestId("heat-legend")).toBeVisible();
  });
});
