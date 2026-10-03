import { test, expect, type APIRequestContext } from "@playwright/test";
import { closeWorldControls, openWorldControls } from "./helpers/world-controls";

// Report counts must be visible wherever they are meant to be: cluster counts and per-event counts in Markers mode,
// hotspot counts in Heatmap mode. Events published at a city / region carry a point and count; country-level reports
// have no point, so they add no marker (and no phantom count).

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function publishReports(request: APIRequestContext, titles: string[]) {
  const src = await (await request.post("/api/admin/sources", { data: { name: `Counts ${uid()}`, type: "manual", autoProcessing: true } })).json();
  for (const t of titles) await request.post("/api/admin/incoming/manual", { data: { sourceId: src.id, originalTitle: `${t} ${uid()}`, originalText: "Officials confirmed the report on Monday.", originalUrl: `https://news.example-source.test/${uid()}` } });
  const res = await request.post("/api/admin/incoming/publish-bulk", { data: { filters: `status=pending&sourceId=${src.id}`, mode: "publish" } });
  return (await res.json()) as { published: number; merged: number; skipped: number; failed: number };
}

type MapHandle = { queryRenderedFeatures(o: unknown): { properties: Record<string, unknown> }[]; querySourceFeatures(s: string): { properties: Record<string, unknown> }[]; jumpTo(o: unknown): void; getLayoutProperty(l: string, p: string): unknown };

test.describe("report counts on the flat map", () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, "desktop map");
  });

  test("Markers mode: the cluster count layer is drawn with the summed report count; country-level reports add no point", async ({ page, request }) => {
    // Three co-located, same-conflict kinetic reports in one batch are expected to score "high" duplicate
    // likelihood against each other on distance+time+region+conflict alone (lib/ingestion/duplicates.ts's
    // scorer), regardless of their distinct event types/titles — correctly conservative bulk-publish
    // behavior (Final Intelligence Consistency & Map Correctness v1 §1: an ambiguous candidate that doesn't
    // clear the strict auto-merge bar is held for human review rather than silently published as a
    // possibly-false new event or silently auto-merged as a possibly-false merge) means at least one of
    // the three may be withheld rather than published this batch. What this test needs is >= 2 published
    // co-located reports to prove counts are summed, not the exact fixture size.
    const result = await publishReports(request, ["Drone strike hits Kharkiv", "Shelling reported in Kharkiv", "Explosions heard in Kharkiv", "Libya central bank names a governor"]);
    expect(result.failed).toBe(0);
    expect(result.published + result.merged).toBeGreaterThanOrEqual(2);
    expect(result.published + result.merged + result.skipped).toBe(4);

    await page.goto("/world?focus=49.99,36.23,5");
    await page.waitForFunction(() => (window as unknown as { __vigilMap?: MapHandle }).__vigilMap?.querySourceFeatures("events").length, undefined, { timeout: 60_000 });
    const probe = await page.evaluate(async () => {
      const m = (window as unknown as { __vigilMap: MapHandle }).__vigilMap;
      await new Promise((r) => setTimeout(r, 1500));
      // Three CITY reports at Kharkiv are one city marker (reportCount 3), or part of a cluster summing >= 3 when zoomed out.
      const feats = m.querySourceFeatures("events");
      return {
        reports: feats.map((f) => Number(f.properties.point_count ? f.properties.reports : f.properties.reportCount)),
        drawn: m.queryRenderedFeatures({ layers: ["cluster-count", "unclustered-report-count"] }).length,
        visibility: m.getLayoutProperty("cluster-count", "visibility"),
        // every event feature has a real point: the country-level report is not a feature at all
        titles: m.querySourceFeatures("events").map((f) => String(f.properties.title ?? "")),
      };
    });
    expect(probe.visibility).toBe("visible"); // the count layers are on in marker mode
    // At least two of the Kharkiv reports published (see the comment above): their marker/cluster must
    // show a summed count, not 1 per point.
    expect(probe.reports.some((n) => n >= 2)).toBe(true);
    expect(probe.drawn).toBeGreaterThan(0);
    expect(probe.titles.some((t) => t.startsWith("Libya central bank"))).toBe(false);
  });

  test("Heatmap mode: hotspot count labels are produced for located reports and stay separate from the intensity colour", async ({ page }) => {
    await page.goto("/world?focus=49.99,36.23,5");
    await openWorldControls(page, "map");
    await page.getByRole("button", { name: "Heatmap" }).click();
    await closeWorldControls(page);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __vigilMap: MapHandle }).__vigilMap.querySourceFeatures("report-heat-labels").length), { timeout: 30_000 }).toBeGreaterThan(0);
    const vis = await page.evaluate(() => (window as unknown as { __vigilMap: MapHandle }).__vigilMap.getLayoutProperty("report-heat-label", "visibility"));
    expect(vis).toBe("visible");
  });
});
