import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { enableTerritory } from "./helpers/territory";
import { parseUsgsEarthquakes } from "@/lib/hazards/providers/usgs-earthquakes";
import { parseFirmsCsv } from "@/lib/hazards/providers/firms-thermal";
import { parseEonet } from "@/lib/hazards/providers/eonet";
import { parseHansNotices } from "@/lib/hazards/providers/usgs-volcanoes";
import { normalizeCapAlert } from "@/lib/hazards/providers/nws-alerts";
import { parseGdacs } from "@/lib/hazards/providers/gdacs";
import { earthquakeProminence, capProminence, isStaleHazard, quakeRadius, HOMEPAGE_PROMINENCE } from "@/lib/hazards/significance";
import { EVENT_ORIGINS, SEVERITY_DOMAINS } from "@/lib/hazards/types";
import { sourceTrust } from "@/lib/sources/trust";
import { hazardsToSources } from "@/lib/map/hazards-to-geojson";
import type { HazardCollection, HazardDetail } from "@/lib/hazards/public-types";
import { closeWorldControls, openWorldControls } from "./helpers/world-controls";

// Live Global Data Layers v1: structured sensor/official data (earthquakes, thermal detections,
// reported wildfires, volcanoes, official alerts) through ONE generic pipeline, kept apart from news,
// with domain-specific severity, provider revisions, expiry and timeline reconstruction. Provider
// payloads come from local fixtures (lib/testing/hazard-fixtures.ts) served by the test server; one
// test at the end samples the real providers.

const FIXTURE = "http://localhost:3100/api/test-fixtures/hazards";
const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const MIN = 60_000;
// Fixture payloads are pinned to this instant (?t=), so re-polling an unchanged feed is genuinely unchanged.
const T0 = Date.now();

const CLASS: Record<string, string> = { usgs_earthquakes: "scientific_official", nasa_firms: "sensor_provider", eonet_wildfires: "scientific_official", eonet_volcanoes: "scientific_official", usgs_volcanoes: "scientific_official", nws_alerts: "government_alert", gdacs: "humanitarian_monitor" };

const fixtureUrl = (path: string, query: string) => `${FIXTURE}/${path}${query ? `${query}&` : "?"}t=${T0}`;

async function addSource(request: APIRequestContext, provider: string, path: string, query = "") {
  const res = await request.post("/api/admin/sources", { data: { name: `LDL ${provider} ${unique()}`, type: "structured", platform: provider, feedUrl: fixtureUrl(path, query), url: fixtureUrl(path, query), enabled: true, autoIngest: false, autoProcessing: false, independenceClass: CLASS[provider], pollIntervalMinutes: 5 } });
  expect(res.status()).toBe(201);
  return (await res.json()) as { id: string };
}
async function fetchNow(request: APIRequestContext, id: string) {
  return (await request.post(`/api/admin/sources/${id}/fetch`).then((r) => r.json())) as { fetched: number; new: number; errors: number; error?: string };
}
async function ingest(request: APIRequestContext, provider: string, path: string, query = "") {
  const s = await addSource(request, provider, path, query);
  return { source: s, result: await fetchNow(request, s.id) };
}
const hazards = async (request: APIRequestContext, qs: string) => (await request.get(`/api/hazards?${qs}`).then((r) => r.json())) as HazardCollection;
const titles = (c: HazardCollection) => c.features.map((f) => f.properties.title);

test.beforeAll(async () => {
  const { prisma } = await import("@/lib/db/client");
  await prisma.globalEvent.deleteMany({});
  await prisma.globalEventAggregate.deleteMany({});
  await prisma.hazardZone.deleteMany({});
});
test.afterAll(async () => {
  const { prisma } = await import("@/lib/db/client");
  await prisma.globalEvent.deleteMany({});
  await prisma.globalEventAggregate.deleteMany({});
  await prisma.source.deleteMany({ where: { name: { startsWith: "LDL " } } });
});

