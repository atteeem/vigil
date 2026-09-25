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

  test("several CITY events at one city are ONE city marker with the city's unique reports (no stacked markers)", () => {
    const a = ev({ locationScope: "city", locationPrecision: "city", lat: 50.45, lng: 30.52, reports: ["k1", "k2", "k3", "k4"] });
    const b = ev({ locationScope: "city", locationPrecision: "city", lat: 50.45, lng: 30.52, reports: ["k5"] });
    const c = ev({ locationScope: "city", locationPrecision: "city", lat: 50.45, lng: 30.52, reports: ["k1"] }); // k1 already counted
    const markers = buildEventMarkers([a, b, c]);
    expect(markers).toHaveLength(1);
    expect(markers[0]!.reportCount).toBe(5);
    expect(markers[0]!.eventCount).toBe(3);
    expect(markers[0]!.eventIds).toEqual([a.id, b.id, c.id]);
    const geo = eventsToGeoJSON([a, b, c]).features;
    expect(geo).toHaveLength(1);
    expect(geo[0]!.properties.reportCount).toBe(5);
    expect(geo[0]!.properties.eventCount).toBe(3);
    const globe = clusterEvents([a, b, c], 0.001);
    expect(globe).toHaveLength(1);
    expect(globe[0]!.reportCount).toBe(5);
    expect(globe[0]!.count).toBe(3);
  });

  test("POINT events stay individual markers even at identical coordinates; a region marker never merges with a city one", () => {
    const p1 = ev({ lat: 48, lng: 37, reports: ["p1"] });
    const p2 = ev({ lat: 48, lng: 37, reports: ["p2"] });
    const city = ev({ locationScope: "city", locationPrecision: "city", lat: 48, lng: 37, reports: ["c1"] });
    const region = ev({ locationScope: "region", locationPrecision: "region", lat: 48, lng: 37, reports: ["r1"] });
    expect(buildEventMarkers([p1, p2, city, region]).map((m) => [m.scope, m.reportCount])).toEqual([["point", 1], ["point", 1], ["city", 1], ["region", 1]]);
  });

  test("a country / global / unknown report never becomes a point even if a legacy row carries coordinates", () => {
    for (const scope of ["country", "global", "unknown"]) {
      const legacy = ev({ lat: 49, lng: 32, locationScope: scope, locationPrecision: scope, reports: [`l-${scope}`] });
      expect(buildEventMarkers([legacy])).toEqual([]);
      expect(clusterEvents([legacy], 5)).toEqual([]);
      expect(buildConflictAggregates([legacy]).get("c-ukraine")!.reportCount).toBe(1);
    }
  });

  test("historical reconstruction keeps a country-level event without coordinates (no 0 / NaN point)", async () => {
    const { reconstructEventState } = await import("@/lib/data/event-reconstruction");
    const created = new Date("2026-09-01T00:00:00Z");
    const event = { id: "x", createdAt: created, publishedAt: created, eventType: "airstrike", title: "t", summary: "s", locationName: null, countryCode: "UA", region: "Europe", latitude: null, longitude: null, occurredAt: created, severity: "high", conflictId: null, casualtiesKilled: null, casualtiesInjured: null };
    const state = reconstructEventState(event as never, [], [], new Date("2026-09-02T00:00:00Z"))!;
    expect(state.latitude).toBeNull();
    expect(state.longitude).toBeNull();
  });
});

test.describe("globe marker cap keeps the flat-map attribution", () => {
  test("capping the globe to the newest N markers does not move a shared report onto another marker", () => {
    // Newest first, like the live feed. The shared report "s" belongs to the OLDEST event (earliest attribution).
    const oldest = ev({ reports: ["s", "o"], occurredAt: "2026-09-01T00:00:00Z", lat: 10, lng: 10 });
    const middle = ev({ reports: ["s", "m"], occurredAt: "2026-09-02T00:00:00Z", lat: 20, lng: 20 });
    const newest = ev({ reports: ["n"], occurredAt: "2026-09-03T00:00:00Z", lat: 30, lng: 30 });
    const events = [newest, middle, oldest];
    const flat = new Map(buildEventMarkers(events).map((m) => [m.id, m.reportCount]));
    const capped = clusterEvents(events, 0.001, 2); // oldest is cut from the globe
    expect(capped.map((c) => c.ids[0])).toEqual([newest.id, middle.id]);
    for (const c of capped) expect(c.reportCount).toBe(flat.get(c.ids[0]!));
    expect(capped.find((c) => c.ids[0] === middle.id)!.reportCount).toBe(1); // "m" only; "s" stays with the oldest
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

test.describe("canonical conflict count (API /api/report-counts)", () => {
  test("unique published reports per conflict: unpublished excluded, window / type / region / timeline applied", async ({ request }) => {
    const key = Date.now().toString(36);
    const conflict = await (await request.post("/api/admin/conflicts", { data: { slug: `rc-${key}`, name: `Count Conflict ${key}`, region: "Africa", severity: "guarded", intensity: 30 } })).json();
    const now = Date.now();
    const mk = (title: string, hoursAgo: number, published: boolean, eventType = "airstrike", region = "Africa") =>
      request.post("/api/admin/events", { data: { title: `RCC ${title} ${key}`, summary: "Count probe.", eventType, latitude: 10, longitude: 20, region, conflictId: conflict.id, occurredAt: new Date(now - hoursAgo * 3_600_000).toISOString(), severity: "elevated", published, sourceName: `RCC source ${key}` } });
    for (const r of [await mk("a", 1, true), await mk("b", 2, true, "drone"), await mk("c", 30, true), await mk("draft", 1, false), await mk("elsewhere", 1, true, "airstrike", "Europe")]) expect(r.status()).toBe(201);
    const count = async (qs: string) => ((await (await request.get(`/api/report-counts?${qs}`)).json()) as { conflicts: Record<string, number> }).conflicts[conflict.id] ?? 0;
    expect(await count("window=24H")).toBe(3); // a, b, elsewhere — never the unpublished draft
    expect(await count("window=7D")).toBe(4); // + c (30 h ago)
    expect(await count("window=24H&type=drone")).toBe(1);
    expect(await count("window=24H&region=Africa")).toBe(2);
    // Timeline: before any of these existed the conflict has no reports.
    expect(await count(`window=45D&at=${encodeURIComponent(new Date(now - 86_400_000 * 3).toISOString())}`)).toBe(0);
    expect((await request.get("/api/report-counts?window=2W")).status()).toBe(400);
  });
});
