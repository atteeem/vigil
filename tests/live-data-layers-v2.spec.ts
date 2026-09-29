import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { enableTerritory } from "./helpers/territory";
import { parseFaaNas } from "@/lib/hazards/providers/faa-nas";
import { parseFaaNotams, parseQLineCircle } from "@/lib/hazards/providers/faa-notam";
import { assessChokepoint, parsePortDisruptions } from "@/lib/hazards/providers/portwatch";
import { parseNgaWarnings } from "@/lib/hazards/providers/nga-warnings";
import { parseElexonRemit, parseEntsogUmm } from "@/lib/hazards/providers/energy";
import { parseIodaEvents, parseRadarOutages } from "@/lib/hazards/providers/internet";
import { HAZARD_PROVIDERS, missingCredentials } from "@/lib/hazards/registry";
import { airportProminence, chokepointProminence, energyProminence, internetProminence, HOMEPAGE_PROMINENCE } from "@/lib/hazards/significance";
import { LAYER_GROUPS, watchKeyFor, HAZARD_LAYERS } from "@/lib/hazards/types";
import { searchAirports, findAirport, countryCentroid } from "@/lib/hazards/reference";
import type { HazardCollection, HazardDetail } from "@/lib/hazards/public-types";
import { closeWorldControls, openWorldControls } from "./helpers/world-controls";

// Live Global Data Layers v2: aviation, maritime, energy and internet disruption on the SAME GlobalEvent
// pipeline, timeline and layer controls as v1. Strategic status only — no aircraft or vessel tracking.
// Provider payloads are local fixtures (lib/testing/hazard-fixtures.ts) pinned to T0; the last describe
// samples the real providers once.

const FIXTURE = "http://localhost:3100/api/test-fixtures/hazards";
const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const MIN = 60_000;
const HOUR = 3_600_000;
const T0 = Date.now();

const CLASS: Record<string, string> = { faa_nas_status: "government_alert", faa_notam: "government_alert", portwatch_chokepoints: "sensor_provider", portwatch_disruptions: "sensor_provider", nga_warnings: "government_alert", elexon_remit: "infrastructure_operator", entsog_umm: "infrastructure_operator", ioda: "sensor_provider", cloudflare_radar: "sensor_provider" };
const fixtureUrl = (path: string, query: string) => `${FIXTURE}/${path}${query ? `${query}&` : "?"}t=${T0}`;

async function addSource(request: APIRequestContext, provider: string, path: string, query = "") {
  const res = await request.post("/api/admin/sources", { data: { name: `LDL2 ${provider} ${unique()}`, type: "structured", platform: provider, feedUrl: fixtureUrl(path, query), url: fixtureUrl(path, query), enabled: true, autoIngest: false, autoProcessing: false, independenceClass: CLASS[provider], pollIntervalMinutes: 5 } });
  expect(res.status()).toBe(201);
  return (await res.json()) as { id: string };
}
const fetchNow = async (request: APIRequestContext, id: string) => (await request.post(`/api/admin/sources/${id}/fetch`).then((r) => r.json())) as { fetched: number; new: number; errors: number; error?: string };
async function ingest(request: APIRequestContext, provider: string, path: string, query = "") {
  const source = await addSource(request, provider, path, query);
  return { source, result: await fetchNow(request, source.id) };
}
const hazards = async (request: APIRequestContext, qs: string) => (await request.get(`/api/hazards?${qs}`).then((r) => r.json())) as HazardCollection;
const titles = (c: HazardCollection) => c.features.map((f) => f.properties.title);
const detailOf = async (request: APIRequestContext, id: string, at?: number) => (await request.get(`/api/hazards/${id}${at ? `?at=${encodeURIComponent(new Date(at).toISOString())}` : ""}`).then((r) => r.json())) as HazardDetail;
const find = (c: HazardCollection, needle: string) => c.features.find((f) => f.properties.title.includes(needle))!;
const at = (ms: number) => encodeURIComponent(new Date(ms).toISOString());

test.beforeAll(async () => {
  const { prisma } = await import("@/lib/db/client");
  await prisma.globalEvent.deleteMany({});
  await prisma.globalEventAggregate.deleteMany({});
  await prisma.hazardZone.deleteMany({});
});
test.afterAll(async () => {
  const { prisma } = await import("@/lib/db/client");
  await prisma.globalEvent.deleteMany({});
  await prisma.conflict.deleteMany({ where: { slug: { startsWith: "ldl2-" } } });
  await prisma.source.deleteMany({ where: { name: { startsWith: "LDL2 " } } });
});

// ---------------------------------------------------------------------------------------------
test.describe("Vocabulary, prominence and reference data", () => {
  test("layers are grouped Natural hazards / Transport / Infrastructure; domain prominence orders within a domain", () => {
    expect(LAYER_GROUPS.map((g) => [g.label, g.layers])).toEqual([["Natural hazards", ["earthquakes", "fires", "weather", "volcanoes"]], ["Transport", ["aviation", "maritime"]], ["Infrastructure", ["energy", "internet"]]]);
    expect(HAZARD_LAYERS).toHaveLength(8);
    expect(airportProminence("closed", "L", true)).toBeGreaterThan(airportProminence("disrupted", "L", false));
    expect(airportProminence("closed", "L", true)).toBeGreaterThanOrEqual(HOMEPAGE_PROMINENCE);
    expect(airportProminence("disrupted", "L", false)).toBeLessThan(HOMEPAGE_PROMINENCE);
    expect(chokepointProminence("major_disruption", "chokepoint6")).toBeGreaterThan(chokepointProminence("major_disruption", "chokepoint17")); // Hormuz > Bohai
    expect(chokepointProminence("normal", "chokepoint6")).toBeLessThan(HOMEPAGE_PROMINENCE);
    expect(energyProminence(5000, "outage")).toBeGreaterThan(energyProminence(150, "outage")); // multi-GW > local
    expect(energyProminence(null, "outage")).toBeLessThan(HOMEPAGE_PROMINENCE); // unknown capacity is not guessed upward
    expect(internetProminence(8000, 2, "national")).toBeGreaterThan(internetProminence(600, 1, "regional"));
  });

  test("reference data locates airports and countries; the watch key is stable and structural", () => {
    expect(findAirport("BEY")?.name).toContain("Rafic Hariri");
    expect(findAirport("OLBA")?.iata).toBe("BEY");
    expect(searchAirports("Rafic")[0]?.icao).toBe("OLBA");
    expect(countryCentroid("LB")?.name).toBe("Lebanon");
    expect(watchKeyFor("airport_status", "OLBA")).toBe("airport_status:OLBA");
    expect(watchKeyFor("airport_status", null)).toBeNull();
  });

  test("no provider tracks aircraft or vessels: the registry has no position-tracking source and events carry no tracking fields", () => {
    const keys = Object.keys(HAZARD_PROVIDERS);
    expect(keys.filter((k) => /opensky|adsb|ais|marinetraffic|flightradar|vessel|aircraft/i.test(k))).toEqual([]);
    const now = Date.now();
    const all = [
      ...parseFaaNas(`<AIRPORT_STATUS_INFORMATION><Update_Time>Sun Sep 20 15:19:09 2026 GMT</Update_Time><Delay_type><Name>Airport Closures</Name><Airport_Closure_List><Airport><ARPT>ORD</ARPT><Reason>ORD AD AP CLSD 2609190015-2609211200</Reason><Start>Sep 19 at 00:15 UTC.</Start><Reopen>Sep 21 at 12:00 UTC.</Reopen></Airport></Airport_Closure_List></Delay_type></AIRPORT_STATUS_INFORMATION>`).events,
      ...parseNgaWarnings({ "broadcast-warn": [{ msgYear: 2026, msgNumber: 1, navArea: "A", text: "GULF.\nPIRATES BOARDED A TANKER AT 04-10.50N 005-20.30E.\n", status: "A", issueDate: "202138Z SEP 2026" }] }),
    ];
    expect(all.length).toBeGreaterThan(1);
    for (const e of all) for (const banned of ["heading", "speed", "callsign", "mmsi", "icao24", "track", "route", "squawk", "imo"]) expect(Object.keys(e.metadata ?? {})).not.toContain(banned);
    void now;
  });
});

