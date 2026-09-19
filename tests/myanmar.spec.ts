import { test, expect } from "@playwright/test";
import { mapIissCategoryToEventType, mapIissSubtype } from "@/lib/myanmar/event-taxonomy";
import { detectTerritorialChangeMentions } from "@/lib/myanmar/territorial-change-detection";
import { computeSeverityScore } from "@/lib/scoring/severity";

// Myanmar Specialist Source Integration. Fixture-driven except the last
// test, which is the single real-network proof against Myanmar Now's live
// public feed.

test.describe("Myanmar event taxonomy (lib/myanmar/event-taxonomy.ts)", () => {
  test("IISS's five categories map onto EXISTING Vigil event types, with no new global category", () => {
    expect(mapIissCategoryToEventType("Attack/armed clash")).toBe("ground_clash");
    expect(mapIissCategoryToEventType("Remote explosive/IEDs")).toBe("explosion");
    expect(mapIissCategoryToEventType("Air/drone strike")).toBe("airstrike");
    expect(mapIissCategoryToEventType("Crackdowns")).toBe("civil_unrest");
    expect(mapIissCategoryToEventType("Infrastructure destruction")).toBe("infrastructure");
  });

  test("Mapping is case-insensitive, preserves the source subtype, and returns null for unknown labels", () => {
    expect(mapIissSubtype("CRACKDOWNS")).toEqual({ eventType: "civil_unrest", sourceSubtype: "CRACKDOWNS" });
    expect(mapIissCategoryToEventType("Something else entirely")).toBeNull();
  });
});

test.describe("Territorial-change detection (lib/myanmar/territorial-change-detection.ts)", () => {
  test("'X recaptured Y from Z' yields claimed actor, location, and previous actor", () => {
    const [m] = detectTerritorialChangeMentions("The Tatmadaw recaptured Moebye from KNDF last week.");
    expect(m).toMatchObject({ claimedActorName: "Tatmadaw", locationName: "Moebye", previousActorName: "KNDF" });
  });

  test("'X handed Y control to Z' reverses the direction correctly", () => {
    const [m] = detectTerritorialChangeMentions("MNDAA handed Lashio control to Tatmadaw under the deal.");
    expect(m).toMatchObject({ claimedActorName: "Tatmadaw", locationName: "Lashio", previousActorName: "MNDAA" });
  });

  test("Text with no control-change phrasing produces nothing", () => {
    expect(detectTerritorialChangeMentions("An airstrike hit a village outside Sittwe.")).toHaveLength(0);
  });
});

