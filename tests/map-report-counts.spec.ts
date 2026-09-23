import { test, expect } from "@playwright/test";
import { attributeReports, formatReportCount, uniqueReportCount } from "@/lib/map/report-counts";
import { buildConflictAggregates, buildEventMarkers, markerLabel } from "@/lib/map/intelligence-markers";
import { eventsToGeoJSON } from "@/lib/map/events-to-geojson";
import { clusterEvents } from "@/lib/globe/event-clusters";
import type { ConflictEvent } from "@/lib/types";

// The number on a marker = how many UNIQUE published reports it represents. One canonical aggregation feeds the flat map
// (GeoJSON) and the globe (clusters / conflict markers), so the two can never disagree. Pure: no server, no map.

let n = 0;
function ev(over: Partial<ConflictEvent> & { reports?: string[] }): ConflictEvent {
  n++;
  const { reports, ...rest } = over;
  return {
    id: `e${n}`,
    slug: `e${n}`,
    title: `Event ${n}`,
    summary: "",
    eventType: "airstrike",
    lat: 50,
    lng: 30,
    locationPrecision: "exact",
    locationScope: "point",
    countryCode: "UA",
    region: "Europe",
    conflictId: "c-ukraine",
    occurredAt: new Date(Date.UTC(2026, 8, 1, 0, n)).toISOString(),
    severity: "high",
    importance: 60,
    verificationStatus: "confirmed",
    disputed: false,
    sourceCount: 1,
    sources: [],
    reportIds: reports ?? [`r${n}`],
    timeline: [],
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    ...rest,
  } as unknown as ConflictEvent;
}

test.describe("what a marker's number means", () => {
  test("one report reads 1, several read the exact count, more than 99 reads 99+ (the true number is kept)", () => {
    const one = buildEventMarkers([ev({ reports: ["a"] })])[0]!;
    expect(one.reportCount).toBe(1);
    expect(markerLabel(one.reportCount)).toBe("1");
    const eight = buildEventMarkers([ev({ reports: Array.from({ length: 8 }, (_, i) => `x${i}`) })])[0]!;
    expect(markerLabel(eight.reportCount)).toBe("8");
    const big = buildEventMarkers([ev({ reports: Array.from({ length: 120 }, (_, i) => `y${i}`) })])[0]!;
    expect(big.reportCount).toBe(120);
    expect(markerLabel(big.reportCount)).toBe("99+");
    expect(formatReportCount(99)).toBe("99");
    expect(formatReportCount(100)).toBe("99+");
  });

  test("a report linked to several events is counted once", () => {
    const shared = ["s1", "s2"];
    const a = ev({ reports: ["a1", ...shared] });
    const b = ev({ reports: ["b1", ...shared] });
    const attributed = attributeReports([a, b]);
    expect(attributed.get(a.id)!.reportCount + attributed.get(b.id)!.reportCount).toBe(uniqueReportCount([a, b]));
    expect(uniqueReportCount([a, b])).toBe(4); // a1, b1, s1, s2 - not 6
    const markers = buildEventMarkers([a, b]);
    expect(markers.reduce((sum, m) => sum + m.reportCount, 0)).toBe(4);
    const cluster = clusterEvents([a, b], 5);
    expect(cluster).toHaveLength(1);
    expect(cluster[0]!.reportCount).toBe(4);
  });

  test("the same report reached through several sources or corroboration paths still counts once", () => {
    const e = ev({ reports: ["r1", "r1", "r1", "r2"] });
    expect(buildEventMarkers([e])[0]!.reportCount).toBe(2);
  });

  test("splitting a cluster into finer groups never adds up to more than the parent", () => {
    const events = [ev({ lat: 50, lng: 30, reports: ["a", "b", "shared"] }), ev({ lat: 50.4, lng: 30.4, reports: ["c", "shared"] }), ev({ lat: 55, lng: 40, reports: ["d", "e", "f"] })];
    const coarse = clusterEvents(events, 30);
    const fine = clusterEvents(events, 0.1);
    const total = (cs: { reportCount: number }[]) => cs.reduce((s, c) => s + c.reportCount, 0);
    expect(total(coarse)).toBe(uniqueReportCount(events));
    expect(total(fine)).toBe(total(coarse));
    expect(fine.length).toBeGreaterThan(coarse.length);
  });

  test("flat map and globe read the same canonical count", () => {
    const events = [ev({ reports: ["a", "b", "c"] }), ev({ reports: ["c", "d"] }), ev({ reports: ["e"], lat: -10, lng: 100 })];
    const geo = eventsToGeoJSON(events).features;
    const flatTotal = geo.reduce((s, f) => s + f.properties.reportCount, 0);
    const globeTotal = clusterEvents(events, 0.001).reduce((s, c) => s + c.reportCount, 0);
    expect(flatTotal).toBe(globeTotal);
    expect(flatTotal).toBe(uniqueReportCount(events));
    const byId = new Map(buildEventMarkers(events).map((m) => [m.id, m.reportCount]));
    for (const f of geo) expect(f.properties.reportCount).toBe(byId.get(f.properties.id));
  });
});

