import { test, expect } from "@playwright/test";

// Core deterministic suite for the "real multi-source live ingestion"
// milestone (scheduler, source health, per-source failure isolation,
// automated processing snapshots, source trust model, and the
// scheduler-driven variant of source independence). Every source here
// points at the local fixture RSS route (app/api/test-fixtures/rss/[name])
// or a deliberately-broken/slow variant of it — never a real external
// feed — so this suite is immune to the live sources' network state.
// Real sources (BBC World, Al Jazeera, etc., seeded in prisma/seed.mjs)
// are exercised manually/as a smoke check; see the milestone's final
// report for their live status.
test.describe.serial("Multi-source live ingestion", () => {
  let feedASourceId: string;
  let feedBSourceId: string;
  let brokenSourceId: string;
  let slowSourceId: string;

  test("0. Independent test-scoped sources can be created for feed A, feed B, a broken feed, and a slow feed", async ({
    request,
  }) => {
    const base = "http://localhost:3000/api/test-fixtures/rss";
    const common = {
      type: "rss" as const,
      language: "en",
      sourceCategory: "News",
      reliabilityTier: "A",
      enabled: true,
      autoIngest: true,
      autoProcessing: true,
      pollIntervalMinutes: 999, // large — a polled source should not be due again within this test run
    };

    feedASourceId = await request
      .post("/api/admin/sources", { data: { ...common, name: `Multi-source Feed A ${Date.now()}`, url: `${base}/feed-a` } })
      .then((r) => r.json())
      .then((s) => s.id);
    feedBSourceId = await request
      .post("/api/admin/sources", { data: { ...common, name: `Multi-source Feed B ${Date.now()}`, url: `${base}/feed-b` } })
      .then((r) => r.json())
      .then((s) => s.id);
    brokenSourceId = await request
      .post("/api/admin/sources", { data: { ...common, name: `Multi-source Broken ${Date.now()}`, url: `${base}/does-not-exist` } })
      .then((r) => r.json())
      .then((s) => s.id);
    slowSourceId = await request
      .post("/api/admin/sources", { data: { ...common, name: `Multi-source Slow ${Date.now()}`, url: `${base}/feed-a?delayMs=3000` } })
      .then((r) => r.json())
      .then((s) => s.id);

    expect(feedASourceId).toBeTruthy();
    expect(feedBSourceId).toBeTruthy();
    expect(brokenSourceId).toBeTruthy();
    expect(slowSourceId).toBeTruthy();
  });

  test("1. Scheduler tick polls due sources concurrently, ingesting each feed independently", async ({ request }) => {
    // sourceIds scopes the tick to just these test sources — otherwise a
    // tick also polls every real live source (BBC, Al Jazeera, etc.),
    // which is slow, non-deterministic, and needlessly hammers external
    // feeds on every test run (see lib/ingestion/scheduler.ts's doc).
    const res = await request.post("/api/admin/scheduler/tick", {
      data: { sourceIds: [feedASourceId, feedBSourceId] },
    });
    const result = await res.json();
    expect(result.due).toBe(2);
    expect(result.polled).toBe(2);
    expect(result.skippedInFlight).toBe(0);

    const feedAItems = await request
      .get(`/api/admin/incoming?sourceId=${feedASourceId}&status=pending`)
      .then((r) => r.json());
    expect(feedAItems.map((i: { originalTitle: string }) => i.originalTitle).sort()).toEqual(
      [
        "Drone strike hits fuel depot near Kyiv",
        "Heavy shelling reported near Novoselivka overnight",
        "Unrelated feature: local bakery wins national award",
      ].sort(),
    );

    const feedBItems = await request
      .get(`/api/admin/incoming?sourceId=${feedBSourceId}&status=pending`)
      .then((r) => r.json());
    expect(feedBItems.map((i: { originalTitle: string }) => i.originalTitle).sort()).toEqual(
      ["Naval incident reported near Odesa port", "Diplomatic talks scheduled in Geneva"].sort(),
    );
  });

  test("2. A just-polled source is not due again immediately (nextPollAt advanced by its own interval)", async ({
    request,
  }) => {
    const sources = await request.get("/api/admin/sources").then((r) => r.json());
    const feedA = sources.find((s: { id: string }) => s.id === feedASourceId);
    expect(feedA.nextPollAt).toBeTruthy();
    expect(new Date(feedA.nextPollAt).getTime()).toBeGreaterThan(Date.now());

    const res = await request.post("/api/admin/scheduler/tick", { data: { sourceIds: [feedASourceId] } });
    const result = await res.json();
    expect(result.due).toBe(0); // pollIntervalMinutes: 999 keeps it far from due again
    expect(result.polled).toBe(0);
  });

  test("3. Source failure isolation: a broken source's error does not prevent a healthy source in the same tick from succeeding", async ({
    request,
  }) => {
    const isolationSourceId: string = await request
      .post("/api/admin/sources", {
        data: {
          name: `Multi-source Isolation Check ${Date.now()}`,
          type: "rss",
          url: "http://localhost:3000/api/test-fixtures/rss/feed-b",
          enabled: true,
          autoIngest: true,
          autoProcessing: true,
          pollIntervalMinutes: 999,
        },
      })
      .then((r) => r.json())
      .then((s) => s.id);

    const res = await request.post("/api/admin/scheduler/tick", {
      data: { sourceIds: [brokenSourceId, isolationSourceId] },
    });
    const result = await res.json();
    expect(result.due).toBe(2);
    expect(result.polled).toBe(2); // both attempted — one succeeding never blocks the other from being tried

    const sources = await request.get("/api/admin/sources").then((r) => r.json());
    const broken = sources.find((s: { id: string }) => s.id === brokenSourceId);
    const healthy = sources.find((s: { id: string }) => s.id === isolationSourceId);
    expect(broken.health).toBe("error");
    expect(broken.lastError).toContain("404");
    expect(healthy.health).toBe("live");
    expect(healthy.itemsToday).toBeGreaterThanOrEqual(2);
  });

  test("4. Overlap prevention: two scheduler ticks firing while a source is still mid-fetch only poll it once", async ({
    request,
  }) => {
    // Staggered, not simultaneous: the first tick's due-query + in-flight
    // marking (a DB round-trip plus a sync loop, milliseconds) reliably
    // completes well before the fixture's artificial 3s delay resolves —
    // firing both requests in the exact same instant would race on
    // whether either has reached inFlightSourceIds.add() yet, since both
    // are separate async route invocations. A 300ms stagger makes "the
    // second tick arrives while the first is still fetching" deterministic
    // instead of a coin flip, matching the real scenario this guards
    // (a tick firing again before a slow source's previous poll finished).
    const firstPromise = request.post("/api/admin/scheduler/tick", { data: { sourceIds: [slowSourceId] } });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const secondPromise = request.post("/api/admin/scheduler/tick", { data: { sourceIds: [slowSourceId] } });
    const [firstRes, secondRes] = await Promise.all([firstPromise, secondPromise]);
    const [first, second] = await Promise.all([firstRes.json(), secondRes.json()]);

    // Both ticks see the source as due (the in-flight guard isn't reflected
    // in the where-clause), but only one of them actually polls it — the
    // other must report it as skipped, never both polling it.
    expect(first.due).toBe(1);
    expect(second.due).toBe(1);
    const totalPolled = first.polled + second.polled;
    const totalSkipped = first.skippedInFlight + second.skippedInFlight;
    expect(totalPolled).toBe(1);
    expect(totalSkipped).toBe(1);
  });

  test("5. Processing after ingestion: autoProcessing sources get a suggestion snapshot automatically; autoProcessing:false sources don't", async ({
    request,
  }) => {
    const feedAItems = await request
      .get(`/api/admin/incoming?sourceId=${feedASourceId}&status=pending`)
      .then((r) => r.json());
    const kyivItem = feedAItems.find((i: { originalTitle: string }) => i.originalTitle.includes("Kyiv"));
    expect(kyivItem.suggestedEventType).toBe("drone");
    expect(kyivItem.locationSource).toBe("resolved");
    expect(kyivItem.processedAt).toBeTruthy();

    const noProcessingSourceId: string = await request
      .post("/api/admin/sources", {
        data: {
          name: `Multi-source No Processing ${Date.now()}`,
          type: "rss",
          url: "http://localhost:3000/api/test-fixtures/rss/feed-b",
          enabled: true,
          autoIngest: true,
          autoProcessing: false,
          pollIntervalMinutes: 999,
        },
      })
      .then((r) => r.json())
      .then((s) => s.id);
    await request.post("/api/admin/scheduler/tick", { data: { sourceIds: [noProcessingSourceId] } });

    const unprocessedItems = await request
      .get(`/api/admin/incoming?sourceId=${noProcessingSourceId}&status=pending`)
      .then((r) => r.json());
    expect(unprocessedItems.length).toBeGreaterThan(0);
    for (const item of unprocessedItems) {
      expect(item.suggestedEventType).toBeNull();
      expect(item.processedAt).toBeNull();
    }
  });

  test("6. Source health: GET /api/admin/sources reports last-attempt/last-success/next-poll/today's counts correctly", async ({
    request,
  }) => {
    const sources = await request.get("/api/admin/sources").then((r) => r.json());
    const feedA = sources.find((s: { id: string }) => s.id === feedASourceId);
    expect(feedA.lastSuccessfulIngestion).toBeTruthy();
    expect(feedA.lastAttemptedAt).toBeTruthy();
    expect(feedA.nextPollAt).toBeTruthy();
    expect(feedA.health).toBe("live");
    expect(feedA.itemsToday).toBeGreaterThanOrEqual(3);
    expect(feedA.newItemsToday).toBeGreaterThanOrEqual(3);
    expect(feedA.errorsToday).toBe(0);
  });

  test("7. Source independence via the scheduler path: a relay merge of a scheduler-ingested item does not increase source count", async ({
    request,
  }) => {
    const feedAItems = await request
      .get(`/api/admin/incoming?sourceId=${feedASourceId}&status=pending`)
      .then((r) => r.json());
    const kyivItem = feedAItems.find((i: { originalTitle: string }) => i.originalTitle.includes("Kyiv"));

    const published = await request
      .post(`/api/admin/incoming/${kyivItem.id}/publish`, {
        data: {
          title: "Multi-source independence test event",
          summary: "Independently written summary for the scheduler-path independence test.",
          eventType: "drone",
          latitude: 50.45,
          longitude: 30.52,
          countryCode: "UA",
          region: "Europe",
          occurredAt: new Date().toISOString(),
          severity: "elevated",
          importance: 50,
          verificationStatus: "reported",
        },
      })
      .then((r) => r.json());
    // The publish route returns the raw Event row (no computed fields) —
    // sourceCount only exists on /api/events' DTO, so read it back from
    // there rather than assuming it's on the publish response.
    const eventsBeforeMerge = await request.get("/api/events").then((r) => r.json());
    const beforeMerge = eventsBeforeMerge.find((e: { id: string }) => e.id === published.id);
    expect(beforeMerge.sourceCount).toBe(1);

    const feedBItems = await request
      .get(`/api/admin/incoming?sourceId=${feedBSourceId}&status=pending`)
      .then((r) => r.json());
    // Pick the naval item specifically, not [0] — test 9 needs the
    // Geneva item to still be pending afterward.
    const relayItem = feedBItems.find((i: { originalTitle: string }) => i.originalTitle.includes("Naval"));

    const mergeRes = await request.post(`/api/admin/incoming/${relayItem.id}/merge`, {
      data: { eventId: published.id, relationship: "relay" },
    });
    expect(mergeRes.ok()).toBeTruthy();

    const events = await request.get("/api/events").then((r) => r.json());
    const after = events.find((e: { id: string }) => e.id === published.id);
    expect(after.sourceCount).toBe(1); // relay attaches provenance without inflating independent-source count
  });

  test("8. No auto-publishing: scheduler-ingested items never appear in /api/events without an explicit Publish", async ({
    request,
  }) => {
    const feedAItems = await request
      .get(`/api/admin/incoming?sourceId=${feedASourceId}&status=pending`)
      .then((r) => r.json());
    expect(feedAItems.length).toBeGreaterThan(0); // still-pending items exist from test 1

    const events = await request.get("/api/events").then((r) => r.json());
    for (const item of feedAItems) {
      expect(events.some((e: { title: string }) => e.title === item.originalTitle)).toBe(false);
    }
  });

  test("9. Live map refresh: a newly published event is immediately present in the same /api/events response /world polls", async ({
    request,
  }) => {
    const feedBItems = await request
      .get(`/api/admin/incoming?sourceId=${feedBSourceId}&status=pending`)
      .then((r) => r.json());
    const genevaItem = feedBItems.find((i: { originalTitle: string }) => i.originalTitle.includes("Geneva"));
    expect(genevaItem).toBeTruthy();

    const beforeEvents = await request.get("/api/events").then((r) => r.json());
    const countBefore = beforeEvents.length;

    const published = await request
      .post(`/api/admin/incoming/${genevaItem.id}/publish`, {
        data: {
          title: "Multi-source map-refresh test event",
          summary: "Independently written summary for the map-refresh test.",
          eventType: "diplomacy",
          latitude: 46.2,
          longitude: 6.14,
          countryCode: "CH",
          region: "Europe",
          occurredAt: new Date().toISOString(),
          severity: "guarded",
          importance: 40,
          verificationStatus: "reported",
        },
      })
      .then((r) => r.json());

    const afterEvents = await request.get("/api/events").then((r) => r.json());
    expect(afterEvents.length).toBe(countBefore + 1);
    expect(afterEvents.some((e: { id: string }) => e.id === published.id)).toBe(true);
  });
});