test.describe.serial("Myanmar Now ingestion and candidate pipeline", () => {
  let sourceId: string;
  let territoryCountBefore: number;

  test("1. Myanmar Now-style RSS ingests through the existing adapter with author, categories, and paywall flag preserved", async ({ request }) => {
    territoryCountBefore = (await request.get("/api/admin/territorial-control").then((r) => r.json())).length;

    sourceId = await request
      .post("/api/admin/sources", {
        data: {
          name: `Myanmar Now Fixture ${Date.now()}`,
          type: "rss",
          url: "http://localhost:3100/api/test-fixtures/rss/myanmar-now-feed",
          country: "MM",
          language: "en",
          sourceCategory: "News",
          sourceRole: "local_media",
          reliabilityTier: "B",
          enabled: true,
          autoIngest: false,
          autoProcessing: true,
        },
      })
      .then((r) => r.json())
      .then((s) => s.id);

    const fetchResult = await request.post(`/api/admin/sources/${sourceId}/fetch`).then((r) => r.json());
    expect(fetchResult.errors).toBe(0);
    expect(fetchResult.new).toBe(3);

    const items = await request.get(`/api/admin/incoming?sourceId=${sourceId}`).then((r) => r.json());
    const free = items.find((i: { originalUrl: string }) => i.originalUrl.endsWith("kyaukme-retaken"));
    const paid = items.find((i: { originalUrl: string }) => i.originalUrl.endsWith("sagaing-displacement"));
    expect(free.rawMetadata.author).toBe("Fixture Reporter One");
    expect(free.rawMetadata.categories).toContain("Myanmar");
    expect(free.rawMetadata.paidContent).toBeUndefined();
    expect(paid.rawMetadata.paidContent).toBe(true);
    expect(paid.rawMetadata.author).toBe("Fixture Reporter Two");
    // Classified as local media, never an aggregator.
    expect(free.source.sourceRole).toBe("local_media");
  });

  test("2. Original article URL and publication time survive ingestion unchanged", async ({ request }) => {
    const items = await request.get(`/api/admin/incoming?sourceId=${sourceId}`).then((r) => r.json());
    const free = items.find((i: { originalUrl: string }) => i.originalUrl.endsWith("kyaukme-retaken"));
    expect(free.originalUrl).toBe("https://fixture.test/myanmar-now/kyaukme-retaken");
    expect(new Date(free.publishedAt).toISOString()).toBe("2026-01-01T08:00:00.000Z");
  });

  test("3. Actors are deduplicated across articles: one Tatmadaw and one KNDF row, however many items name them", async ({ request }) => {
    const units = await request.get("/api/admin/military-units").then((r) => r.json());
    expect(units.filter((u: { name: string }) => u.name === "Tatmadaw")).toHaveLength(1);
    expect(units.filter((u: { name: string }) => u.name === "KNDF")).toHaveLength(1);
  });

  test("4. A reported control change becomes a PENDING candidate with provenance, and only a candidate", async ({ request }) => {
    const candidates = await request.get("/api/admin/territorial-change-candidates").then((r) => r.json());
    const c = candidates.find((x: { sourceUrl: string }) => x.sourceUrl === "https://fixture.test/myanmar-now/kyaukme-retaken");
    expect(c).toBeTruthy();
    // Pending on first creation; the Desktop project's run may already have reviewed it before Mobile runs.
    expect(["pending", "reviewed"]).toContain(c.status);
    expect(c.locationName).toBe("Kyaukme");
    expect(c.claimedActorName).toBe("Tatmadaw");
    expect(c.previousActorName).toBe("KNDF");

    // No automatic polygon change.
    const territories = await request.get("/api/admin/territorial-control").then((r) => r.json());
    expect(territories).toHaveLength(territoryCountBefore);

    // Re-fetching neither duplicates the item nor the candidate.
    await request.post(`/api/admin/sources/${sourceId}/fetch`);
    const again = await request.get("/api/admin/territorial-change-candidates").then((r) => r.json());
    expect(again.filter((x: { locationName: string }) => x.locationName === "Kyaukme")).toHaveLength(1);
  });

  test("5. Reviewing or dismissing a candidate never touches territorial control", async ({ request }) => {
    const candidates = await request.get("/api/admin/territorial-change-candidates").then((r) => r.json());
    const c = candidates.find((x: { locationName: string }) => x.locationName === "Kyaukme");
    const reviewed = await request
      .patch(`/api/admin/territorial-change-candidates/${c.id}`, { data: { status: "reviewed", reviewNote: "checked" } })
      .then((r) => r.json());
    expect(reviewed.status).toBe("reviewed");
    const territories = await request.get("/api/admin/territorial-control").then((r) => r.json());
    expect(territories).toHaveLength(territoryCountBefore);

    const bad = await request.patch(`/api/admin/territorial-change-candidates/${c.id}`, { data: { status: "published" } });
    expect(bad.status()).toBe(400);
  });

  test("6. Seeded IISS-sourced candidates keep real provenance and include an approximate and an unknown-precision case", async ({ request }) => {
    const candidates = await request.get("/api/admin/territorial-change-candidates").then((r) => r.json());
    const lashio = candidates.find((x: { locationName: string }) => x.locationName === "Lashio");
    const moebye = candidates.find((x: { locationName: string }) => x.locationName === "Moebye");
    expect(lashio.sourceUrl).toBe("https://myanmar.iiss.org/analysis/war-to-nowhere");
    expect(lashio.precision).toBe("approximate");
    expect(lashio.lat).not.toBeNull();
    expect(moebye.precision).toBe("unknown");
    expect(moebye.lat).toBeNull(); // never invent a coordinate
  });
});

test.describe("Areas of Operation stay separate from Territorial Control", () => {
  test("An area of operation is stored with its own precision and never appears in territorial control", async ({ request }) => {
    const units = await request.get("/api/admin/military-units").then((r) => r.json());
    const aa = units.find((u: { name: string }) => u.name === "Arakan Army");
    const territoriesBefore = await request.get("/api/admin/territorial-control").then((r) => r.json());
    const publicBefore = await request.get("/api/territorial-control").then((r) => r.json());

    const area = await request
      .post("/api/admin/areas-of-operation", {
        data: {
          unitId: aa.id,
          name: `Test area ${Date.now()}`,
          geometry: { type: "Point", coordinates: [93.0, 20.0] },
          precision: "approximate",
          sourceName: "Test",
          sourceUrl: "https://example.test/area",
        },
      })
      .then((r) => r.json());
    expect(area.precision).toBe("approximate");

    const invalid = await request
      .post("/api/admin/areas-of-operation", {
        data: { unitId: aa.id, geometry: { type: "Point", coordinates: [93, 20] }, precision: "made-up" },
      })
      .then((r) => r.json());
    expect(invalid.precision).toBe("unknown");

    const territoriesAfter = await request.get("/api/admin/territorial-control").then((r) => r.json());
    const publicAfter = await request.get("/api/territorial-control").then((r) => r.json());
    expect(territoriesAfter).toHaveLength(territoriesBefore.length);
    expect(JSON.stringify(publicAfter)).toBe(JSON.stringify(publicBefore));

    const seeded = await request.get(`/api/admin/areas-of-operation?unitId=${aa.id}`).then((r) => r.json());
    expect(seeded.some((a: { name: string }) => a.name === "Rakhine State (area-level)")).toBe(true);
  });

  test("The seeded area of operation is explicitly area-level, not a control claim", async ({ request }) => {
    const areas = await request.get("/api/admin/areas-of-operation").then((r) => r.json());
    const rakhine = areas.find((a: { name: string }) => a.name === "Rakhine State (area-level)");
    expect(rakhine.precision).toBe("area_level");
    expect(rakhine.description).toContain("Not a territorial-control claim");
    expect(rakhine.sourceUrl).toBe("https://myanmar.iiss.org/analysis/war-to-nowhere");
  });
});