test.describe("location scope and the count", () => {
  test("a country-level report is not a point marker but still counts toward its conflict", () => {
    const point = ev({ reports: ["p1", "p2"] });
    const country = ev({ lat: null, lng: null, locationScope: "country", locationPrecision: "country", reports: ["c1"] });
    expect(buildEventMarkers([point, country])).toHaveLength(1);
    expect(eventsToGeoJSON([point, country]).features).toHaveLength(1);
    expect(clusterEvents([point, country], 5)).toHaveLength(1);
    const agg = buildConflictAggregates([point, country]).get("c-ukraine")!;
    expect(agg.reportCount).toBe(3);
    expect(agg.eventCount).toBe(2);
  });

  test("city and region reports are markers that say how far their position is known", () => {
    const city = ev({ locationScope: "city", locationPrecision: "city", reports: ["a"] });
    const region = ev({ locationScope: "region", locationPrecision: "region", reports: ["b"] });
    expect(buildEventMarkers([city, region]).map((m) => m.scope)).toEqual(["city", "region"]);
  });
});

test.describe("filters and time change the count", () => {
  test("counts are a pure function of the events passed in: a narrower time or filter gives a smaller number", () => {
    const early = ev({ reports: ["a", "b"], occurredAt: "2026-09-01T00:00:00Z" });
    const late = ev({ reports: ["c"], occurredAt: "2026-09-20T00:00:00Z", conflictId: "c-sudan" });
    const all = [early, late];
    expect(uniqueReportCount(all)).toBe(3);
    expect(uniqueReportCount(all.filter((e) => e.occurredAt < "2026-09-10"))).toBe(2); // timeline / period
    expect(buildConflictAggregates(all.filter((e) => e.conflictId === "c-sudan")).get("c-sudan")!.reportCount).toBe(1); // conflict filter
    expect(buildConflictAggregates(all.filter((e) => e.conflictId === "c-sudan")).has("c-ukraine")).toBe(false);
  });
});

test.describe("published reports only (API)", () => {
  test("an incoming report is not in the public event feed until it is published", async ({ request }) => {
    const src = await (await request.post("/api/admin/sources", { data: { name: `Counts source ${Date.now()}`, type: "manual", autoProcessing: true } })).json();
    const title = `Unpublished counts probe ${Date.now()}`;
    await request.post("/api/admin/incoming/manual", { data: { sourceId: src.id, originalTitle: title, originalText: "Libya central bank.", originalUrl: "https://news.example-source.test/probe" } });
    const before = (await (await request.get("/api/events")).json()) as { title: string; reportIds?: string[] }[];
    expect(before.some((e) => e.title === title)).toBe(false);
    await request.post("/api/admin/incoming/publish-bulk", { data: { filters: `status=pending&sourceId=${src.id}`, mode: "publish" } });
    const after = (await (await request.get("/api/events")).json()) as { title: string; reportIds?: string[] }[];
    const published = after.find((e) => e.title === title);
    expect(published?.reportIds).toHaveLength(1);
  });
});
