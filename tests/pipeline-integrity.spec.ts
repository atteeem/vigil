import { test, expect } from "@playwright/test";

// Deterministic end-to-end coverage for the "real data pipeline is
// visibly working" milestone: fetched article -> persisted -> visible in
// /admin/incoming -> reviewable/publishable -> published event ->
// visible through the real public data path -> event detail page works,
// plus the icon-fallback bugs found and fixed while verifying that flow
// (unrecognized event types and sources with no configured role must
// never render a blank/missing icon or crash the page). Uses the local
// fixture RSS feed only — see tests/classification.spec.ts's fixture
// pattern; real sources are exercised manually, not by this suite.
test.describe.serial("Stage 1: end-to-end pipeline integrity", () => {
  let sourceId: string;
  let publishedEventId: string;
  let publishedSlug: string;

  test("1. A fetched article persists and appears in /admin/incoming with all required review fields", async ({
    request,
  }) => {
    const source = await request
      .post("/api/admin/sources", {
        data: {
          name: `Pipeline Integrity Feed ${Date.now()}`,
          type: "rss",
          url: "http://localhost:3100/api/test-fixtures/rss/feed-a",
          language: "en",
          sourceCategory: "News",
          sourceRole: "originating",
          reliabilityTier: "A",
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
    expect(fetchResult.new).toBe(3); // feed-a's fixed 3 items — see lib/testing/rss-fixtures.ts

    const items = await request.get(`/api/admin/incoming?sourceId=${sourceId}&status=pending`).then((r) => r.json());
    const kyivItem = items.find((i: { originalTitle: string }) => i.originalTitle.includes("Kyiv"));
    expect(kyivItem).toBeTruthy();
    // Required review-screen fields (spec §2 "Fix /admin/incoming"): headline,
    // source name/category, publication time, original URL, extracted
    // description, detected event type/region, duplicate likelihood, status.
    expect(kyivItem.originalTitle).toBeTruthy();
    expect(kyivItem.source.name).toBeTruthy();
    expect(kyivItem.source.sourceCategory).toBeTruthy();
    expect(kyivItem.publishedAt).toBeTruthy();
    expect(kyivItem.originalUrl).toBeTruthy();
    expect(kyivItem.originalText).toBeTruthy();
    expect(kyivItem.suggestedEventType).toBe("drone");
    expect(kyivItem.duplicateLikelihood).toBeTruthy();
    expect(kyivItem.processingStatus).toBe("pending");
  });

  test("2. Publishing creates a real event reachable through the public /api/events data path, with the original source URL preserved", async ({
    request,
  }) => {
    const items = await request.get(`/api/admin/incoming?sourceId=${sourceId}&status=pending`).then((r) => r.json());
    const kyivItem = items.find((i: { originalTitle: string }) => i.originalTitle.includes("Kyiv"));
    const originalUrl = kyivItem.originalUrl;

    const published = await request
      .post(`/api/admin/incoming/${kyivItem.id}/publish`, {
        data: {
          title: "Pipeline integrity test: drone strike near Kyiv",
          summary: "Independently written summary for the pipeline-integrity end-to-end test.",
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
    publishedEventId = published.id;
    publishedSlug = published.slug;

    const events = await request.get("/api/events").then((r) => r.json());
    const found = events.find((e: { id: string }) => e.id === publishedEventId);
    expect(found).toBeTruthy();
    expect(found.title).toBe("Pipeline integrity test: drone strike near Kyiv");
    expect(found.eventType).toBe("drone");
    expect(found.sources[0].url).toBe(originalUrl);
    expect(found.sources[0].name).toContain("Pipeline Integrity Feed");
  });

  test("3. The published event's detail page renders the correct icon/label for a known event type, with no console errors", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    await page.goto(`/event/${publishedSlug}`);
    await expect(page.getByRole("heading", { name: "Pipeline integrity test: drone strike near Kyiv" })).toBeVisible();
    await expect(page.getByText("Drone", { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("3b. The rendered source link — on both the public event page and the admin event page — uses the exact original fixture article URL, never a placeholder", async ({
    page,
    request,
  }) => {
    // Re-derive the expected URL from the API rather than trusting a
    // variable carried over from test 2 — this test's whole point is to
    // prove the URL survives all the way to a rendered <a href>, so it
    // re-fetches it fresh from the one source of truth (the published
    // event's own sources[]) rather than assuming test 2's read was
    // final.
    const events = await request.get("/api/events").then((r) => r.json());
    const found = events.find((e: { id: string }) => e.id === publishedEventId);
    const expectedUrl = found.sources[0].url;
    // The fixture RSS item's own <link> (lib/testing/rss-fixtures.ts) —
    // distinct from the fixture-serving route's URL (the Source.url this
    // test's source was created with, http://localhost:3100/api/test-
    // fixtures/rss/feed-a) — this is the "real article URL" the pipeline
    // must preserve end to end.
    expect(expectedUrl).toBe("https://fixture.test/feed-a/kyiv-drone");
    expect(expectedUrl).not.toContain("example.com");

    await page.goto(`/event/${publishedSlug}`);
    const publicLink = page.getByRole("link", { name: /Original source/ });
    await expect(publicLink).toHaveAttribute("href", expectedUrl);

    await page.goto(`/admin/events/${publishedEventId}`);
    await expect(page.getByTestId("admin-event-detail")).toBeVisible();
    // The admin event view doesn't render a Sources list of its own (see
    // ARCHITECTURE.md — corroboration is admin-only for now, sources stay
    // on the public page), so the admin-side leg of this proof is the
    // /admin/incoming review screen's "Original source" link instead,
    // which points at the exact same raw item this event was published
    // from.
    const items = await request.get(`/api/admin/incoming?sourceId=${sourceId}&status=published`).then((r) => r.json());
    const publishedItem = items.find((i: { originalTitle: string }) => i.originalTitle.includes("Kyiv"));
    expect(publishedItem.originalUrl).toBe(expectedUrl);

    await page.goto("/admin/incoming");
    await page.getByLabel("Status").selectOption("published");
    const adminLink = page.getByTestId(`incoming-item-${publishedItem.id}`).getByRole("link", { name: /Original source/ });
    await expect(adminLink).toHaveAttribute("href", expectedUrl);
  });

  test("4. An unrecognized/legacy event type never renders a blank icon or crashes the event detail page — falls back to 'Other'", async ({
    request,
    page,
  }) => {
    // The publish route doesn't validate eventType at runtime (SQLite has
    // no enum column type — see prisma/schema.prisma) — this simulates a
    // stray/legacy value a real row could theoretically contain, bypassing
    // the TypeScript union that normal admin-UI usage can't violate.
    const items = await request.get(`/api/admin/incoming?sourceId=${sourceId}&status=pending`).then((r) => r.json());
    const item = items[0];
    expect(item).toBeTruthy();

    const published = await request
      .post(`/api/admin/incoming/${item.id}/publish`, {
        data: {
          title: "Pipeline integrity test: unrecognized event type",
          summary: "Independently written summary for the unknown-event-type fallback test.",
          eventType: "not-a-real-event-type",
          latitude: 10,
          longitude: 10,
          occurredAt: new Date().toISOString(),
          severity: "elevated",
          importance: 50,
        },
      })
      .then((r) => r.json());
    expect(published.eventType).toBe("not-a-real-event-type"); // stored as-is, never silently corrected

    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    await page.goto(`/event/${published.slug}`);
    await expect(page.getByRole("heading", { name: "Pipeline integrity test: unrecognized event type" })).toBeVisible();
    await expect(page.getByText("Other", { exact: true })).toBeVisible(); // fallback label, never blank
    expect(errors).toEqual([]);
  });

  test("5. A source with no configured role renders a generic fallback icon on /admin/sources, not a blank/broken one", async ({
    request,
    page,
  }) => {
    const noRoleName = `Pipeline Integrity No-Role Source ${Date.now()}`;
    await request.post("/api/admin/sources", {
      data: {
        name: noRoleName,
        type: "rss",
        url: "http://localhost:3100/api/test-fixtures/rss/feed-b",
        enabled: true,
        autoIngest: false,
        autoProcessing: true,
        // sourceRole intentionally omitted.
      },
    });

    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    await page.goto("/admin/sources");
    // Source rows render as a <tr> on desktop and a separate <div> card
    // list on mobile (only one is visible at a given viewport); :visible
    // avoids a strict-mode violation from matching both.
    const row = page.locator(`[data-testid^="source-row-"]:visible`, { hasText: noRoleName });
    await expect(row).toBeVisible();
    await expect(row.getByText("Unclassified", { exact: true })).toBeVisible();
    // The fallback icon is an <svg>, same as every classified role's icon
    // — never an empty cell.
    await expect(row.locator("svg").first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("6. Real-world disaster/health source wording classifies into the new event-type categories instead of falling through to 'other'", async ({
    request,
  }) => {
    // Regression test for the exact bug found live: GDACS Disaster
    // Alerts' real wording ("forest fire notification", not "wildfire";
    // "flood alert"; "earthquake (Magnitude...)"; "tropical cyclone") and
    // WHO News' real wording ("World Health Assembly") were all
    // classifying as "other" before lib/ingestion/event-type-keywords.ts
    // and lib/types/severity.ts's EVENT_TYPES were extended.
    const source = await request
      .post("/api/admin/sources", {
        data: {
          name: `Pipeline Integrity Disaster Wording ${Date.now()}`,
          type: "manual",
          enabled: true,
          autoIngest: false,
          autoProcessing: true,
        },
      })
      .then((r) => r.json());

    const samples: [string, string][] = [
      ["Green forest fire notification in Zambia", "fire"],
      ["Green flood alert in United States", "flood"],
      ["Green earthquake (Magnitude 5.5M, Depth:10km) in South Of Java, Indonesia", "earthquake"],
      ["Green notification for tropical cyclone NORBERT-26", "storm"],
      ["Drought is on going in Kenya, Somalia", "humanitarian"],
      ["Governments agree on pandemic agreement ahead of the World Health Assembly", "health"],
    ];

    for (const [title, expectedType] of samples) {
      const item = await request
        .post("/api/admin/incoming/manual", {
          data: {
            sourceId: source.id,
            externalId: `disaster-wording-${expectedType}-${Date.now()}`,
            originalUrl: `https://fixture.test/disaster/${expectedType}`,
            originalTitle: title,
            originalText: title,
            publishedAt: new Date().toISOString(),
          },
        })
        .then((r) => r.json());
      const draft = await request.get(`/api/admin/incoming/${item.id}/draft`).then((r) => r.json());
      expect(draft.draft.eventType, `"${title}" should classify as ${expectedType}`).toBe(expectedType);
    }
  });
});
