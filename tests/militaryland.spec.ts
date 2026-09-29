import { test, expect } from "@playwright/test";

// MilitaryLand Phase 1 — the RSS-adapter source-integration path (no new
// adapter needed: militaryland.net serves standard WordPress RSS, verified
// live before this milestone), the deterministic unit/commander/equipment
// entity extraction (lib/military/extract-entities.ts), and the
// article->entity linking it drives. Uses the local fixture feed
// (lib/testing/rss-fixtures.ts's "militaryland-feed") for deterministic
// coverage; the last test hits the real live site once as the "one real
// MilitaryLand news article" proof (spec "Initial verification"), mirroring
// how tests/rss-ingestion.live.spec.ts is the one real-network proof for the
// core RSS path while everything else uses fixtures.
test.describe.serial("MilitaryLand Phase 1", () => {
  let sourceId: string;

  test("1. Source ingestion: MilitaryLand's WordPress RSS feed is fetched via the existing RSSAdapter, no new adapter needed", async ({
    request,
  }) => {
    const source = await request
      .post("/api/admin/sources", {
        data: {
          name: `MilitaryLand Fixture Feed ${Date.now()}`,
          type: "rss",
          url: "http://localhost:3100/api/test-fixtures/rss/militaryland-feed",
          language: "en",
          sourceCategory: "Military Analysis",
          sourceRole: "local_media",
          reliabilityTier: "B",
          enabled: true,
          autoIngest: false,
          autoProcessing: true,
        },
      })
      .then((r) => r.json())
      .then((s) => s.id);
    sourceId = source;

    const fetchResult = await request.post(`/api/admin/sources/${sourceId}/fetch`).then((r) => r.json());
    expect(fetchResult.errors).toBe(0);
    expect(fetchResult.new).toBe(2); // militaryland-feed's fixed 2 items

    // Fetching again must not create duplicates (dedup, spec "no
    // duplicate entities" at the article level too).
    const secondFetch = await request.post(`/api/admin/sources/${sourceId}/fetch`).then((r) => r.json());
    expect(secondFetch.new).toBe(0);
    expect(secondFetch.alreadyKnown).toBe(2);
  });

  test("2. URL/provenance preservation: the real article URL survives ingestion unchanged", async ({ request }) => {
    const items = await request.get(`/api/admin/incoming?sourceId=${sourceId}`).then((r) => r.json());
    expect(items.length).toBe(2);
    const bohdanaItem = items.find((i: { originalTitle: string }) => i.originalTitle.includes("Bohdana artillery"));
    expect(bohdanaItem).toBeTruthy();
    expect(bohdanaItem.originalUrl).toBe("https://fixture.test/militaryland/25th-airborne-bohdana");
    expect(bohdanaItem.source.name).toContain("MilitaryLand");
  });

  test("3. Entity extraction creates unit/equipment/commander reference entities with real names and source provenance", async ({
    request,
  }) => {
    const units = await request.get("/api/admin/military-units").then((r) => r.json());
    const airborne = units.filter((u: { name: string }) => u.name === "25th Airborne Brigade");
    expect(airborne.length).toBe(1); // exactly one, never duplicated
    expect(airborne[0].sourceUrl).toBeTruthy();

    const equipment = await request.get("/api/admin/military-equipment").then((r) => r.json());
    const bohdana = equipment.filter((e: { name: string }) => e.name === "2P22 Bohdana");
    expect(bohdana.length).toBe(1);
    expect(bohdana[0].category).toBe("Towed Artillery");

    const commanders = await request.get("/api/admin/commanders").then((r) => r.json());
    const zaits = commanders.filter((c: { name: string }) => c.name === "Svyatoslav Zaits");
    expect(zaits.length).toBe(1);
    expect(zaits[0].rank).toBe("Brigadier General");
  });

  test("4. Entity deduplication: the SAME unit/commander/equipment mentioned across two separate articles resolves to one row each, not two", async ({
    request,
  }) => {
    // Both fixture items mention "25th Airborne Brigade", "Svyatoslav
    // Zaits", and "2P22 Bohdana" — test 3 already proved there's exactly
    // one of each; this test proves BOTH articles link to that same one
    // row (not one each), via the article->entity join tables.
    const items = await request.get(`/api/admin/incoming?sourceId=${sourceId}`).then((r) => r.json());
    expect(items.length).toBe(2);

    const linkSets = await Promise.all(
      items.map((i: { id: string }) => request.get(`/api/admin/incoming/${i.id}/military-links`).then((r) => r.json())),
    );
    for (const links of linkSets) {
      expect(links.units.some((u: { name: string }) => u.name === "25th Airborne Brigade")).toBe(true);
      expect(links.commanders.some((c: { name: string }) => c.name === "Svyatoslav Zaits")).toBe(true);
      expect(links.equipment.some((e: { name: string }) => e.name === "2P22 Bohdana")).toBe(true);
    }
    // Both articles' unit link resolves to the SAME MilitaryUnit id —
    // the actual dedup proof, not just "a unit with this name exists".
    const unitIds = linkSets.map((l) => l.units.find((u: { name: string }) => u.name === "25th Airborne Brigade").id);
    expect(unitIds[0]).toBe(unitIds[1]);
  });

  test("5. Article -> entity linking: a MilitaryLand article can still enter the normal Vigil pipeline (review, publish) unaffected by entity extraction", async ({
    request,
  }) => {
    const items = await request.get(`/api/admin/incoming?sourceId=${sourceId}&status=pending`).then((r) => r.json());
    const item = items[0];
    expect(item.suggestedEventType).toBeTruthy(); // the normal draft-extraction pipeline still ran

    const publishRes = await request.post(`/api/admin/incoming/${item.id}/publish`, {
      data: {
        title: item.originalTitle,
        summary: item.originalText,
        latitude: 48.9,
        longitude: 24.7,
        eventType: "other",
        occurredAt: new Date().toISOString(),
        severity: "guarded",
      },
    });
    expect(publishRes.ok()).toBeTruthy();
    const publishedId = (await publishRes.json()).id;

    const events = await request.get("/api/events").then((r) => r.json());
    const found = events.find((e: { id: string }) => e.id === publishedId);
    expect(found).toBeTruthy();
    expect(found.sources[0].url).toBe(item.originalUrl);
  });

  test("6. Real MilitaryLand article: the live site's own RSS feed is a valid, currently-reachable WordPress feed the RSSAdapter parses unmodified", async ({
    request,
  }) => {
    const source = await request
      .post("/api/admin/sources", {
        data: {
          name: `MilitaryLand News Live ${Date.now()}`,
          type: "rss",
          url: "https://militaryland.net/feed/",
          language: "en",
          sourceCategory: "Military Analysis",
          sourceRole: "local_media",
          reliabilityTier: "B",
          enabled: true,
          autoIngest: false,
          autoProcessing: true,
        },
      })
      .then((r) => r.json())
      .then((s) => s.id);

    const fetchResult = await request.post(`/api/admin/sources/${source}/fetch`).then((r) => r.json());
    expect(fetchResult.errors).toBe(0);
    expect(fetchResult.fetched).toBeGreaterThan(0);

    const items = await request.get(`/api/admin/incoming?sourceId=${source}`).then((r) => r.json());
    expect(items.length).toBeGreaterThan(0);
    // A real MilitaryLand article URL, not a fixture/placeholder one.
    expect(items[0].originalUrl).toMatch(/^https:\/\/militaryland\.net\//);
  });
});
