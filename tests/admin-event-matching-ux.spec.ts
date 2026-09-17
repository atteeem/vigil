import { test, expect } from "@playwright/test";

// Deterministic suite for the "Admin Event-Matching UX" stage —
// /admin/incoming's enriched duplicate-candidate display (event type,
// location, event time, match confidence, reasons) and the reviewer's
// two actions (Attach to this event / Create new event, i.e. Publish).
// Uses the local fixture RSS feed (feed-a) for the incoming item under
// review, plus a directly-published reference event to match against —
// no real external source involved.
test.describe.serial("Admin event-matching UX", () => {
  let feedSourceId: string;
  let kyivEventId: string;
  let kyivEventOccurredAt: string;

  test.beforeAll(async ({ request }) => {
    // Warms up Turbopack's compile of the duplicates-check route before any
    // timing-sensitive assertion runs (test 1 waits on the UI's post-click
    // re-check to resolve within toBeVisible()'s default timeout) — the
    // route's first hit in dev mode can itself take several seconds, which
    // would otherwise make a Desktop-first cold-start run flaky for a
    // reason unrelated to the matching logic being tested.
    await request.post("/api/admin/incoming/warmup/duplicates", {
      data: {
        title: "warmup",
        eventType: "other",
        latitude: 0,
        longitude: 0,
        countryCode: null,
        region: null,
        conflictId: null,
        occurredAt: new Date().toISOString(),
      },
    });
  });

  test("setup: a fixture-fed source and a reference published event (drone, near Kyiv)", async ({ request }) => {
    const source = await request
      .post("/api/admin/sources", {
        data: {
          name: `Event-Matching UX Source ${Date.now()}`,
          type: "rss",
          url: "http://localhost:3000/api/test-fixtures/rss/feed-a",
          enabled: true,
          autoIngest: false,
          autoProcessing: true,
        },
      })
      .then((r) => r.json());
    feedSourceId = source.id;

    const fetchResult = await request.post(`/api/admin/sources/${feedSourceId}/fetch`).then((r) => r.json());
    expect(fetchResult.new).toBe(3);

    const items = await request.get(`/api/admin/incoming?sourceId=${feedSourceId}&status=pending`).then((r) => r.json());
    const kyivItem = items.find((i: { originalTitle: string }) => i.originalTitle.includes("Kyiv"));
    kyivEventOccurredAt = new Date().toISOString();
    const published = await request
      .post(`/api/admin/incoming/${kyivItem.id}/publish`, {
        data: {
          title: "Drone strike hits fuel depot near Kyiv (reference event)",
          summary: "Independently written summary for the admin event-matching UX reference event.",
          eventType: "drone",
          latitude: 50.45,
          longitude: 30.52,
          countryCode: "UA",
          region: "Europe",
          occurredAt: kyivEventOccurredAt,
          severity: "elevated",
          importance: 50,
          verificationStatus: "reported",
        },
      })
      .then((r) => r.json());
    kyivEventId = published.id;
    expect(kyivEventId).toBeTruthy();

    // Re-fetch the same feed won't produce new items (guid dedup), so
    // seed a second, textually/geographically similar report directly —
    // this is the one the UI tests below review.
    await request.post("/api/admin/incoming/manual", {
      data: {
        sourceId: feedSourceId,
        externalId: `admin-ux-candidate-${Date.now()}`,
        originalUrl: "https://fixture.test/admin-ux/candidate",
        originalTitle: "Second drone strike reported near Kyiv fuel depot",
        originalText: "A follow-up report describing another drone strike near the same Kyiv fuel depot.",
        publishedAt: new Date(new Date(kyivEventOccurredAt).getTime() + 12 * 60_000).toISOString(),
      },
    });
  });

  test("1. The review screen shows 'Likely existing event' with event type, location, event time, confidence, and reasons", async ({
    page,
    request,
  }) => {
    const items = await request.get(`/api/admin/incoming?sourceId=${feedSourceId}&status=pending`).then((r) => r.json());
    const candidateItem = items.find((i: { originalTitle: string }) => i.originalTitle.includes("Second drone strike"));
    expect(candidateItem).toBeTruthy();

    await page.goto("/admin/incoming");
    const card = page.getByTestId(`incoming-item-${candidateItem.id}`);
    await card.getByRole("button", { name: "Review" }).click();
    await card.getByLabel("Latitude").fill("50.451");
    await card.getByLabel("Longitude").fill("30.521");
    await card.getByRole("button", { name: "Re-check" }).click();

    const candidate = card.getByTestId(`duplicate-candidate-${kyivEventId}`);
    await expect(candidate).toBeVisible();
    await expect(candidate.getByText(/Likely existing event — \d+%/)).toBeVisible();
    await expect(candidate.getByText("Drone strike hits fuel depot near Kyiv (reference event)")).toBeVisible();
    // Event type + location + event time line, e.g. "Drone · UA · just now".
    await expect(candidate.getByText(/Drone · UA/)).toBeVisible();
    // At least one matching-reason chip.
    await expect(candidate.getByText(/apart|away|same event type|title overlap/).first()).toBeVisible();
  });

  test("2. 'Attach to this event' preserves the incoming report and original source, links it as supporting evidence, and creates no duplicate public event", async ({
    page,
    request,
  }) => {
    const items = await request.get(`/api/admin/incoming?sourceId=${feedSourceId}&status=pending`).then((r) => r.json());
    const candidateItem = items.find((i: { originalTitle: string }) => i.originalTitle.includes("Second drone strike"));

    const eventsBefore = await request.get("/api/events").then((r) => r.json());
    const before = eventsBefore.find((e: { id: string }) => e.id === kyivEventId);
    const countBefore = before.sourceCount;
    const totalEventsBefore = eventsBefore.length;

    await page.goto("/admin/incoming");
    const card = page.getByTestId(`incoming-item-${candidateItem.id}`);
    await card.getByRole("button", { name: "Review" }).click();
    await card.getByLabel("Latitude").fill("50.451");
    await card.getByLabel("Longitude").fill("30.521");
    await card.getByRole("button", { name: "Re-check" }).click();

    const candidate = card.getByTestId(`duplicate-candidate-${kyivEventId}`);
    await candidate.getByRole("button", { name: "Attach to this event" }).click();
    await expect(page.getByTestId(`incoming-item-${candidateItem.id}`)).toHaveCount(0);

    // No duplicate public event created.
    const eventsAfter = await request.get("/api/events").then((r) => r.json());
    expect(eventsAfter.length).toBe(totalEventsBefore);
    const after = eventsAfter.find((e: { id: string }) => e.id === kyivEventId);
    expect(after.sourceCount).toBe(countBefore + 1);

    // The incoming report itself is retained (audit trail), not deleted,
    // and its original source/URL is preserved.
    const mergedItems = await request.get("/api/admin/incoming?status=merged").then((r) => r.json());
    const merged = mergedItems.find((i: { id: string }) => i.id === candidateItem.id);
    expect(merged).toBeTruthy();
    expect(merged.originalUrl).toBe(candidateItem.originalUrl);
    expect(merged.originalTitle).toBe(candidateItem.originalTitle);

    // Available as supporting-evidence source attribution on the event detail page.
    await page.goto(`/event/${after.slug}`);
    const sourcesSection = page.locator("li", { hasText: candidateItem.source.name });
    await expect(sourcesSection.filter({ hasText: candidateItem.originalUrl })).toBeVisible();
  });

  test("3. 'Create new event' (Publish) remains available as the alternative to attaching, for a report that is not a duplicate", async ({
    page,
    request,
  }) => {
    const items = await request.get(`/api/admin/incoming?sourceId=${feedSourceId}&status=pending`).then((r) => r.json());
    const bakeryItem = items.find((i: { originalTitle: string }) => i.originalTitle.includes("bakery"));
    expect(bakeryItem).toBeTruthy();

    await page.goto("/admin/incoming");
    const card = page.getByTestId(`incoming-item-${bakeryItem.id}`);
    await card.getByRole("button", { name: "Review" }).click();
    // Override the title before publishing: other suites (classification.spec.ts,
    // multi-source-ingestion.spec.ts) assert against the LIVE /api/events feed that
    // this shared fixture's exact original bakery title is never published anywhere,
    // as proof their own no-auto-publish behavior holds. Publishing it verbatim here
    // would collide with those title-based checks for the rest of this DB's lifetime.
    await card.getByLabel("Title").fill("Local bakery wins national award (admin event-matching UX test)");
    await card.getByLabel("Latitude").fill("51.0");
    await card.getByLabel("Longitude").fill("10.0");

    const [publishResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().includes("/publish") && res.request().method() === "POST"),
      card.getByRole("button", { name: "Publish" }).click(),
    ]);
    const published = await publishResponse.json();
    expect(published.id).toBeTruthy();
    expect(published.id).not.toBe(kyivEventId);

    const events = await request.get("/api/events").then((r) => r.json());
    expect(events.some((e: { id: string }) => e.id === published.id)).toBe(true);
  });
});
