import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { aggregateReportBuckets, formatReportCount, hotspotCellDegrees, reportCountOf, sumReportCounts } from "@/lib/map/report-counts";
import { clusterEvents, formatClusterCount } from "@/lib/globe/event-clusters";
import { eventsToGeoJSON } from "@/lib/map/events-to-geojson";
import type { ConflictEvent } from "@/lib/types";

// Report counts on markers, clusters and heatmap hotspots. The number is the
// count of supporting REPORTS (sources attached to the events), never how
// many event objects are nearby, and it is capped at "99+" for display only.

function ev(id: string, lat: number, lng: number, reports: number, extra: Partial<ConflictEvent> = {}): ConflictEvent {
  return {
    id,
    slug: id,
    title: id,
    summary: "s",
    eventType: "other",
    lat,
    lng,
    countryCode: "XX",
    region: "Global",
    conflictId: null,
    occurredAt: "2026-09-16T12:00:00.000Z",
    severity: "elevated",
    importance: 50,
    verificationStatus: "reported",
    disputed: false,
    sourceCount: 1,
    sources: Array.from({ length: reports }, (_, i) => ({ id: `${id}-${i}` })) as unknown as ConflictEvent["sources"],
    timeline: [],
    ...extra,
  };
}

test.describe("Report count model (lib/map/report-counts.ts)", () => {
  test("1. One event with many reports shows its report count, not 1", () => {
    expect(reportCountOf(ev("a", 0, 0, 18))).toBe(18);
    expect(eventsToGeoJSON([ev("a", 0, 0, 18)]).features[0]!.properties.reportCount).toBe(18);
  });

  test("2. An event with no attached source list still counts as at least one report (independent-source count is the fallback)", () => {
    expect(reportCountOf({ sources: [], sourceCount: 0 })).toBe(1);
    expect(reportCountOf({ sources: [], sourceCount: 4 })).toBe(4);
  });

  test("3. A cluster of several events displays the SUM of their reports, not the number of events", () => {
    const events = [ev("a", 10, 10, 1), ev("b", 10.01, 10.01, 3), ev("c", 9.99, 9.99, 18)];
    const clusters = clusterEvents(events, 1);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.count).toBe(3); // events grouped
    expect(clusters[0]!.reportCount).toBe(22); // what the marker shows
    expect(sumReportCounts(events)).toBe(22);
  });

  test("4. Display is capped at 99+ but the true count is kept", () => {
    expect(formatReportCount(1)).toBe("1");
    expect(formatReportCount(99)).toBe("99");
    expect(formatReportCount(100)).toBe("99+");
    expect(formatClusterCount(5000)).toBe("99+");
    const big = clusterEvents([ev("a", 0, 0, 60), ev("b", 0.01, 0.01, 70)], 1);
    expect(big[0]!.reportCount).toBe(130);
    expect(formatClusterCount(big[0]!.reportCount)).toBe("99+");
  });

  test("5. Zoom regrouping: zooming out merges hotspots (and sums them), zooming in splits them apart", () => {
    const events = [ev("a", 50.0, 10.0, 4), ev("b", 50.5, 10.6, 6), ev("c", 51.6, 11.9, 2), ev("d", -30, 140, 5)];
    const far = aggregateReportBuckets(events, 2); // ~12 degree cells
    const near = aggregateReportBuckets(events, 8); // ~0.19 degree cells
    expect(far.length).toBeLessThan(near.length);
    expect(near).toHaveLength(4);
    expect(far.map((b) => b.reports)).toEqual([12, 5]); // 4+6+2 in Europe, 5 elsewhere, busiest first
    expect(hotspotCellDegrees(2)).toBeGreaterThan(hotspotCellDegrees(8));
    // Reports are conserved at every zoom.
    for (const z of [0, 2, 5, 8, 12]) expect(aggregateReportBuckets(events, z).reduce((n, b) => n + b.reports, 0)).toBe(17);
  });

  test("6. Heatmap aggregation is bounded and deterministic: hundreds of events never produce hundreds of labels", () => {
    const many = Array.from({ length: 600 }, (_, i) => ev(`e${i}`, ((i * 37) % 160) - 80, ((i * 91) % 340) - 170, 1 + (i % 7)));
    const buckets = aggregateReportBuckets(many, 6, 40);
    expect(buckets.length).toBeLessThanOrEqual(40);
    expect(aggregateReportBuckets(many, 6, 40)).toEqual(buckets);
    for (let i = 1; i < buckets.length; i++) expect(buckets[i - 1]!.reports).toBeGreaterThanOrEqual(buckets[i]!.reports);
  });

  test("7. Bucket position is the report-weighted centroid of its events", () => {
    const [b] = aggregateReportBuckets([ev("a", 10, 10, 1), ev("b", 10.4, 10.4, 3)], 2);
    expect(b!.lat).toBeCloseTo((10 * 1 + 10.4 * 3) / 4, 6);
    expect(b!.reports).toBe(4);
  });

  test("8. Territorial Control never affects report counts (they are a pure function of the events)", () => {
    const events = [ev("a", 10, 10, 3)];
    const before = aggregateReportBuckets(events, 4);
    // Territory is not an input to any of these functions; the signatures accept events only.
    expect(aggregateReportBuckets.length).toBeLessThanOrEqual(3);
    expect(aggregateReportBuckets(events, 4)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// Rendered map (/world): real published events with several reports each.

const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
// An empty patch of the south Pacific: no seeded event or territory nearby.
const LAT = -41.3;
const LNG = -128.4;

async function publishEventWithReports(request: APIRequestContext, title: string, lat: number, lng: number, reports: number) {
  const source = await request
    .post("/api/admin/sources", { data: { name: `Report count source ${unique()}`, type: "manual", enabled: true, autoIngest: false } })
    .then((r) => r.json());
  const created = await request.post("/api/admin/events", {
    data: { title, summary: "Report count fixture.", eventType: "artillery", latitude: lat, longitude: lng, occurredAt: new Date().toISOString(), severity: "elevated", published: true, sourceName: `Origin ${unique()}` },
  });
  expect(created.status()).toBe(201);
  const event = await created.json();
  for (let i = 1; i < reports; i++) {
    const item = await request
      .post("/api/admin/incoming/manual", {
        data: { sourceId: source.id, externalId: `rc-${unique()}-${i}`, originalUrl: `https://fixture.test/rc/${unique()}`, originalTitle: `${title} report ${i}`, originalText: "Additional report.", publishedAt: new Date().toISOString() },
      })
      .then((r) => r.json());
    const merged = await request.post(`/api/admin/incoming/${item.id}/merge`, { data: { eventId: event.id, relationship: "corroborating" } });
    expect(merged.ok()).toBe(true);
  }
  return event as { id: string; slug: string };
}

async function mapCall<T>(page: Page, fn: string, arg?: unknown): Promise<T> {
  return page.evaluate(
    ([code, a]) => {
      const map = (window as unknown as { __vigilMap: unknown }).__vigilMap;
      return new Function("map", "arg", `return (${code})(map, arg)`)(map, a);
    },
    [fn, arg] as [string, unknown],
  ) as Promise<T>;
}

test.describe.serial("Report counts on the rendered map", () => {
  test.use({ isMobile: false });
  const titleA = `RC event A ${unique()}`;
  const titleB = `RC event B ${unique()}`;

  test("1. Set up: event A with 5 reports and event B with 3 reports, 0.02 degrees apart", async ({ request }) => {
    await publishEventWithReports(request, titleA, LAT, LNG, 5);
    await publishEventWithReports(request, titleB, LAT + 0.02, LNG + 0.02, 3);
    const events = (await request.get("/api/events").then((r) => r.json())) as { title: string; sources: unknown[] }[];
    expect(events.find((e) => e.title === titleA)!.sources).toHaveLength(5);
    expect(events.find((e) => e.title === titleB)!.sources).toHaveLength(3);
  });

  test("2. Zoomed in, every marker carries its own report count and the count layer is visible in marker mode", async ({ page }) => {
    await page.goto("/world");
    await page.waitForFunction(() => Boolean((window as unknown as { __vigilMap?: unknown }).__vigilMap));
    await expect
      .poll(async () =>
        mapCall<string[]>(page, `(map) => { map.jumpTo({ center: [${LNG}, ${LAT}], zoom: 11 }); return map.querySourceFeatures("events").filter((f) => !f.properties.cluster).map((f) => f.properties.title + "=" + f.properties.reportCount).sort(); }`),
      )
      .toEqual([`${titleA}=5`, `${titleB}=3`].sort());
    expect(await mapCall<string>(page, `(map) => map.getLayoutProperty("unclustered-report-count", "visibility") ?? "visible"`)).toBe("visible");
  });

  test("3. Zoomed out, the two events cluster and the cluster's number is the SUM of reports (8), not the event count (2)", async ({ page }) => {
    await page.goto("/world");
    await page.waitForFunction(() => Boolean((window as unknown as { __vigilMap?: unknown }).__vigilMap));
    await expect
      .poll(async () =>
        mapCall<number[]>(page, `(map) => { map.jumpTo({ center: [${LNG}, ${LAT}], zoom: 3 }); return map.querySourceFeatures("events").filter((f) => f.properties.cluster && f.properties.point_count === 2).map((f) => f.properties.reports); }`),
      )
      .toContain(8);
  });

  test("4. Display expressions cap the label at 99+ for markers and clusters", async ({ page }) => {
    await page.goto("/world");
    await page.waitForFunction(() => Boolean((window as unknown as { __vigilMap?: unknown }).__vigilMap));
    await expect.poll(async () => mapCall<boolean>(page, `(map) => Boolean(map.getLayer("cluster-count"))`)).toBe(true);
    for (const layer of ["cluster-count", "unclustered-report-count"]) {
      const expression = await mapCall<unknown>(page, `(map, layer) => map.getLayoutProperty(layer, "text-field")`, layer);
      expect(JSON.stringify(expression)).toContain("99+");
    }
  });

  test("5. Heatmap mode: unobtrusive hotspot labels that regroup with zoom, and marker counts step aside", async ({ page }) => {
    await page.goto("/world");
    await page.waitForFunction(() => Boolean((window as unknown as { __vigilMap?: unknown }).__vigilMap));
    await page.getByRole("button", { name: "Heatmap" }).click();
    await expect(page.getByRole("button", { name: "Heatmap" })).toHaveAttribute("aria-pressed", "true");

    await expect.poll(async () => mapCall<boolean>(page, `(map) => Boolean(map.getSource("report-heat-labels"))`)).toBe(true);
    const labelsNear = `(map) => map.getSource("report-heat-labels").getData().then((d) => d.features.filter((f) => Math.abs(f.geometry.coordinates[1] - (${LAT})) < 1 && Math.abs(f.geometry.coordinates[0] - (${LNG})) < 1).map((f) => f.properties.label).sort())`;
    // Zoomed out: one hotspot for both events, summed.
    await mapCall(page, `(map) => map.jumpTo({ center: [${LNG}, ${LAT}], zoom: 2 })`);
    await expect.poll(async () => mapCall<string[]>(page, labelsNear)).toEqual(["8"]);
    // Zoomed in: split into the two events' own counts.
    await mapCall(page, `(map) => map.jumpTo({ center: [${LNG}, ${LAT}], zoom: 12 })`);
    await expect.poll(async () => mapCall<string[]>(page, labelsNear)).toEqual(["3", "5"]);

    expect(await mapCall<string>(page, `(map) => map.getLayoutProperty("report-heat-label", "visibility")`)).toBe("visible");
    expect(await mapCall<string>(page, `(map) => map.getLayoutProperty("unclustered-report-count", "visibility")`)).toBe("none");
    // Bounded: never hundreds of labels.
    expect(await mapCall<number>(page, `(map) => map.getSource("report-heat-labels").getData().then((d) => d.features.length)`)).toBeLessThanOrEqual(40);
  });

  test("6. Territorial Control on/off leaves the report counts unchanged", async ({ page }) => {
    await page.goto("/world");
    await page.waitForFunction(() => Boolean((window as unknown as { __vigilMap?: unknown }).__vigilMap));
    const read = `(map) => { map.jumpTo({ center: [${LNG}, ${LAT}], zoom: 11 }); return map.querySourceFeatures("events").filter((f) => !f.properties.cluster && String(f.properties.title).startsWith("RC event")).map((f) => f.properties.reportCount).sort(); }`;
    await expect.poll(async () => mapCall<number[]>(page, read)).toEqual([3, 5]);
    await page.getByTestId("territorial-toggle").click();
    await expect.poll(async () => mapCall<number[]>(page, read)).toEqual([3, 5]);
  });
});

test.describe("Report counts on the 3D globe", () => {
  test.use({ isMobile: false });

  test("Homepage globe markers show report totals (not event counts) and never claim more than 99+", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(1500);
    await page.getByRole("button", { name: "Globe layers" }).first().click();
    await page.getByRole("checkbox").nth(1).click(); // Events layer (off by default)
    const markers = page.getByTestId("globe-marker");
    await expect(markers.first()).toBeAttached({ timeout: 30_000 });
    const rows = await markers.evaluateAll((els) =>
      els.map((el) => ({ reports: Number(el.getAttribute("data-report-count")), text: (el.textContent ?? "").trim() })),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.reports).toBeGreaterThanOrEqual(1);
      expect(row.text).toBe(row.reports > 99 ? "99+" : String(row.reports));
    }
  });
});

test.describe("Report counts on globe conflict hotspots", () => {
  test.use({ isMobile: false });

  test("Every conflict hotspot dot on the default globe shows the summed report count of its events (99+ capped)", async ({ page }) => {
    await page.goto("/");
    const markers = page.getByTestId("globe-conflict-marker");
    await expect(markers.first()).toBeAttached({ timeout: 30_000 });
    const rows = await markers.evaluateAll((els) => els.map((el) => ({ reports: Number(el.getAttribute("data-report-count")), text: (el.textContent ?? "").trim() })));
    expect(rows.length).toBeGreaterThan(5);
    for (const row of rows) expect(row.text).toBe(row.reports === 0 ? "" : row.reports > 99 ? "99+" : String(row.reports));
    expect(rows.some((r) => r.reports > 1)).toBe(true);
  });
});