test.describe("Actor -> events and scoring integration", () => {
  test("A published report's linked actors carry over to the event (actor -> events)", async ({ request }) => {
    const source = await request
      .post("/api/admin/sources", {
        data: {
          name: `Myanmar Now Events ${Date.now()}`,
          type: "rss",
          url: "http://localhost:3100/api/test-fixtures/rss/myanmar-now-feed",
          country: "MM",
          enabled: true,
          autoIngest: false,
          autoProcessing: true,
        },
      })
      .then((r) => r.json());
    await request.post(`/api/admin/sources/${source.id}/fetch`);
    const items = await request.get(`/api/admin/incoming?sourceId=${source.id}&status=pending`).then((r) => r.json());
    const item = items.find((i: { originalUrl: string }) => i.originalUrl.endsWith("kyaukme-retaken"));
    const links = await request.get(`/api/admin/incoming/${item.id}/military-links`).then((r) => r.json());
    const names = links.units.map((u: { name: string }) => u.name);
    expect(names).toContain("Tatmadaw");
    expect(names).toContain("KNDF");

    const published = await request
      .post(`/api/admin/incoming/${item.id}/publish`, {
        data: {
          title: "Kyaukme retaken",
          summary: "Test summary",
          eventType: "ground_clash",
          latitude: 22.55,
          longitude: 97.03,
          occurredAt: new Date().toISOString(),
          severity: "high",
        },
      })
      .then((r) => r.json());
    expect(published.id).toBeTruthy();

    const units = await request.get("/api/admin/military-units").then((r) => r.json());
    const tatmadaw = units.find((u: { name: string }) => u.name === "Tatmadaw");
    const unitEvents = await request.get(`/api/admin/military-units/${tatmadaw.id}/events`).then((r) => r.json());
    expect(unitEvents.some((e: { eventId: string }) => e.eventId === published.id)).toBe(true);
  });

  test("Myanmar uses the same centralized scoring rules as every other conflict", async ({ request }) => {
    const conflict = await request
      .post("/api/admin/conflicts", {
        data: {
          slug: `myanmar-scoring-${Date.now()}`,
          name: "Myanmar Scoring Test",
          region: "Asia",
          status: "active",
          severity: "extreme",
          intensity: 90,
          countries: ["MM"],
          lat: 21.9,
          lng: 96.0,
        },
      })
      .then((r) => r.json());

    const scores = await request.get(`/api/admin/conflicts/${conflict.id}/score?countryCode=IN`).then((r) => r.json());
    // Identical to what the pure engine returns for any other conflict...
    expect(scores.severity.severityScore).toBe(
      computeSeverityScore({ severityLabel: "extreme", status: "active", intensity: 90 }).severityScore,
    );
    expect(scores.severity.severityScore).toBe(100);
    // ...and the generic border floor applies (India borders Myanmar).
    expect(scores.impact.impactScore).toBeGreaterThanOrEqual(75);
    expect(scores.impact.reasons).toContain("Conflict directly borders your country");
  });
});

test("Real Myanmar Now: the live public feed parses through the existing RSSAdapter with bylines, and paid items are flagged, not unlocked", async ({ request }) => {
  const source = await request
    .post("/api/admin/sources", {
      data: {
        name: `Myanmar Now Live ${Date.now()}`,
        type: "rss",
        url: "https://myanmar-now.org/en/feed/",
        country: "MM",
        language: "en",
        sourceCategory: "News",
        sourceRole: "local_media",
        reliabilityTier: "B",
        enabled: true,
        autoIngest: false,
        autoProcessing: true,
      },
    })
    .then((r) => r.json());

  const result = await request.post(`/api/admin/sources/${source.id}/fetch`).then((r) => r.json());
  expect(result.errors).toBe(0);
  expect(result.fetched).toBeGreaterThan(0);

  const items = await request.get(`/api/admin/incoming?sourceId=${source.id}`).then((r) => r.json());
  expect(items.length).toBeGreaterThan(0);
  for (const item of items) {
    expect(item.originalUrl).toMatch(/^https:\/\/myanmar-now\.org\//);
    expect(item.publishedAt).toBeTruthy();
    if (item.rawMetadata?.paidContent) expect(item.rawMetadata.categories).toContain("paid content");
  }
  expect(items.some((i: { rawMetadata?: { author?: string } }) => i.rawMetadata?.author)).toBe(true);
});