// ---------------------------------------------------------------------------------------------
test.describe("Provider normalisers", () => {
  test("FAA NAS: closure vs partial closure vs delay are distinct statuses; unplaceable airports are not invented", () => {
    const xml = `<AIRPORT_STATUS_INFORMATION><Update_Time>Sun Sep 20 15:19:09 2026 GMT</Update_Time>
      <Delay_type><Name>Ground Delay Programs</Name><Ground_Delay_List><Ground_Delay><ARPT>SFO</ARPT><Reason>low ceilings</Reason><Avg>52 minutes</Avg><Max>1 hour</Max></Ground_Delay></Ground_Delay_List></Delay_type>
      <Delay_type><Name>Airport Closures</Name><Airport_Closure_List>
        <Airport><ARPT>ORD</ARPT><Reason>!ORD 09/001 ORD AD AP CLSD 2609190015-2609211200</Reason><Start>Sep 19 at 00:15 UTC.</Start><Reopen>Sep 21 at 12:00 UTC.</Reopen></Airport>
        <Airport><ARPT>LAX</ARPT><Reason>!LAX AD AP CLSD TO NON SKED TRANSIENT GA ACFT EXC 24HR PPR</Reason><Start>Sep 19 at 00:15 UTC.</Start><Reopen>Sep 21 at 12:00 UTC.</Reopen></Airport>
        <Airport><ARPT>ZZZ</ARPT><Reason>AD AP CLSD</Reason><Start>Sep 19 at 00:15 UTC.</Start><Reopen>Sep 21 at 12:00 UTC.</Reopen></Airport>
      </Airport_Closure_List></Delay_type></AIRPORT_STATUS_INFORMATION>`;
    const { events } = parseFaaNas(xml);
    const by = Object.fromEntries(events.map((e) => [e.entityKey!, e]));
    expect(by.KORD).toMatchObject({ status: "closed", category: "airport_status", origin: "official_alert", providerEventId: "faa-KORD", sourceUrl: "https://nasstatus.faa.gov/" });
    expect(by.KORD!.expiresAt).toEqual(new Date("2026-09-21T12:00:00Z"));
    expect(by.KLAX!.status).toBe("partially_closed");
    expect(by.KSFO).toMatchObject({ status: "disrupted", severityLabel: "disrupted" });
    expect(events).toHaveLength(3); // ZZZ has no known location: not placed on the map
  });

  test("NOTAM: airport closure and airspace restriction with area geometry; routine notices are ignored", () => {
    const circle = parseQLineCircle("Q) KZLA/QRTCA/IV/BO/W/000/180/3345N11800W050")!;
    expect(circle.lat).toBeCloseTo(33.75, 3);
    expect(circle.radiusKm).toBeCloseTo(92.6, 1);
    const item = (id: string, icao: string, text: string) => ({ properties: { coreNOTAMData: { notam: { id, icaoLocation: icao, text, effectiveStart: "2026-09-20T10:00:00Z", effectiveEnd: "2026-09-20T18:00:00Z" } } } });
    const events = parseFaaNotams({ items: [item("n1", "OLBA", "OLBA AD AP CLSD"), item("n2", "KZLA", "Q) KZLA/QRTCA/IV/BO/W/000/180/3345N11800W050 TEMPORARY FLIGHT RESTRICTION"), item("n3", "KSFO", "TWY A CLSD")] });
    expect(events.map((e) => [e.category, e.status])).toEqual([["airport_status", "closed"], ["airspace_event", "restriction"]]);
    expect(events[1]!.geometry?.type).toBe("Polygon");
    expect(events[0]).toMatchObject({ entityKey: "OLBA", countryCode: "LB", expiresAt: new Date("2026-09-20T18:00:00Z") });
  });

  test("PortWatch: chokepoint status is a transit-volume deviation, never a derived closure; thin baselines yield no status", () => {
    const series = (recent: number, base: number) => Array.from({ length: 110 }, (_, i) => ({ date: new Date(Date.UTC(2026, 5, 1 + i)).toISOString().slice(0, 10), n: i >= 103 ? recent : base }));
    expect(assessChokepoint(series(30, 100))).toMatchObject({ status: "major_disruption", deviationPct: -70 });
    expect(assessChokepoint(series(60, 100))).toMatchObject({ status: "elevated_disruption" });
    expect(assessChokepoint(series(0, 100))!.status).toBe("major_disruption"); // even zero traffic is not "closed"
    expect(assessChokepoint(series(97, 100))!.status).toBe("normal");
    expect(assessChokepoint(series(1, 5))).toBeNull();
    const ports = parsePortDisruptions([{ attributes: { eventid: 1, eventtype: "TC", eventname: "Cyclone X", alertlevel: "Red", country: "Y", fromdate: 1_700_000_000_000, todate: 1_700_100_000_000, severitytext: null, lat: 10, long: 120, affectedports: "A; B", n_affectedports: 2 } }, { attributes: { eventid: 2, eventtype: "FL", eventname: "Flood", alertlevel: "Green", country: "Y", fromdate: 1, todate: 2, severitytext: null, lat: 1, long: 1, affectedports: "", n_affectedports: 0 } }]);
    expect(ports).toHaveLength(1);
    expect(ports[0]).toMatchObject({ category: "port_disruption", status: "disrupted", confidenceLabel: "Hazard-derived potential impact" }); // never "closed"
  });

  test("NGA: piracy/mines with a position are kept as security notices; exercises, firing areas and position-less notices are not", () => {
    const w = (n: number, text: string) => ({ msgYear: 2026, msgNumber: n, navArea: "A", text, status: "A", issueDate: "092138Z SEP 2026" });
    const events = parseNgaWarnings({ "broadcast-warn": [w(1, "GULF.\nPIRATES BOARDED A TANKER AT 04-10.50N 005-20.30E.\n"), w(2, "BLACK SEA.\nMINES REPORTED NEAR 45-07.10N 030-09.70E.\n"), w(3, "ATLANTIC.\nNAVAL GUNNERY EXERCISES 30-00.00N 040-00.00W.\n"), w(4, "NORTH SEA.\nPIRACY REPORTED. NO POSITION.\n")] });
    expect(events.map((e) => e.subtype)).toEqual(["piracy", "navigation_warning"]);
    expect(events[0]).toMatchObject({ category: "maritime_incident", origin: "official_alert", confidenceLabel: "Official navigation warning", locationPrecision: "approximate" });
    expect(events[0]!.lat).toBeCloseTo(4.175, 2);
  });

  test("Elexon / ENTSOG: unplanned capacity kept with units, percentage and expected restoration; planned/tiny/irrelevant ignored; capacity never guessed", () => {
    const r = (mrid: string, over: Record<string, unknown>) => ({ mrid, revisionNumber: 1, publishTime: "2026-09-20T10:00:00Z", eventType: "Production unavailability", unavailabilityType: "Unplanned", assetId: "T_X-1", affectedUnit: "X-1", fuelType: "Gas", normalCapacity: 1000, unavailableCapacity: 400, availableCapacity: 600, eventStatus: "Active", eventStartTime: "2026-09-20T09:00:00Z", eventEndTime: "2026-09-21T09:00:00Z", cause: "Fault", ...over });
    const events = parseElexonRemit({ data: [r("a", {}), r("a", { revisionNumber: 2, unavailableCapacity: 500 }), r("b", { unavailabilityType: "Planned" }), r("c", { unavailableCapacity: 20 }), r("d", { unavailableCapacity: undefined })] });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ providerEventId: "a", severityValue: 500, status: "reduced_capacity", countryCode: "GB", locationPrecision: "area_level", origin: "official_alert" });
    expect(events[0]!.metadata).toMatchObject({ capacityAffectedMw: 500, percentAffected: 50, expectedRestoration: "2026-09-21T09:00:00.000Z", operator: null });
    const umm = (id: string, over: Record<string, unknown>) => ({ id, messageId: id, threadId: id, marketParticipantKey: "DE-TSO-0009", publicationDateTime: "2026-09-20T08:00:00Z", eventStatus: "Active", eventType: "Transmission system unavailability", eventStart: "2026-09-20T08:00:00Z", eventStop: "2026-09-22T08:00:00Z", unavailabilityType: "Unplanned", unitMeasure: "kWh/h", affectedAssetName: "Entry", unavailableCapacity: "800000", isLatestVersion: "Yes", ...over });
    const gas = parseEntsogUmm({ urgentMarketMessages: [umm("g1", {}), umm("g2", { unavailableCapacity: "1000" }), umm("g3", { unitMeasure: "furlongs" }), umm("g4", { unavailabilityType: "Planned" })] }, new Date("2026-09-20T12:00:00Z"));
    expect(gas).toHaveLength(1);
    expect(gas[0]).toMatchObject({ countryCode: "DE", severityDomain: "gas_capacity_mw_equivalent", locationPrecision: "area_level" });
    expect(gas[0]!.metadata).toMatchObject({ capacityAffectedOriginal: 800000, capacityUnit: "kWh/h", capacityAffectedMwEquivalent: 800 });
  });

  test("IODA / Radar: an anomaly is an observation — cause and intent are never inferred; a weak isolated signal is not a national outage", () => {
    const now = new Date("2026-09-20T12:00:00Z");
    const s = (agoH: number) => Math.floor((now.getTime() - agoH * HOUR) / 1000);
    const row = (cc: string, ds: string, startAgoH: number, durH: number, score: number) => ({ location: `country/${cc}`, start: s(startAgoH), duration: durH * 3600, datasource: ds, score });
    const events = parseIodaEvents({ data: [row("LB", "bgp", 6, 7, 8000), row("LB", "ping-slash24", 5, 8, 3000), row("NZ", "merit-nt", 4, 1, 90)] }, now);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ category: "internet_disruption", status: "outage", entityKey: "LB", countryCode: "LB", subtype: "connectivity_anomaly" });
    expect(events[0]!.metadata).toMatchObject({ anomalyType: "observed_network_anomaly", intentionalShutdownConfirmed: false, causeEstablished: false });
    expect(events[0]!.description).toMatch(/does not establish the cause/);
    const radar = parseRadarOutages({ result: { annotations: [{ id: "r1", startDate: "2026-09-20T01:00:00Z", endDate: null, locations: ["IR"], outage: { outageCause: "GOVERNMENT_DIRECTED", outageType: "NATIONWIDE" }, description: "Nationwide traffic drop", asnsDetails: [{ asn: "58224", name: "TIC" }] }] } });
    expect(radar[0]).toMatchObject({ status: "outage", subtype: "national_outage" });
    expect(radar[0]!.metadata).toMatchObject({ providerReportedCause: "GOVERNMENT_DIRECTED", causeIsProviderClassification: true, intentionalShutdownConfirmed: false });
  });

  test("credentialed providers stay idle until configured", () => {
    expect(missingCredentials(HAZARD_PROVIDERS.cloudflare_radar!, {})).toEqual(["CLOUDFLARE_RADAR_TOKEN"]);
    expect(missingCredentials(HAZARD_PROVIDERS.cloudflare_radar!, { CLOUDFLARE_RADAR_TOKEN: "x" })).toEqual([]);
    expect(missingCredentials(HAZARD_PROVIDERS.faa_notam!, {})).toEqual(["FAA_NOTAM_CLIENT_ID", "FAA_NOTAM_CLIENT_SECRET"]);
    expect(missingCredentials(HAZARD_PROVIDERS.usgs_earthquakes!, {})).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
test.describe.serial("Pipeline, layers, timeline and cross-system behaviour (fixture providers)", () => {
  let faa: { id: string };
  let hormuzId = "";
  let orderId = "";
  let beirutId = "";

  test.beforeAll(async ({ request }) => {
    const { prisma } = await import("@/lib/db/client");
    await prisma.globalEvent.deleteMany({});
    faa = (await ingest(request, "faa_nas_status", "faa")).source;
    await ingest(request, "faa_notam", "notam");
    await ingest(request, "portwatch_chokepoints", "portwatch");
    await ingest(request, "portwatch_disruptions", "portwatch");
    await ingest(request, "nga_warnings", "nga");
    await ingest(request, "elexon_remit", "elexon");
    await ingest(request, "entsog_umm", "entsog");
    await ingest(request, "ioda", "ioda");
  });

  test("aviation: airport closure, partial closure and delay retained with authority, effective/reopen times and original URL; idempotent", async ({ request }) => {
    expect((await fetchNow(request, faa.id)).new).toBe(0);
    const c = await hazards(request, "layers=aviation&zoom=6&bbox=-130,25,-60,50");
    const ord = c.features.find((f) => f.properties.entityKey === "KORD")!;
    orderId = ord.properties.id;
    expect(ord.properties).toMatchObject({ kind: "airport_status", status: "closed", layer: "aviation" });
    const d = await detailOf(request, ord.properties.id);
    expect(d).toMatchObject({ domainStatus: "closed", originLabel: "Official alert", watchKey: "airport_status:KORD", sourceUrl: "https://nasstatus.faa.gov/", countryCode: "US" });
    expect(d.metadata).toMatchObject({ authority: "US Federal Aviation Administration", icao: "KORD" });
    expect(d.expiresAt).not.toBeNull(); // reported reopening
    expect(d.trust?.label).toBe("Independent / Strong Verification");
    const lax = c.features.find((f) => f.properties.entityKey === "KLAX")!;
    expect(lax.properties.status).toBe("partially_closed");
    expect(find(c, "San Francisco").properties.status).toBe("disrupted");
    // A ground delay is real but not major: it does not reach the world-zoom map or the homepage.
    const world = await hazards(request, "layers=aviation&zoom=2");
    expect(world.features.some((f) => f.properties.entityKey === "KORD")).toBe(true);
    expect(world.features.some((f) => f.properties.entityKey === "KSFO")).toBe(false);
  });

  test("aviation: NOTAM-derived airport closure (Beirut) and airspace area with geometry; effective and expiry kept", async ({ request }) => {
    const c = await hazards(request, "layers=aviation&zoom=6&bbox=-125,20,45,45");
    const beirut = c.features.find((f) => f.properties.entityKey === "OLBA")!;
    beirutId = beirut.properties.id;
    expect(beirut.properties).toMatchObject({ kind: "airport_status", status: "closed" });
    const d = await detailOf(request, beirutId);
    expect(d.title).toContain("Rafic Hariri");
    expect(d).toMatchObject({ countryCode: "LB", domainStatus: "closed", watchKey: "airport_status:OLBA" });
    expect(d.effectiveAt).not.toBeNull();
    expect(d.expiresAt).not.toBeNull();
    const area = c.features.find((f) => f.properties.kind === "airspace_event")!;
    expect(area.geometry.type).toBe("Polygon");
    expect(area.properties.status).toBe("restriction");
    const ad = await detailOf(request, area.properties.id);
    expect(ad.geometry?.type).toBe("Polygon");
    expect(ad.metadata).toMatchObject({ authority: "US Federal Aviation Administration (NOTAM)" });
  });

  test("credentialed provider without credentials stays idle and reports why (no unauthenticated attempt)", async ({ request }) => {
    const { source, result } = await ingest(request, "cloudflare_radar", "radar");
    expect(result.errors).toBe(1);
    expect(result.error).toMatch(/Credentials not configured: set CLOUDFLARE_RADAR_TOKEN/);
    const rows = (await request.get("/api/admin/live-data").then((r) => r.json())) as { id: string; health: string; access: { requiresCredentials: boolean; missing: string[] } }[];
    const row = rows.find((r) => r.id === source.id)!;
    expect(row.access).toMatchObject({ requiresCredentials: true, missing: ["CLOUDFLARE_RADAR_TOKEN"] });
    expect(row.health).toBe("needs_credentials");
  });

  test("maritime: chokepoint status is derived from aggregate transits (Hormuz major disruption, Bab el-Mandeb normal, Suez not assessable) and never claims closure", async ({ request }) => {
    const c = await hazards(request, "layers=maritime&zoom=6&bbox=30,5,65,35");
    const hormuz = find(c, "Hormuz");
    hormuzId = hormuz.properties.id;
    expect(hormuz.properties).toMatchObject({ kind: "chokepoint_status", status: "major_disruption" });
    expect(hormuz.properties.status).not.toBe("closed_restricted");
    expect(find(c, "Bab el-Mandeb").properties.status).toBe("normal");
    expect(c.features.some((f) => f.properties.title.includes("Suez"))).toBe(false);
    const d = await detailOf(request, hormuzId);
    expect(d.metadata).toMatchObject({ recentAvgDailyTransits: 30, baselineMedianDailyTransits: 102, deviationPct: -71, statusIsDerived: true });
    expect(d.description).toMatch(/does not by itself mean the passage is closed/);
    expect(d.originLabel).toBe("Sensor / satellite detection");
  });

  test("maritime: port-affecting hazard is a potential impact, security notices keep type/authority/URL, and the map shows only meaningful items at world zoom", async ({ request }) => {
    const local = await hazards(request, "layers=maritime&zoom=4");
    const port = local.features.find((f) => f.properties.kind === "port_disruption")!;
    expect(port.properties.status).toBe("disrupted");
    expect((await detailOf(request, port.properties.id)).metadata).toMatchObject({ potentialImpactOnly: true });
    const incident = local.features.find((f) => f.properties.kind === "maritime_incident" && f.properties.title.includes("Piracy"))!;
    expect(incident).toBeTruthy();
    const detail = await detailOf(request, incident.properties.id);
    expect(detail.metadata).toMatchObject({ incidentType: "piracy", authority: "NGA FIXTURE" });
    expect(detail.sourceUrl).toBe("https://msi.nga.mil/");
    expect(titles(local).some((t) => /GUNNERY|exercise/i.test(t))).toBe(false);
    // Aggregation by zoom: at world zoom the lesser notice and the normal chokepoint are omitted; zoomed in they appear.
    const world = await hazards(request, "layers=maritime&zoom=2");
    expect(world.features.some((f) => f.properties.title.startsWith("Mines"))).toBe(false);
    expect(world.features.some((f) => f.properties.title.includes("Bab el-Mandeb"))).toBe(false);
    expect(world.features.some((f) => f.properties.title.includes("Hormuz"))).toBe(true);
    const close = await hazards(request, "layers=maritime&zoom=6&bbox=30,5,65,35");
    expect(close.features.some((f) => f.properties.title.includes("Bab el-Mandeb"))).toBe(true);
  });

  test("energy: unplanned outage keeps capacity/percentage/operator/restoration; collapses to one counted disc per country when zoomed out", async ({ request }) => {
    const near = await hazards(request, "layers=energy&zoom=6&bbox=-10,48,5,60");
    const unit = near.features.find((f) => f.properties.title.includes("FIXA-1"))!;
    expect(unit.properties).toMatchObject({ kind: "energy_disruption", status: "outage", label: "660 MW (100%)" });
    const d = await detailOf(request, unit.properties.id);
    expect(d.metadata).toMatchObject({ capacityAffectedMw: 660, percentAffected: 100, infrastructureName: "FIXA-1", cause: "Boiler / Fuel supply", energyKind: "generation" });
    expect(d.expiresAt).not.toBeNull(); // expected restoration
    expect(d.locationPrecision).toBe("area_level");
    expect(near.features.some((f) => f.properties.title.includes("FIXC-1"))).toBe(false); // 50 MW: below the floor
    expect(near.features.some((f) => f.properties.title.includes("FIXB"))).toBe(false); // planned
    const reduced = near.features.find((f) => f.properties.title.includes("FIXD-1"))!;
    expect(reduced.properties).toMatchObject({ status: "reduced_capacity", label: "900 MW (75%)" });
    const world = await hazards(request, "layers=energy&zoom=2");
    const gb = world.features.find((f) => f.properties.kind === "energy_cluster" && f.properties.entityKey === "GB")!;
    expect(gb.properties).toMatchObject({ count: 2, value: 1560 });
    expect(world.features.some((f) => f.properties.entityKey === "DE")).toBe(false); // ~800 MW-equivalent: not significant at world zoom
    const regional = await hazards(request, "layers=energy&zoom=4");
    expect(regional.features.find((f) => f.properties.kind === "energy_cluster" && f.properties.entityKey === "DE")!.properties.count).toBe(1);
    const gas = (await hazards(request, "layers=energy&zoom=6&bbox=5,45,15,55")).features[0]!;
    expect((await detailOf(request, gas.properties.id)).metadata).toMatchObject({ capacityAffectedOriginal: 800000, capacityUnit: "kWh/h", energyKind: "gas" });
  });

  test("internet: a national anomaly is retained as an observation; the weak isolated signal is dropped; anomaly is not labelled a shutdown", async ({ request }) => {
    const c = await hazards(request, "layers=internet&zoom=2");
    expect(titles(c)).toEqual(["Lebanon — internet connectivity disruption"]);
    const f = c.features[0]!;
    expect(f.properties).toMatchObject({ kind: "internet_disruption", status: "outage", entityKey: "LB" });
    const d = await detailOf(request, f.properties.id);
    expect(d.metadata).toMatchObject({ anomalyType: "observed_network_anomaly", intentionalShutdownConfirmed: false, causeEstablished: false, scope: "national" });
    expect(d.description).toMatch(/does not establish the cause/);
    expect(d.sourceUrl).toBe("https://ioda.inetintel.cc.gatech.edu/country/LB");
    expect(d.trust?.label).toBe("Independent / Strong Verification");
    expect(JSON.stringify(d)).not.toMatch(/shutdown was|government (?:ordered|directed)|censor/i);
  });

  test("homepage and search: significant disruptions surface, routine operational noise does not", async ({ request }) => {
    const list = (await request.get("/api/public/global-events").then((r) => r.json())) as { title: string; category: string }[];
    const names = list.map((h) => h.title);
    expect(names.some((n) => n.includes("Chicago O") && /closed/.test(n))).toBe(true);
    expect(names.some((n) => n.includes("Rafic Hariri") && /closed/.test(n))).toBe(true);
    expect(names.some((n) => n.includes("Strait of Hormuz") && /major disruption/.test(n))).toBe(true);
    expect(names.some((n) => n.includes("Lebanon") && /internet/.test(n))).toBe(true);
    expect(names.some((n) => /San Francisco|EWR|Newark|FIXA|Bab el-Mandeb|Mines/.test(n))).toBe(false);
    expect(list.some((h) => h.category === "energy_disruption" || h.category === "port_disruption")).toBe(false);

    const search = async (q: string) => ((await request.get(`/api/public/search?q=${encodeURIComponent(q)}`).then((r) => r.json())) as { type: string; title: string; href: string }[]).filter((r) => r.type === "hazard");
    expect((await search("Beirut")).map((r) => r.title)).toEqual(expect.arrayContaining([expect.stringContaining("Rafic Hariri")]));
    expect((await search("OLBA")).length).toBeGreaterThan(0);
    expect((await search("Hormuz"))[0]!.title).toMatch(/Hormuz/);
    expect((await search("Lebanon")).some((r) => /internet/.test(r.title))).toBe(true);
    expect((await search("Newark")).length).toBe(0); // a routine departure delay is not indexed
  });

  test("conflict relationships are optional and reviewed: never created from proximity; only confirmed links are public", async ({ request }) => {
    const { prisma } = await import("@/lib/db/client");
    const conflict = (await request.post("/api/admin/conflicts", { data: { slug: `ldl2-${unique()}`, name: "LDL2 Test Conflict", region: "Middle East", status: "active", severity: "high", intensity: 60, lat: 33, lng: 35, fightingCountries: ["ZQ"] } }).then((r) => r.json())) as { id: string; slug: string };
    const before = await detailOf(request, beirutId);
    expect(before.relatedConflicts).toEqual([]); // geographic closeness alone links nothing
    expect(await prisma.globalEventLink.count()).toBe(0);
    const prox = await request.post(`/api/admin/global-events/${beirutId}/links`, { data: { conflictId: conflict.id, basis: "proximity" } });
    expect(prox.status()).toBe(400);
    expect((await request.post(`/api/admin/global-events/${beirutId}/links`, { data: { conflictId: conflict.id, basis: "source_relation" } })).status()).toBe(400); // needs the source URL
    expect((await request.post(`/api/admin/global-events/${beirutId}/links`, { data: { conflictId: conflict.id, basis: "admin_review" } })).status()).toBe(400); // needs a note
    const proposed = await request.post(`/api/admin/global-events/${beirutId}/links`, { data: { conflictId: conflict.id, basis: "admin_review", note: "NOTAM cites the security situation" } });
    expect(proposed.status()).toBe(201);
    expect((await detailOf(request, beirutId)).relatedConflicts).toEqual([]); // proposed is not public
    const link = (await proposed.json()) as { id: string };
    await request.post(`/api/admin/global-events/${beirutId}/links`, { data: { linkId: link.id, status: "confirmed" } });
    const after = await detailOf(request, beirutId);
    expect(after.relatedConflicts).toHaveLength(1);
    expect(after.relatedConflicts[0]).toMatchObject({ slug: conflict.slug, basis: "admin_review" });
  });

  test("party claims are recorded as claims and never change infrastructure status", async ({ request }) => {
    const { prisma } = await import("@/lib/db/client");
    const before = await detailOf(request, hormuzId);
    const row = await prisma.globalEvent.findUniqueOrThrow({ where: { id: hormuzId } });
    const res = await request.post(`/api/admin/global-events/${hormuzId}/claims`, { data: { claimant: "Party X", claimType: "closure", text: "We have closed the Strait to all shipping", sourceName: "Party X statement", sourceUrl: "https://party.test/statement" } });
    expect(res.status()).toBe(201);
    // ...and a claim against the one thing the measurement calls normal: the state does not move either.
    const bab = find(await hazards(request, "layers=maritime&zoom=6&bbox=30,5,65,35"), "Bab el-Mandeb");
    await request.post(`/api/admin/global-events/${bab.properties.id}/claims`, { data: { claimant: "Party Y", claimType: "attack", text: "We attacked shipping here" } });
    const after = await detailOf(request, hormuzId);
    expect(after.claims).toHaveLength(1);
    expect(after.claims[0]).toMatchObject({ claimant: "Party X", claimType: "closure", verification: "unverified", sourceUrl: "https://party.test/statement" });
    expect(after.domainStatus).toBe(before.domainStatus);
    expect(after.prominence).toBe(before.prominence);
    expect(after.revision).toBe(before.revision);
    const babAfter = await detailOf(request, bab.properties.id);
    expect(babAfter.domainStatus).toBe("normal");
    expect(babAfter.claims).toHaveLength(1);
    const unchanged = await prisma.globalEvent.findUniqueOrThrow({ where: { id: hormuzId } });
    expect(unchanged.status).toBe(row.status);
    expect(unchanged.contentHash).toBe(row.contentHash);
  });

  test("existing layers unaffected: default query covers all eight layers; v1 layers still answer; conflict events API unchanged", async ({ request }) => {
    const all = await hazards(request, "zoom=2");
    expect(Object.keys(all.meta.counts).sort()).toEqual([...HAZARD_LAYERS].sort());
    expect(all.meta.health.map((h) => h.layer)).toEqual([...HAZARD_LAYERS]);
    const quakes = await hazards(request, "layers=earthquakes&zoom=2");
    expect(quakes.features.every((f) => f.properties.layer === "earthquakes")).toBe(true);
    const onlyInfra = await hazards(request, "layers=energy,internet&zoom=2");
    expect(new Set(onlyInfra.features.map((f) => f.properties.layer))).toEqual(new Set(["energy", "internet"]));
    expect((await request.get("/api/events")).ok()).toBe(true);
    expect((await request.get("/api/territorial-control")).ok()).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
type MapHandle = { project: (p: [number, number]) => { x: number; y: number }; jumpTo: (o: unknown) => void; panBy: (o: number[], opts: unknown) => void; getLayoutProperty: (l: string, p: string) => unknown; querySourceFeatures: (s: string) => { properties: Record<string, unknown> }[]; queryRenderedFeatures: (o?: unknown) => { properties: Record<string, unknown> }[]; getCanvas: () => HTMLCanvasElement };
async function openWorld(page: Page) {
  await page.goto("/world");
  await page.waitForFunction(() => Boolean((window as unknown as { __vigilMap?: unknown }).__vigilMap));
}
async function enableLayer(page: Page, layer: string) {
  await openWorldControls(page, "layers");
  await page.getByTestId("hazard-layers-button").click();
  await page.getByTestId(`hazard-toggle-${layer}`).check();
  await page.getByTestId("hazard-layers-button").click();
  await closeWorldControls(page);
}
const mapEval = <T,>(page: Page, fn: (m: MapHandle) => T) => page.evaluate(`(${fn.toString()})(window.__vigilMap)`) as Promise<T>;

test.describe.serial("World map UI (v2 layers)", () => {
  test.beforeAll(async ({ request }) => {
    const { prisma } = await import("@/lib/db/client");
    await prisma.globalEvent.deleteMany({});
    await ingest(request, "faa_notam", "notam");
    await ingest(request, "portwatch_chokepoints", "portwatch");
    await ingest(request, "elexon_remit", "elexon");
    await ingest(request, "ioda", "ioda");
  });

  test("Transport and Infrastructure groups hold independent toggles (off by default); conflict layers and natural hazards are unaffected", async ({ page }) => {
    await openWorld(page);
    await openWorldControls(page, "layers");
    await page.getByTestId("hazard-layers-button").click();
    await expect(page.getByTestId("layer-group-transport").getByTestId("hazard-toggle-aviation")).not.toBeChecked();
    await expect(page.getByTestId("layer-group-transport").getByTestId("hazard-toggle-maritime")).not.toBeChecked();
    await expect(page.getByTestId("layer-group-infrastructure").getByTestId("hazard-toggle-energy")).not.toBeChecked();
    await expect(page.getByTestId("layer-group-infrastructure").getByTestId("hazard-toggle-internet")).not.toBeChecked();
    await page.getByTestId("hazard-toggle-aviation").check();
    await page.getByTestId("hazard-toggle-internet").check();
    await expect(page.locator("[data-hazard-layers]").first()).toHaveAttribute("data-hazard-layers", "aviation,internet");
    await page.getByTestId("hazard-toggle-earthquakes").check();
    await page.getByTestId("hazard-toggle-aviation").uncheck();
    await expect(page.locator("[data-hazard-layers]").first()).toHaveAttribute("data-hazard-layers", "internet,earthquakes");
    await page.getByTestId("hazard-toggle-earthquakes").uncheck();
    await page.getByTestId("hazard-toggle-internet").uncheck();
    await enableTerritory(page);
    await expect(page.locator("[data-hazard-layers]").first()).toHaveAttribute("data-hazard-layers", "");
  });

  test("aviation markers render and a click opens the airport panel; world zoom shows only the significant disruptions", async ({ page }) => {
    await openWorld(page);
    await mapEval(page, (m) => m.jumpTo({ center: [20, 25], zoom: 1.6 }));
    await enableLayer(page, "aviation");
    await expect.poll(() => mapEval(page, (m) => m.querySourceFeatures("hz-ops").map((f) => String(f.properties.entityKey)))).toContain("OLBA");
    await expect.poll(() => mapEval(page, (m) => m.getLayoutProperty("hz-aviation-icon", "visibility"))).toBe("visible");
    await mapEval(page, (m) => { m.jumpTo({ center: [35.4874, 33.8198], zoom: 7 }); m.panBy([0, -250], { duration: 0 }); });
    await expect.poll(() => mapEval(page, (m) => m.queryRenderedFeatures({ layers: ["hz-aviation-icon"] }).map((f) => String(f.properties.entityKey)))).toContain("OLBA");
    const pt = (await page.evaluate(`(() => { const m = window.__vigilMap; const p = m.project([35.4874, 33.8198]); const r = m.getCanvas().getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; })()`)) as { x: number; y: number };
    await page.mouse.click(pt.x, pt.y);
    const detail = page.locator('[data-testid="hazard-detail"]:visible');
    await expect(detail.getByTestId("hazard-title")).toContainText("Rafic Hariri");
    await expect(detail.getByTestId("fact-domain-status")).toContainText("Closed");
    await expect(detail.getByTestId("fact-authority")).toContainText("Federal Aviation Administration");
    await expect(detail.getByTestId("fact-effective")).toBeVisible();
    await expect(detail.getByTestId("hazard-source-link")).toHaveAttribute("href", /notams\.aim\.faa\.gov/);
    await expect(detail.getByTestId("hazard-origin")).toHaveText("Official alert");
  });

  test("maritime and energy: low zoom shows the significant chokepoint and country-level energy aggregate; close zoom adds detail", async ({ page }) => {
    await openWorld(page);
    await enableLayer(page, "maritime");
    await enableLayer(page, "energy");
    await expect.poll(() => mapEval(page, (m) => m.querySourceFeatures("hz-ops").map((f) => `${f.properties.kind}:${f.properties.entityKey}`))).toEqual(expect.arrayContaining(["chokepoint_status:chokepoint6", "energy_cluster:GB"]));
    const kinds = await mapEval(page, (m) => m.querySourceFeatures("hz-ops").map((f) => `${f.properties.kind}:${f.properties.entityKey}`));
    expect(kinds).not.toContain("chokepoint_status:chokepoint4"); // normal chokepoint: not at world zoom
    await mapEval(page, (m) => m.jumpTo({ center: [43.3, 12.8], zoom: 6 }));
    await expect.poll(() => mapEval(page, (m) => m.querySourceFeatures("hz-ops").map((f) => String(f.properties.entityKey)))).toContain("chokepoint4");
    await mapEval(page, (m) => m.jumpTo({ center: [-2, 54], zoom: 6.5 }));
    await expect.poll(() => mapEval(page, (m) => m.querySourceFeatures("hz-ops").filter((f) => f.properties.kind === "energy_disruption").length)).toBeGreaterThanOrEqual(2);
  });

  test("the timeline controls the new layers: an earlier time hides an outage that had not started; Return to Live restores it", async ({ page }) => {
    await openWorld(page);
    await enableLayer(page, "internet");
    const count = () => page.locator("[data-hazard-count]").first().getAttribute("data-hazard-count");
    await expect.poll(count).toBe("1");
    await openWorldControls(page, "timeline");
    await page.getByRole("radiogroup", { name: "Playback" }).getByRole("radio", { name: "24H", exact: true }).click();
    await expect(page.getByTestId("historical-indicator")).toBeVisible();
    await expect.poll(count).toBe("0"); // the Lebanon anomaly began ~6 h ago
    await page.getByTestId("return-to-live-button").click();
    await expect.poll(count).toBe("1");
  });
});

// ---------------------------------------------------------------------------------------------
test.describe.serial("Lifecycle: revisions, resolution, reconstruction and retention", () => {
  test.beforeAll(async ({ request }) => {
    const { prisma } = await import("@/lib/db/client");
    await prisma.globalEvent.deleteMany({});
    await ingest(request, "faa_nas_status", "faa");
    await ingest(request, "portwatch_chokepoints", "portwatch");
    await ingest(request, "elexon_remit", "elexon");
    await ingest(request, "ioda", "ioda");
    await ingest(request, "usgs_volcanoes", "hans/getElevatedVolcanoes"); // a v1 layer rides along untouched
  });

  test("airport reopening: the closure ends when the provider drops it, keeps its history and reconstructs as closed before that", async ({ request }) => {
    const before = await hazards(request, "layers=aviation&zoom=6&bbox=-130,25,-60,50");
    const ordId = before.features.find((f) => f.properties.entityKey === "KORD")!.properties.id;
    const mark = Date.now();
    await ingest(request, "faa_nas_status", "faa", "?v=2");
    const live = await hazards(request, "layers=aviation&zoom=6&bbox=-130,25,-60,50");
    expect(live.features.some((f) => f.properties.entityKey === "KORD")).toBe(false); // reopened
    expect(live.features.some((f) => f.properties.entityKey === "KLAX")).toBe(true);
    const then = await hazards(request, `layers=aviation&zoom=6&bbox=-130,25,-60,50&at=${at(mark)}`);
    expect(then.features.some((f) => f.properties.entityKey === "KORD")).toBe(true); // as it was a moment ago
    const d = await detailOf(request, ordId);
    expect(d).toMatchObject({ status: "withdrawn", revisionCount: 2, entityKey: "KORD" });
    expect(d.endedAt).not.toBeNull();
    expect(d.watchKey).toBe("airport_status:KORD"); // the subscription key never changes
    const { prisma } = await import("@/lib/db/client");
    expect(await prisma.globalEventRevision.count({ where: { globalEventId: ordId } })).toBe(2);
  });

  test("chokepoint recovery: a new measurement revises the status in place; the earlier status stays reconstructable", async ({ request }) => {
    const c0 = await hazards(request, "layers=maritime&zoom=6&bbox=30,5,65,35");
    const id = find(c0, "Hormuz").properties.id;
    const mid = Date.now();
    await ingest(request, "portwatch_chokepoints", "portwatch", "?v=2");
    const d = await detailOf(request, id);
    expect(d).toMatchObject({ domainStatus: "normal", revision: 2 });
    const then = await detailOf(request, id, mid);
    expect(then.domainStatus).toBe("major_disruption");
    const { prisma } = await import("@/lib/db/client");
    expect(await prisma.globalEvent.count({ where: { provider: "portwatch_chokepoints", providerEventId: "portwatch-chokepoint6" } })).toBe(1);
  });

  test("outage lifecycle: restoration (Dismissed) ends the energy event; capacity and history retained", async ({ request }) => {
    const c = await hazards(request, "layers=energy&zoom=6&bbox=-10,48,5,60");
    const id = c.features.find((f) => f.properties.title.includes("FIXA-1"))!.properties.id;
    await ingest(request, "elexon_remit", "elexon", "?v=2");
    const d = await detailOf(request, id);
    expect(d).toMatchObject({ domainStatus: "restored", status: "withdrawn", revisionCount: 2 });
    expect(d.metadata).toMatchObject({ capacityAffectedMw: 660 });
    expect((await hazards(request, "layers=energy&zoom=6&bbox=-10,48,5,60")).features.some((f) => f.properties.title.includes("FIXA-1"))).toBe(false);
    expect((await detailOf(request, id, T0 - 15 * MIN)).domainStatus).toBe("outage"); // between the two operator messages
  });

  test("internet restoration: the anomaly ends with a restoration time; before that it reconstructs as ongoing", async ({ request }) => {
    const id = (await hazards(request, "layers=internet&zoom=2")).features[0]!.properties.id;
    const mark = Date.now();
    await ingest(request, "ioda", "ioda", "?v=2");
    expect((await hazards(request, "layers=internet&zoom=2")).features).toHaveLength(0);
    const d = await detailOf(request, id);
    expect(d).toMatchObject({ domainStatus: "restored", status: "withdrawn" });
    expect(d.endedAt).not.toBeNull();
    expect((await hazards(request, `layers=internet&zoom=2&at=${at(mark)}`)).features).toHaveLength(1);
  });

  test("volcano layer and earlier layers untouched by the new providers", async ({ request }) => {
    const c = await hazards(request, "layers=volcanoes&zoom=2");
    expect(c.features.some((f) => f.properties.title.startsWith("Fixture Peak"))).toBe(true);
  });

  test("retention: lifecycle records are kept for a year after they end, then removed; recent history stays", async () => {
    const { prisma } = await import("@/lib/db/client");
    const { runLifecycleRetention } = await import("@/lib/hazards/store");
    const base = { origin: "official_alert", category: "energy_disruption", layer: "energy", provider: "elexon_remit", title: "Old outage", prominence: 30, lat: 1, lng: 1, minLat: 1, maxLat: 1, minLng: 1, maxLng: 1, contentHash: "x", observedAt: new Date(Date.now() - 500 * 86_400_000) };
    await prisma.globalEvent.createMany({ data: [{ ...base, providerEventId: `old-${unique()}`, endedAt: new Date(Date.now() - 400 * 86_400_000) }, { ...base, providerEventId: `recent-${unique()}`, endedAt: new Date(Date.now() - 30 * 86_400_000) }] });
    expect(await runLifecycleRetention()).toBe(1);
    expect(await prisma.globalEvent.count({ where: { title: "Old outage" } })).toBe(1);
  });

  test("admin coverage: provider status, health, backoff, counts and raw provider metadata", async ({ request }) => {
    const failing = await addSource(request, "ioda", "ioda", "?status=429&retryAfter=3600");
    const bad = await fetchNow(request, failing.id);
    expect(bad.errors).toBe(1);
    const rows = (await request.get("/api/admin/live-data").then((r) => r.json())) as { id: string; provider: string; health: string; backingOff: boolean; nextPollAt: string | null; consecutiveFailures: number; events: { total: number; active: number }; access: { requiresCredentials: boolean }; layer: string }[];
    const row = rows.find((r) => r.id === failing.id)!;
    expect(row).toMatchObject({ provider: "ioda", layer: "internet", health: "backing_off", backingOff: true, consecutiveFailures: 1 });
    expect(new Date(row.nextPollAt!).getTime()).toBeGreaterThan(Date.now() + 55 * MIN);
    expect(rows.find((r) => r.provider === "faa_nas_status")!.events.total).toBeGreaterThan(0);
    expect(rows.find((r) => r.provider === "usgs_earthquakes")!.access.requiresCredentials).toBe(false);
    const raw = (await request.get("/api/admin/global-events?provider=elexon_remit&limit=5").then((r) => r.json())) as { metadata: Record<string, unknown> }[];
    expect(raw.find((r) => r.metadata)!.metadata).toHaveProperty("capacityAffectedMw");
  });

  test("admin page lists the providers", async ({ page }) => {
    await page.goto("/admin/live-data");
    await expect(page.getByTestId("admin-live-data")).toBeVisible();
    await expect(page.getByTestId("live-provider-faa_nas_status").first()).toBeVisible();
    await expect(page.getByTestId("live-provider-cloudflare_radar").first()).toContainText("Cloudflare Radar");
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

  test("FAA NAS, PortWatch, NGA, Elexon, ENTSOG and IODA respond and parse with the adapters", async () => {
    try {
      const faa = parseFaaNas(await (await get("https://nasstatus.faa.gov/api/airport-status-information")).text());
      expect(faa.updated.getTime()).toBeGreaterThan(0);
      for (const e of faa.events) expect(["disrupted", "partially_closed", "closed"]).toContain(e.status);

      const base = "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services";
      const cps = (await (await get(`${base}/PortWatch_chokepoints_database/FeatureServer/0/query?where=1%3D1&outFields=portid,portname,lat,lon&returnGeometry=false&f=json`)).json()) as { features: { attributes: { portid: string } }[] };
      expect(cps.features.length).toBeGreaterThanOrEqual(20);
      const daily = (await (await get(`${base}/Daily_Chokepoints_Data/FeatureServer/0/query?where=portid%3D%27chokepoint4%27&outFields=date,n_total&orderByFields=date%20DESC&resultRecordCount=120&returnGeometry=false&f=json`)).json()) as { features: { attributes: { date: string; n_total: number } }[] };
      const a = assessChokepoint(daily.features.map((f) => ({ date: String(f.attributes.date), n: f.attributes.n_total })));
      expect(a === null || ["normal", "elevated_disruption", "major_disruption"].includes(a.status)).toBe(true);

      const nga = parseNgaWarnings(await (await get("https://msi.nga.mil/api/publications/broadcast-warn?output=json&status=active")).json());
      for (const e of nga) expect(e.category).toBe("maritime_incident");

      const to = new Date();
      const from = new Date(to.getTime() - 20 * HOUR);
      const remit = parseElexonRemit(await (await get(`https://data.elexon.co.uk/bmrs/api/v1/datasets/REMIT?publishDateTimeFrom=${from.toISOString().slice(0, 16)}Z&publishDateTimeTo=${to.toISOString().slice(0, 16)}Z&format=json`)).json());
      for (const e of remit) expect(e.severityValue).toBeGreaterThanOrEqual(100);

      const umm = parseEntsogUmm(await (await get("https://transparency.entsog.eu/api/v1/urgentMarketMessages?limit=400&periodFrom=2026-09-01&periodTo=2026-12-31&timezone=UTC")).json());
      for (const e of umm) expect(e.countryCode).toMatch(/^[A-Z]{2}$/);

      const until = Math.floor(Date.now() / 1000);
      const ioda = parseIodaEvents(await (await get(`https://api.ioda.inetintel.cc.gatech.edu/v2/outages/events?from=${until - 3 * 86_400}&until=${until}&entityType=country&limit=500`)).json(), new Date());
      for (const e of ioda) expect(e.metadata).toMatchObject({ intentionalShutdownConfirmed: false });

      // The two credentialed providers really do demand credentials (no bypass attempted).
      const cf = await fetch("https://api.cloudflare.com/client/v4/radar/annotations/outages?limit=1", { signal: AbortSignal.timeout(30_000) });
      expect(cf.status).toBeGreaterThanOrEqual(400);
    } catch (err) {
      if (err instanceof Error && /fetch failed|timeout|aborted|ENOTFOUND|ECONN/i.test(`${err.message} ${err.cause ?? ""}`)) test.skip(true, `network unavailable: ${err.message}`);
      throw err;
    }
  });
});