// ---------------------------------------------------------------------------------------------
test.describe("Vocabulary: origin and domain severity", () => {
  test("structured origins are distinct from conflict news, and hazard scales are their own domains", () => {
    expect(EVENT_ORIGINS).toEqual(expect.arrayContaining(["conflict_news", "official_alert", "sensor", "scientific_observation", "humanitarian", "infrastructure", "other"]));
    expect(SEVERITY_DOMAINS).toEqual(expect.arrayContaining(["earthquake_magnitude", "cap_severity", "fire_radiative_power_mw", "volcano_alert_level"]));
    // A magnitude never becomes a conflict severity: prominence is a per-domain display rank only.
    expect(earthquakeProminence(7.2, 900)).toBeGreaterThan(earthquakeProminence(5, 300));
    expect(earthquakeProminence(2.6, 0)).toBeLessThan(HOMEPAGE_PROMINENCE);
    expect(capProminence("Extreme", "Observed")).toBeGreaterThan(capProminence("Severe", "Likely"));
    expect(quakeRadius(7)).toBeGreaterThan(quakeRadius(4));
  });

  test("measurement providers read as strong verification for their own data only", () => {
    for (const cls of ["scientific_official", "government_alert", "sensor_provider", "humanitarian_monitor"]) {
      const t = sourceTrust({ independenceClass: cls });
      expect(t.label).toBe("Independent / Strong Verification");
      expect(t.authorityScope).toMatch(/not a source on unrelated events/);
      expect(t.countsAsIndependent).toBe(false); // never counts as independent evidence about a conflict
    }
    expect(sourceTrust({ independenceClass: "independent_high" }).authorityScope).toBeNull();
  });

  test("staleness: records the provider has not touched are never current", () => {
    const now = Date.now();
    expect(isStaleHazard("volcano", new Date(now - 200 * 86_400_000), now)).toBe(true);
    expect(isStaleHazard("volcano", new Date(now - 2 * 86_400_000), now)).toBe(false);
    expect(isStaleHazard("confirmed_wildfire", new Date(now - 30 * 86_400_000), now)).toBe(true);
    expect(isStaleHazard("earthquake", new Date(now - 30 * 86_400_000), now)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
test.describe("Provider normalisers", () => {
  test("USGS: magnitude, depth, tsunami flag, significance, URL and solution status are retained; non-earthquakes are dropped", () => {
    const events = parseUsgsEarthquakes({ features: [
      { id: "us1", geometry: { type: "Point", coordinates: [10, 20, 33.5] }, properties: { mag: 5.4, place: "somewhere", time: 1_700_000_000_000, updated: 1_700_000_500_000, url: "https://earthquake.usgs.gov/earthquakes/eventpage/us1", tsunami: 1, sig: 450, status: "reviewed", magType: "mww", type: "earthquake", alert: "green" } },
      { id: "bl", geometry: { type: "Point", coordinates: [1, 1, 0] }, properties: { mag: 2.5, time: 1, updated: 1, type: "explosion" } },
    ] });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ providerEventId: "us1", origin: "scientific_observation", severityValue: 5.4, severityLabel: "M5.4", confidenceLabel: "Reviewed solution", sourceUrl: "https://earthquake.usgs.gov/earthquakes/eventpage/us1" });
    expect(events[0]!.metadata).toMatchObject({ depthKm: 33.5, tsunami: true, significance: 450, pagerAlert: "green" });
  });

  test("FIRMS: detections are thermal anomalies, low confidence is dropped, provider confidence and FRP are kept verbatim", () => {
    const csv = ["latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,confidence,version,bright_ti5,frp,daynight", "-32.9,18.7,302.2,0.41,0.37,2026-09-19,0003,N20,nominal,2.0NRT,287.0,0.8,N", "10,10,330,0.4,0.4,2026-09-19,1310,N20,high,2.0NRT,290,42.5,D", "5,5,300,0.4,0.4,2026-09-19,1310,N20,low,2.0NRT,280,0.3,D"].join("\n");
    const rows = parseFirmsCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.category === "thermal_detection" && r.origin === "sensor")).toBe(true);
    expect(rows.some((r) => (r.category as string) === "confirmed_wildfire")).toBe(false);
    expect(rows[1]).toMatchObject({ confidenceLabel: "high", severityValue: 42.5, observedAt: new Date("2026-09-19T13:10:00Z") });
    expect(rows[0]!.description).toContain("not necessarily a confirmed wildfire");
    expect(rows[0]!.title).not.toMatch(/wildfire/i);
    // Volume bound: the strongest detections survive a cap.
    expect(parseFirmsCsv(csv, 1)[0]!.severityValue).toBe(42.5);
  });

  test("EONET: reported wildfire incidents are confirmed_wildfire (a different category from detections); volcano activity reports carry no alert level", () => {
    const ev = (cat: string, id: string, date: string) => ({ id, title: `${cat} ${id}`, closed: null, categories: [{ id: cat }], sources: [{ id: "SRC", url: `https://src.test/${id}` }], geometry: [{ date, type: "Point", coordinates: [1, 2], magnitudeValue: 500, magnitudeUnit: "acres" }] });
    const fires = parseEonet({ events: [ev("wildfires", "W1", "2026-09-10T00:00:00Z")] }, "wildfires");
    expect(fires[0]).toMatchObject({ category: "confirmed_wildfire", origin: "official_alert", severityDomain: "wildfire_area_acres", severityValue: 500, sourceUrl: "https://src.test/W1" });
    const volcanoes = parseEonet({ events: [ev("volcanoes", "V1", "2026-06-01T00:00:00Z")] }, "volcanoes");
    expect(volcanoes[0]).toMatchObject({ category: "volcano", subtype: "activity_report", severityLabel: null });
  });

  test("HANS: alert level, colour code and observatory are kept; unlocated volcanoes are reported, not invented", () => {
    const notices = [{ obs_fullname: "AVO", obs_abbr: "avo", volcano_name: "Alpha", vnum: "1", sent_unixtime: 1_700_000_000, color_code: "ORANGE", alert_level: "WATCH", notice_url: "https://volcanoes.usgs.gov/n/1" }, { obs_fullname: "AVO", obs_abbr: "avo", volcano_name: "Beta", vnum: "2", sent_unixtime: 1_700_000_000, color_code: "YELLOW", alert_level: "ADVISORY" }];
    const { events, unlocated } = parseHansNotices(notices, (v) => (v === "1" ? { latitude: 52, longitude: -176 } : null));
    expect(unlocated).toEqual(["2"]);
    expect(events[0]).toMatchObject({ severityLabel: "WATCH", origin: "official_alert", sourceUrl: "https://volcanoes.usgs.gov/n/1" });
    expect(events[0]!.metadata).toMatchObject({ colorCode: "ORANGE", observatory: "AVO" });
  });

  test("CAP: authority, severity, certainty, urgency, effective/expiry, geometry and original URL are retained", () => {
    const geom: GeoJSON.Polygon = { type: "Polygon", coordinates: [[[-98, 30], [-97, 30], [-97, 31], [-98, 31], [-98, 30]]] };
    const ev = normalizeCapAlert({ geometry: geom, properties: { id: "urn:x", "@id": "https://api.weather.gov/alerts/urn:x", event: "Flood Warning", severity: "Severe", certainty: "Likely", urgency: "Expected", senderName: "NWS Austin", sent: "2026-09-20T10:00:00Z", effective: "2026-09-20T10:05:00Z", expires: "2026-09-20T14:00:00Z", areaDesc: "Travis, TX" } }, geom)!;
    expect(ev).toMatchObject({ origin: "official_alert", severityDomain: "cap_severity", severityLabel: "Severe", confidenceLabel: "Likely", sourceUrl: "https://api.weather.gov/alerts/urn:x", locationPrecision: "area_level" });
    expect(ev.expiresAt).toEqual(new Date("2026-09-20T14:00:00Z"));
    expect(ev.metadata).toMatchObject({ issuingAuthority: "NWS Austin", urgency: "Expected", certainty: "Likely", standard: "CAP" });
    expect(ev.geometry?.type).toBe("Polygon");
  });

  test("GDACS: cyclones and floods only, alert level kept as its own domain; non-current events are skipped", () => {
    const f = (type: string, level: string, current = "true") => ({ geometry: { type: "Point", coordinates: [1, 2] }, properties: { eventtype: type, eventid: 1, name: type, alertlevel: level, iscurrent: current, fromdate: "2026-09-19T00:00:00", datemodified: "2026-09-20T00:00:00", url: { report: "https://www.gdacs.org/r" } } });
    const events = parseGdacs({ features: [f("TC", "Red"), f("FL", "Green"), f("EQ", "Green"), f("TC", "Orange", "false")] });
    expect(events.map((e) => [e.category, e.severityLabel])).toEqual([["cyclone", "Red alert"], ["flood", "Green alert"]]);
    expect(events[0]).toMatchObject({ origin: "humanitarian", severityDomain: "gdacs_alert_level", sourceUrl: "https://www.gdacs.org/r" });
  });
});

// ---------------------------------------------------------------------------------------------
test.describe.serial("Ingestion architecture and layers (fixture providers)", () => {
  test("earthquakes: idempotent by provider event id; magnitude, depth and original URL kept; non-earthquakes excluded", async ({ request }) => {
    const { source, result } = await ingest(request, "usgs_earthquakes", "usgs");
    expect(result).toMatchObject({ errors: 0, new: 4 });
    expect((await fetchNow(request, source.id)).new).toBe(0); // same feed again: nothing new
    const again = await ingest(request, "usgs_earthquakes", "usgs"); // another source, same provider ids
    expect(again.result.new).toBe(0);
    const { prisma } = await import("@/lib/db/client");
    expect(await prisma.globalEvent.count({ where: { provider: "usgs_earthquakes" } })).toBe(4);
    const big = await prisma.globalEvent.findUniqueOrThrow({ where: { provider_providerEventId: { provider: "usgs_earthquakes", providerEventId: "fx-usgs-big" } } });
    expect(big).toMatchObject({ severityValue: 6.4, origin: "scientific_observation", layer: "earthquakes", severityDomain: "earthquake_magnitude", sourceUrl: "https://earthquake.usgs.gov/earthquakes/eventpage/fx-usgs-big", revision: 1 });
    expect(JSON.parse(big.metadata!)).toMatchObject({ depthKm: 18, tsunami: false });
    // The structured provider's Source carries the strong-verification classification.
    const detail = (await request.get(`/api/hazards/${big.id}`).then((r) => r.json())) as HazardDetail;
    expect(detail.trust?.label).toBe("Independent / Strong Verification");
    expect(detail.originLabel).toBe("Scientific observation");
    expect(detail.sourceUrl).toBe("https://earthquake.usgs.gov/earthquakes/eventpage/fx-usgs-big");
  });

  test("thermal detections: stored as thermal_detection (never wildfire), low confidence dropped, provider confidence retained", async ({ request }) => {
    const { result } = await ingest(request, "nasa_firms", "firms");
    expect(result).toMatchObject({ errors: 0, new: 62 });
    const { prisma } = await import("@/lib/db/client");
    const rows = await prisma.globalEvent.findMany({ where: { provider: "nasa_firms" } });
    expect(rows.every((r) => r.category === "thermal_detection" && r.origin === "sensor" && r.layer === "fires")).toBe(true);
    expect(rows.some((r) => r.category === "confirmed_wildfire")).toBe(false);
    expect(new Set(rows.map((r) => r.confidenceLabel))).toEqual(new Set(["high", "nominal"]));
  });

  test("reported wildfires are a separate category; a wildfire not updated for weeks is not shown as current", async ({ request }) => {
    await ingest(request, "eonet_wildfires", "eonet-wildfires");
    const c = await hazards(request, "layers=fires&zoom=9&bbox=-125,30,-100,45");
    const wild = c.features.filter((f) => f.properties.kind === "confirmed_wildfire");
    expect(wild.map((f) => f.properties.title)).toEqual(["Wildfire Fixture Ridge, Testland"]);
    expect(wild[0]!.properties.label).toBe("620 acres");
  });

  test("thermal aggregation: dense detections aggregate at broad zoom and are individual at high zoom", async ({ request }) => {
    const wide = await hazards(request, "layers=fires&zoom=2");
    const thermalWide = wide.features.filter((f) => f.properties.kind === "thermal_cluster");
    expect(thermalWide.length).toBeGreaterThan(0);
    expect(thermalWide.length).toBeLessThan(10); // 62 detections collapse to a handful of cells
    expect(thermalWide.reduce((n, f) => n + (f.properties.count ?? 0), 0)).toBe(62);
    expect(Math.max(...thermalWide.map((f) => f.properties.count ?? 0))).toBe(60);
    const near = await hazards(request, "layers=fires&zoom=9&bbox=-118.5,33.5,-117.5,34.5");
    const individual = near.features.filter((f) => f.properties.kind === "thermal_detection");
    expect(individual).toHaveLength(60);
    expect(individual[0]!.properties).toMatchObject({ unconfirmed: true });
    expect(individual.some((f) => f.properties.confidence === "high")).toBe(true);
  });

  test("weather: CAP fields kept; zone-referenced alerts get area geometry; minor alerts are not mapped", async ({ request }) => {
    const { result } = await ingest(request, "nws_alerts", "nws/alerts");
    expect(result.errors).toBe(0);
    const c = await hazards(request, "layers=weather&zoom=6&bbox=-110,25,-90,40");
    const t = titles(c);
    expect(t).toEqual(expect.arrayContaining(["Flood Warning", "Severe Thunderstorm Warning", "Tornado Warning"]));
    expect(t).not.toContain("Frost Advisory"); // Minor
    const zoned = c.features.find((f) => f.properties.title === "Severe Thunderstorm Warning")!;
    expect(["Polygon", "MultiPolygon"]).toContain(zoned.geometry.type); // built from the referenced zone (the alert itself carried no geometry)
    const zoneDetail = (await request.get(`/api/hazards/${zoned.properties.id}`).then((r) => r.json())) as HazardDetail;
    expect(zoneDetail.lat).toBeGreaterThan(33);
    expect(zoneDetail.lat).toBeLessThan(33.6);
    expect(zoneDetail.locationPrecision).toBe("area_level");
    const flood = c.features.find((f) => f.properties.title === "Flood Warning")!;
    expect(flood.geometry.type).toBe("Polygon");
    const detail = (await request.get(`/api/hazards/${flood.properties.id}`).then((r) => r.json())) as HazardDetail;
    expect(detail.metadata).toMatchObject({ issuingAuthority: "NWS Fixture TX", severity: "Severe", certainty: "Likely", urgency: "Expected" });
    expect(detail.severity.domain).toBe("cap_severity");
    expect(detail.sourceUrl).toBe("https://api.weather.gov/alerts/urn:fx:flood-1");
    expect(detail.trust?.label).toBe("Independent / Strong Verification");
  });

  test("weather expiry: an alert leaves the active set after its expiry time, on the timeline", async ({ request }) => {
    const now = Date.now();
    const live = await hazards(request, "layers=weather&zoom=6");
    expect(titles(live)).toContain("Tornado Warning"); // expires in 45 min
    const later = await hazards(request, `layers=weather&zoom=6&at=${encodeURIComponent(new Date(now + 60 * MIN).toISOString())}`);
    expect(titles(later)).not.toContain("Tornado Warning");
    expect(titles(later)).toContain("Flood Warning"); // still in force at +60 min
    const muchLater = await hazards(request, `layers=weather&zoom=6&at=${encodeURIComponent(new Date(now + 5 * 3_600_000).toISOString())}`);
    expect(muchLater.features).toHaveLength(0);
    const before = await hazards(request, `layers=weather&zoom=6&at=${encodeURIComponent(new Date(now - 60 * MIN).toISOString())}`);
    expect(before.features).toHaveLength(0); // issued 20 min ago: not yet known an hour earlier
  });

  test("cyclones and floods: GDACS alert levels kept as their own domain", async ({ request }) => {
    await ingest(request, "gdacs", "gdacs");
    const c = await hazards(request, "layers=weather&zoom=2");
    const tc = c.features.find((f) => f.properties.kind === "cyclone")!;
    expect(tc.properties).toMatchObject({ label: "Orange alert", value: 2 });
    const detail = (await request.get(`/api/hazards/${tc.properties.id}`).then((r) => r.json())) as HazardDetail;
    expect(detail.originLabel).toBe("Humanitarian monitor");
    expect(detail.severity.domain).toBe("gdacs_alert_level");
  });

  test("volcanoes: alert level retained; stale activity reports are flagged, not presented as current", async ({ request }) => {
    await ingest(request, "usgs_volcanoes", "hans/getElevatedVolcanoes");
    await ingest(request, "eonet_volcanoes", "eonet-volcanoes");
    const c = await hazards(request, "layers=volcanoes&zoom=2");
    const peak = c.features.find((f) => f.properties.title.startsWith("Fixture Peak"))!;
    expect(peak.properties).toMatchObject({ label: "WATCH", stale: false });
    const fresh = c.features.find((f) => f.properties.title === "Fixture Volcano, Testland")!;
    expect(fresh.properties.stale).toBe(false);
    const stale = c.features.find((f) => f.properties.title === "Dormant Fixture Volcano, Testland")!;
    expect(stale.properties.stale).toBe(true);
    const detail = (await request.get(`/api/hazards/${stale.properties.id}`).then((r) => r.json())) as HazardDetail;
    expect(detail.status).toBe("stale");
    expect(detail.severity.label).toBeNull(); // no alert level is invented for an old activity report
    const peakDetail = (await request.get(`/api/hazards/${peak.properties.id}`).then((r) => r.json())) as HazardDetail;
    expect(peakDetail.metadata).toMatchObject({ alertLevel: "WATCH", colorCode: "ORANGE", observatory: "Fixture Volcano Observatory" });
  });

  test("timeline: earthquakes appear only after their observed time and use the same asOf as everything else", async ({ request }) => {
    const now = Date.now();
    const at = (ms: number) => encodeURIComponent(new Date(ms).toISOString());
    const live = titles(await hazards(request, "layers=earthquakes&zoom=2"));
    expect(live.filter((t) => t.startsWith("M")).length).toBe(4);
    const day = await hazards(request, `layers=earthquakes&zoom=2&at=${at(now - 24 * 3_600_000)}`);
    expect(day.features.map((f) => f.properties.label)).toEqual(["M5.1"]); // only the 26-hour-old quake had happened
    const hourAgo = await hazards(request, `layers=earthquakes&zoom=2&at=${at(now - 60 * MIN)}`);
    expect(hourAgo.features.map((f) => f.properties.label).sort()).toEqual(["M2.8", "M4.3", "M5.1"]); // the M6.4 (24 min ago) had not happened yet
    const bigId = (await hazards(request, "layers=earthquakes")).features.find((f) => f.properties.label === "M6.4")!.properties.id;
    expect((await request.get(`/api/hazards/${bigId}?at=${at(now - 60 * MIN)}`)).status()).toBe(404); // not yet observed at that time
  });

  test("provider revision: the same event updates in place, keeps its history, and reconstructs as it was", async ({ request }) => {
    const { source, result } = await ingest(request, "usgs_earthquakes", "usgs", "?v=2");
    expect(result).toMatchObject({ errors: 0, new: 0 }); // revised events are not new
    expect((await fetchNow(request, source.id)).new).toBe(0);
    const { prisma } = await import("@/lib/db/client");
    const big = await prisma.globalEvent.findUniqueOrThrow({ where: { provider_providerEventId: { provider: "usgs_earthquakes", providerEventId: "fx-usgs-big" } } });
    expect(big).toMatchObject({ severityValue: 6.6, revision: 2, confidenceLabel: "Reviewed solution" });
    expect(await prisma.globalEvent.count({ where: { provider: "usgs_earthquakes" } })).toBe(4);
    expect(await prisma.globalEventRevision.count({ where: { globalEventId: big.id } })).toBe(2);
    const live = (await request.get(`/api/hazards/${big.id}`).then((r) => r.json())) as HazardDetail;
    expect(live).toMatchObject({ revision: 2, revisionCount: 2 });
    expect(live.severity.label).toBe("M6.6");
    expect(live.metadata).toMatchObject({ tsunami: true });
    // Between the two provider solutions the first one was current.
    const revs = await prisma.globalEventRevision.findMany({ where: { globalEventId: big.id }, orderBy: { revision: "asc" } });
    const mid = new Date((revs[0]!.providerUpdatedAt!.getTime() + revs[1]!.providerUpdatedAt!.getTime()) / 2);
    const then = (await request.get(`/api/hazards/${big.id}?at=${encodeURIComponent(mid.toISOString())}`).then((r) => r.json())) as HazardDetail;
    expect(then.severity.label).toBe("M6.4");
    expect(then.revision).toBe(1);
    expect(then.metadata).toMatchObject({ tsunami: false });
  });

  test("withdrawal: an alert dropped from the provider's complete feed ends, but stays reconstructable before that", async ({ request }) => {
    await ingest(request, "nws_alerts", "nws/alerts", "?v=2"); // tornado warning no longer listed
    const live = await hazards(request, "layers=weather&zoom=6");
    expect(titles(live)).not.toContain("Tornado Warning");
    expect(titles(live)).toContain("Flood Warning");
    const before = await hazards(request, `layers=weather&zoom=6&at=${encodeURIComponent(new Date(Date.now() - 2 * MIN).toISOString())}`);
    expect(titles(before)).toContain("Tornado Warning");
    // ...and the flood warning's revised (shorter) expiry applies.
    const flood = live.features.find((f) => f.properties.title === "Flood Warning")!;
    const detail = (await request.get(`/api/hazards/${flood.properties.id}`).then((r) => r.json())) as HazardDetail;
    expect(detail.revision).toBe(2);
  });

  test("volcano returning to normal: dropped from the elevated list, its record ends", async ({ request }) => {
    await ingest(request, "usgs_volcanoes", "hans/getElevatedVolcanoes", "?v=2");
    const c = await hazards(request, "layers=volcanoes&zoom=2");
    expect(titles(c).some((t) => t.startsWith("Fixture Cone"))).toBe(false);
    const peak = c.features.find((f) => f.properties.title.startsWith("Fixture Peak"))!;
    expect(peak.properties.label).toBe("WARNING");
  });

  test("retention: old thermal detections leave the hot table but survive as daily grid aggregates", async ({ request }) => {
    const { prisma } = await import("@/lib/db/client");
    const { runHazardRetention } = await import("@/lib/hazards/store");
    const old = new Date(Date.now() - 10 * 86_400_000);
    await prisma.globalEvent.createMany({
      data: [1, 2, 3].map((i) => ({ origin: "sensor", category: "thermal_detection", layer: "fires", provider: "nasa_firms", providerEventId: `old-${i}-${unique()}`, title: "Thermal anomaly", severityValue: 10 * i, prominence: 10 * i, lat: 5.1 + i * 0.01, lng: 6.1, minLat: 5.1, maxLat: 5.1, minLng: 6.1, maxLng: 6.1, observedAt: old, contentHash: "x" })),
    });
    const r = await runHazardRetention();
    expect(r.archivedRows).toBeGreaterThanOrEqual(3);
    expect(await prisma.globalEvent.count({ where: { category: "thermal_detection", observedAt: { lt: new Date(Date.now() - 7 * 86_400_000) } } })).toBe(0);
    const agg = await prisma.globalEventAggregate.findFirstOrThrow({ where: { day: old.toISOString().slice(0, 10), count: { gte: 3 } } });
    expect(agg.maxIntensity).toBe(30);
    // The timeline still reconstructs that day, as aggregates.
    const c = await hazards(request, `layers=fires&zoom=3&at=${encodeURIComponent(old.toISOString())}`);
    expect(c.features.some((f) => f.properties.kind === "thermal_cluster" && (f.properties.count ?? 0) >= 3)).toBe(true);
  });

  test("source health: a provider failure is isolated, recorded, and honours Retry-After", async ({ request }) => {
    const failing = await addSource(request, "usgs_earthquakes", "usgs", "?status=429&retryAfter=3600");
    const healthy = await addSource(request, "gdacs", "gdacs");
    const bad = await fetchNow(request, failing.id);
    expect(bad.errors).toBe(1);
    expect(bad.error).toMatch(/429/);
    expect((await fetchNow(request, healthy.id)).errors).toBe(0);
    const { prisma } = await import("@/lib/db/client");
    const row = await prisma.source.findUniqueOrThrow({ where: { id: failing.id } });
    expect(row.consecutiveFailures).toBe(1);
    expect(row.lastError).toMatch(/429/);
    expect(row.nextPollAt!.getTime()).toBeGreaterThan(Date.now() + 55 * MIN); // Retry-After 3600s floors the backoff
    const ok = await prisma.source.findUniqueOrThrow({ where: { id: healthy.id } });
    expect(ok.consecutiveFailures).toBe(0);
    expect(ok.lastSuccessfulIngestion).not.toBeNull();
  });

  test("news pipeline untouched: structured sources create no raw news items, and conflict events keep their origin", async ({ request }) => {
    const { prisma } = await import("@/lib/db/client");
    const src = await prisma.source.findFirstOrThrow({ where: { name: { startsWith: "LDL usgs_earthquakes" }, type: "structured" } });
    expect(await prisma.rawIngestionItem.count({ where: { sourceId: src.id } })).toBe(0);
    const created = await request.post("/api/admin/events", { data: { title: `LDL conflict ${unique()}`, summary: "Report.", eventType: "artillery", latitude: 1, longitude: 1, occurredAt: new Date().toISOString(), severity: "elevated", published: false, sourceName: "LDL" } });
    expect(created.status()).toBe(201);
    const ev = await prisma.event.findFirstOrThrow({ where: { title: { startsWith: "LDL conflict" } } });
    expect(ev.origin).toBe("conflict_news");
    await prisma.event.deleteMany({ where: { title: { startsWith: "LDL conflict" } } });
  });
});

// ---------------------------------------------------------------------------------------------
test.describe.serial("Search, homepage and detail pages", () => {
  test.beforeAll(async ({ request }) => {
    const { prisma } = await import("@/lib/db/client");
    await prisma.globalEvent.deleteMany({});
    await ingest(request, "usgs_earthquakes", "usgs");
    await ingest(request, "nasa_firms", "firms");
    await ingest(request, "gdacs", "gdacs");
    await ingest(request, "usgs_volcanoes", "hans/getElevatedVolcanoes");
  });

  test("search finds major earthquakes and named volcanoes but never thermal detections", async ({ request }) => {
    const search = async (q: string) => (await request.get(`/api/public/search?q=${encodeURIComponent(q)}`).then((r) => r.json())) as { type: string; title: string; href: string }[];
    const quake = (await search("Fixtureland")).filter((r) => r.type === "hazard");
    expect(quake.map((r) => r.title)).toContain("M6.4 Earthquake");
    expect(quake.map((r) => r.title)).not.toContain("M2.8 Earthquake"); // minor observations are not search noise
    const volcano = (await search("Fixture Peak")).filter((r) => r.type === "hazard");
    expect(volcano[0]!.title).toMatch(/^Fixture Peak/);
    expect((await search("Thermal")).filter((r) => r.type === "hazard")).toHaveLength(0);
    expect((await search("anomaly")).filter((r) => r.type === "hazard")).toHaveLength(0);
  });

  test("homepage global events list only significant events, never routine observations", async ({ request, page }) => {
    const list = (await request.get("/api/public/global-events").then((r) => r.json())) as { title: string; category: string }[];
    const names = list.map((h) => h.title);
    expect(names).toContain("M6.4 Earthquake");
    expect(names).toContain("Tropical Cyclone FIXTURE-26");
    expect(names).not.toContain("M4.3 Earthquake");
    expect(list.some((h) => h.category === "thermal_detection" || h.category === "flood")).toBe(false);
    await page.goto("/");
    await expect(page.locator('[data-testid="global-events"]:visible').first()).toBeVisible();
    await expect(page.locator('[data-testid="global-event"]:visible').first()).toBeVisible();
  });

  test("earthquake detail page shows depth, tsunami, provider, times and the original link", async ({ page, request }) => {
    const c = await hazards(request, "layers=earthquakes&zoom=2");
    const big = c.features.find((f) => f.properties.label === "M6.4")!;
    await page.goto(`/hazard/${big.properties.id}`);
    await expect(page.getByTestId("hazard-title")).toHaveText("M6.4 Earthquake");
    await expect(page.getByTestId("hazard-origin")).toHaveText("Scientific observation");
    await expect(page.getByTestId("fact-depth")).toContainText("18 km");
    await expect(page.getByTestId("fact-tsunami")).toContainText("No");
    await expect(page.getByTestId("fact-provider")).toContainText("USGS");
    await expect(page.getByTestId("fact-updated")).toBeVisible();
    await expect(page.getByTestId("hazard-source-link")).toHaveAttribute("href", "https://earthquake.usgs.gov/earthquakes/eventpage/fx-usgs-big");
    await expect(page.getByTestId("hazard-trust")).toContainText("Independent / Strong Verification");
  });

  test("thermal detection detail says it is not necessarily a confirmed wildfire", async ({ page, request }) => {
    const c = await hazards(request, "layers=fires&zoom=9&bbox=-118.5,33.5,-117.5,34.5");
    const one = c.features.find((f) => f.properties.kind === "thermal_detection")!;
    await page.goto(`/hazard/${one.properties.id}`);
    await expect(page.getByTestId("hazard-title")).toHaveText("Thermal anomaly");
    await expect(page.getByTestId("hazard-caveat")).toContainText("not necessarily a confirmed wildfire");
    await expect(page.getByTestId("fact-satellite")).toContainText("NOAA-20");
    await expect(page.getByTestId("fact-confidence")).toBeVisible();
    await expect(page.getByTestId("hazard-origin")).toHaveText("Sensor / satellite detection");
  });
});

// ---------------------------------------------------------------------------------------------
type MapHandle = { project: (p: [number, number]) => { x: number; y: number }; jumpTo: (o: unknown) => void; getZoom: () => number; getLayoutProperty: (l: string, p: string) => unknown; querySourceFeatures: (s: string) => { properties: Record<string, unknown> }[]; queryRenderedFeatures: (o?: unknown) => { properties: Record<string, unknown> }[]; getCanvas: () => HTMLCanvasElement };

async function openWorld(page: Page) {
  await page.goto("/world");
  await page.waitForFunction(() => Boolean((window as unknown as { __vigilMap?: unknown }).__vigilMap));
}
async function enableLayer(page: Page, layer: string) {
  await openWorldControls(page, "layers");
  await page.getByTestId("hazard-layers-button").click();
  await page.getByTestId(`hazard-toggle-${layer}`).check();
  await page.getByTestId("hazard-layers-button").click(); // collapse again
  await closeWorldControls(page);
}
const mapEval = <T,>(page: Page, fn: (m: MapHandle) => T) => page.evaluate(`(${fn.toString()})(window.__vigilMap)`) as Promise<T>;

test.describe.serial("World map UI", () => {
  test.beforeAll(async ({ request }) => {
    const { prisma } = await import("@/lib/db/client");
    await prisma.globalEvent.deleteMany({});
    await ingest(request, "usgs_earthquakes", "usgs");
    await ingest(request, "nasa_firms", "firms");
    await ingest(request, "nws_alerts", "nws/alerts");
    await ingest(request, "usgs_volcanoes", "hans/getElevatedVolcanoes");
  });

  test("layer toggles are independent, off by default, remembered, and leave conflict layers alone", async ({ page }) => {
    await openWorld(page);
    await expect(page.locator("[data-hazard-layers]").first()).toHaveAttribute("data-hazard-layers", "");
    await openWorldControls(page, "layers");
    await expect(page.getByTestId("hazard-layers-button")).toBeVisible();
    await page.getByTestId("hazard-layers-button").click();
    await expect(page.getByTestId("hazard-layer-list")).toBeVisible();
    for (const l of ["earthquakes", "fires", "weather", "volcanoes"]) await expect(page.getByTestId(`hazard-toggle-${l}`)).not.toBeChecked();
    await page.getByTestId("hazard-toggle-earthquakes").check();
    await expect(page.locator("[data-hazard-layers]").first()).toHaveAttribute("data-hazard-layers", "earthquakes");
    await page.getByTestId("hazard-toggle-weather").check();
    await expect(page.locator("[data-hazard-layers]").first()).toHaveAttribute("data-hazard-layers", "earthquakes,weather");
    await page.getByTestId("hazard-toggle-earthquakes").uncheck();
    await expect(page.locator("[data-hazard-layers]").first()).toHaveAttribute("data-hazard-layers", "weather");
    // Independent of the conflict controls: Territorial Control and Heatmap behave as before.
    await enableTerritory(page);
    await openWorldControls(page, "layers");
    await page.getByRole("button", { name: "Heatmap" }).click();
    await expect(page.getByRole("button", { name: "Heatmap" })).toHaveAttribute("aria-pressed", "true");
    if (!(await page.getByTestId("hazard-toggle-weather").isVisible())) await page.getByTestId("hazard-layers-button").click();
    await expect(page.getByTestId("hazard-toggle-weather")).toBeChecked();
    // Remembered across a reload.
    await page.reload();
    await page.waitForFunction(() => Boolean((window as unknown as { __vigilMap?: unknown }).__vigilMap));
    await expect(page.locator("[data-hazard-layers]").first()).toHaveAttribute("data-hazard-layers", "weather");
  });

  test("hazard layers do not change the conflict heat surface", async ({ page }) => {
    await openWorld(page);
    await page.getByRole("button", { name: "Heatmap" }).click();
    const signature = () => page.locator("[data-heat-signature]").first().getAttribute("data-heat-signature");
    await expect.poll(signature).toBeTruthy();
    const before = await signature();
    for (const l of ["earthquakes", "fires", "weather", "volcanoes"]) await enableLayer(page, l);
    await expect.poll(() => page.locator("[data-hazard-count]").first().getAttribute("data-hazard-count")).not.toBe("0");
    expect(await signature()).toBe(before);
  });

  test("earthquake markers render: clustered when zoomed out, individual (ring sized by magnitude) when zoomed in", async ({ page }) => {
    await openWorld(page);
    await enableLayer(page, "earthquakes");
    await expect.poll(() => mapEval(page, (m) => m.querySourceFeatures("hz-quakes").length)).toBeGreaterThan(0);
    await expect.poll(() => mapEval(page, (m) => m.getLayoutProperty("hz-quake-circle", "visibility"))).toBe("visible");
    // World view: the three nearby quakes in the Pacific fall into a cluster, not three rings.
    await mapEval(page, (m) => m.jumpTo({ center: [135, 0], zoom: 1.6 })); // the Pacific quakes in view
    await expect.poll(() => mapEval(page, (m) => m.queryRenderedFeatures({ layers: ["hz-quake-cluster"] }).length)).toBeGreaterThan(0);
    await mapEval(page, (m) => m.jumpTo({ center: [145.1, -6.2], zoom: 8 }));
    await expect.poll(() => mapEval(page, (m) => m.queryRenderedFeatures({ layers: ["hz-quake-circle"] }).map((f) => f.properties.label))).toContain("M6.4");
  });

  test("clicking a hazard marker opens its details panel; the conflict marker path is unaffected", async ({ page }) => {
    await openWorld(page);
    await enableLayer(page, "earthquakes");
    // Bring the quake below the floating control cards (they cover the top of the map, most of it on a phone).
    await mapEval(page, (m) => { m.jumpTo({ center: [145.1, -6.2], zoom: 8 }); (m as unknown as { panBy: (o: number[], opts: unknown) => void }).panBy([0, -250], { duration: 0 }); });
    await expect.poll(() => mapEval(page, (m) => m.queryRenderedFeatures({ layers: ["hz-quake-circle"] }).length)).toBeGreaterThan(0);
    const pt = await page.evaluate(`(() => { const m = window.__vigilMap; const p = m.project([145.1, -6.2]); const r = m.getCanvas().getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; })()`) as { x: number; y: number };
    await page.mouse.click(pt.x, pt.y);
    const detail = page.locator('[data-testid="hazard-detail"]:visible');
    await expect(detail.getByTestId("hazard-title")).toHaveText("M6.4 Earthquake");
    await expect(detail.getByTestId("fact-depth")).toContainText("18 km");
    await expect(detail.getByTestId("hazard-source-link")).toHaveAttribute("href", /earthquake\.usgs\.gov/);
  });

  test("thermal detections aggregate when zoomed out and become individual detections when zoomed in", async ({ page }) => {
    await openWorld(page);
    await enableLayer(page, "fires");
    await expect.poll(() => mapEval(page, (m) => m.querySourceFeatures("hz-thermal").length)).toBeGreaterThan(0);
    const wide = await mapEval(page, (m) => m.querySourceFeatures("hz-thermal").map((f) => f.properties.kind));
    expect(new Set(wide)).toEqual(new Set(["thermal_cluster"]));
    await mapEval(page, (m) => m.jumpTo({ center: [-118.0, 34.0], zoom: 9 }));
    await expect.poll(() => mapEval(page, (m) => m.querySourceFeatures("hz-thermal").filter((f) => f.properties.kind === "thermal_detection").length)).toBeGreaterThan(30);
  });

  test("weather alert areas render as area geometry", async ({ page }) => {
    await openWorld(page);
    await enableLayer(page, "weather");
    await mapEval(page, (m) => m.jumpTo({ center: [-97.5, 30.5], zoom: 6 }));
    await expect.poll(() => mapEval(page, (m) => m.querySourceFeatures("hz-weather").filter((f) => f.properties.kind === "weather_alert").length)).toBeGreaterThan(0);
    await expect.poll(() => mapEval(page, (m) => m.getLayoutProperty("hz-weather-fill", "visibility"))).toBe("visible");
  });

  test("the timeline controls hazards: an earlier time hides quakes that had not happened yet; Return to Live restores them", async ({ page }) => {
    await openWorld(page);
    await mapEval(page, (m) => m.jumpTo({ center: [135, 0], zoom: 1.6 })); // the API only returns what is in the viewport
    await enableLayer(page, "earthquakes");
    const count = () => page.locator("[data-hazard-count]").first().getAttribute("data-hazard-count");
    await expect.poll(count).toBe("4");
    await page.getByRole("radiogroup", { name: "Playback" }).getByRole("radio", { name: "24H", exact: true }).click();
    await expect(page.getByTestId("historical-indicator")).toBeVisible();
    await expect.poll(count).toBe("1"); // only the 26-hour-old quake had occurred a day ago
    await page.getByTestId("return-to-live-button").click();
    await expect.poll(count).toBe("4");
  });
});

// ---------------------------------------------------------------------------------------------
test.describe("Real provider verification (network; skipped if a provider is unreachable)", () => {
  test.slow();
  const get = async (url: string, headers: Record<string, string> = {}) => {
    const res = await fetch(url, { headers: { "User-Agent": "Vigil/1.0 (verification)", ...headers }, signal: AbortSignal.timeout(45_000) });
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    return res;
  };

  test("USGS earthquakes, NASA FIRMS, EONET, HANS, NWS and GDACS respond and parse with the adapters", async () => {
    try {
      const usgs = parseUsgsEarthquakes(await (await get("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson")).json());
      expect(usgs.length).toBeGreaterThan(0);
      expect(usgs[0]!.sourceUrl).toMatch(/^https:\/\/earthquake\.usgs\.gov\//);
      expect(usgs[0]!.metadata).toHaveProperty("depthKm");

      const firmsText = (await (await get("https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_24h.csv")).text()).slice(0, 400_000);
      const firms = parseFirmsCsv(firmsText.slice(0, firmsText.lastIndexOf("\n")));
      expect(firms.length).toBeGreaterThan(50);
      expect(firms.every((f) => f.category === "thermal_detection" && f.confidenceLabel !== "low")).toBe(true);

      const wild = parseEonet(await (await get("https://eonet.gsfc.nasa.gov/api/v3/events?category=wildfires&status=open&limit=50")).json(), "wildfires");
      expect(wild.every((w) => w.category === "confirmed_wildfire")).toBe(true);
      const volc = parseEonet(await (await get("https://eonet.gsfc.nasa.gov/api/v3/events?category=volcanoes&status=open&limit=50")).json(), "volcanoes");
      expect(volc.every((v) => v.category === "volcano" && v.lat !== undefined)).toBe(true);

      const hans = await (await get("https://volcanoes.usgs.gov/hans-public/api/volcano/getElevatedVolcanoes")).json();
      expect(Array.isArray(hans)).toBe(true);
      if (hans.length) {
        const v = await (await get(`https://volcanoes.usgs.gov/hans-public/api/volcano/getVolcano/${hans[0].vnum}`)).json();
        expect(parseHansNotices([hans[0]], () => v).events[0]!.severityLabel).toBe(String(hans[0].alert_level).toUpperCase());
      }

      const nws = (await (await get("https://api.weather.gov/alerts/active?status=actual&message_type=alert", { Accept: "application/geo+json" })).json()) as { features: { geometry: GeoJSON.Geometry | null; properties: { id: string; severity: string; event: string } }[] };
      const withGeom = nws.features.find((f) => f.geometry && f.properties.severity !== "Unknown");
      if (withGeom) expect(normalizeCapAlert(withGeom as never, withGeom.geometry)!.severityDomain).toBe("cap_severity");

      const gdacs = parseGdacs(await (await get("https://www.gdacs.org/gdacsapi/api/events/geteventlist/EVENTS4APP")).json());
      expect(gdacs.every((g) => g.category === "cyclone" || g.category === "flood")).toBe(true);
    } catch (err) {
      if (err instanceof Error && /fetch failed|timeout|aborted|ENOTFOUND|ECONN/i.test(`${err.message} ${err.cause ?? ""}`)) test.skip(true, `network unavailable: ${err.message}`);
      throw err;
    }
  });
});

// Kept last: a pure function over the API shape used by the map (no server needed).
test("hazardsToSources splits features into per-layer map sources", () => {
  const f = (layer: string, kind: string) => ({ type: "Feature" as const, geometry: { type: "Point" as const, coordinates: [0, 0] }, properties: { id: kind, layer, kind, title: kind, label: null, value: null, prominence: 0, stale: false, confidence: null, observedAt: "2026-01-01T00:00:00Z" } });
  const s = hazardsToSources([f("earthquakes", "earthquake"), f("fires", "thermal_detection"), f("fires", "confirmed_wildfire"), f("volcanoes", "volcano"), f("weather", "weather_alert")] as never);
  expect([s.quakes.features.length, s.thermal.features.length, s.points.features.length, s.weather.features.length]).toEqual([1, 1, 2, 1]);
});
