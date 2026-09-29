import { test, expect } from "@playwright/test";
import { prisma } from "@/lib/db/client";

// Deterministic suite for the "Admin Event-Matching UX" stage —
// /admin/incoming's enriched duplicate-candidate display (event type,
// location, event time, match confidence, reasons) and the reviewer's
// two actions (Attach to this event / Create new event, i.e. Publish).
// Uses the local fixture RSS feed (feed-a) for the incoming item under
// review, plus a directly-published reference event to match against —
// no real external source involved.
test.describe.serial("Admin event-matching UX", () => {
  // Chromium's isMobile:true viewport emulation desyncs the visual/layout viewport after an auto-scroll,
  // making Playwright miss real click targets on /admin/incoming's row buttons — a confirmed emulation
  // artifact (see tests/admin.spec.ts's "Admin Source Manager" describe block for the full diagnosis),
  // not a real device's behavior. Keeps every other Pixel 7 trait (viewport, UA, touch, DPR).
  test.use({ isMobile: false });
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
          url: "http://localhost:3100/api/test-fixtures/rss/feed-a",
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
    await card.getByLabel("Geographic scope").selectOption("point");
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
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    const items = await request.get(`/api/admin/incoming?sourceId=${feedSourceId}&status=pending`).then((r) => r.json());
    const candidateItem = items.find((i: { originalTitle: string }) => i.originalTitle.includes("Second drone strike"));

    const eventsBefore = await request.get("/api/events").then((r) => r.json());
    const totalEventsBefore = eventsBefore.length;
    // Raw EventSource link count, not the public API's independentSourceCount — both reports here
    // deliberately share the same admin Source record (feedSourceId), so independence-wise they're
    // correctly ONE group either way (lib/data/independence.ts's "one outlet = one group" rule); what this
    // regression actually checks is that the SECOND link is recorded and rendered at all (the React
    // duplicate-key bug this test guards against was about the raw links list, not independence counting).
    const linksBefore = await prisma.eventSource.count({ where: { eventId: kyivEventId } });

    await page.goto("/admin/incoming");
    const card = page.getByTestId(`incoming-item-${candidateItem.id}`);
    await card.getByRole("button", { name: "Review" }).click();
    await card.getByLabel("Geographic scope").selectOption("point");
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
    const linksAfter = await prisma.eventSource.count({ where: { eventId: kyivEventId } });
    expect(linksAfter).toBe(linksBefore + 1);

    // The incoming report itself is retained (audit trail), not deleted,
    // and its original source/URL is preserved.
    const mergedItems = await request.get("/api/admin/incoming?status=merged").then((r) => r.json());
    const merged = mergedItems.find((i: { id: string }) => i.id === candidateItem.id);
    expect(merged).toBeTruthy();
    expect(merged.originalUrl).toBe(candidateItem.originalUrl);
    expect(merged.originalTitle).toBe(candidateItem.originalTitle);

    // Available as supporting-evidence source attribution on the event detail page.
    // Regression coverage: this event now has TWO sources links from the
    // SAME underlying Source (feedSourceId) — the originating Kyiv report
    // and this attached one — which previously triggered a React
    // "duplicate key" console error in the Sources list (it was keyed by
    // the Source's own id, not something unique per link; see
    // components/events/event-detail-panel.tsx).
    await page.goto(`/event/${after.slug}`);
    const sourcesSection = page.locator("li", { hasText: candidateItem.source.name });
    await expect(sourcesSection).toHaveCount(2);
    await expect(sourcesSection.filter({ hasText: candidateItem.originalUrl })).toBeVisible();
    expect(errors.filter((e) => e.includes("same key"))).toEqual([]);
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
    await card.getByLabel("Geographic scope").selectOption("point");
    await card.getByLabel("Latitude").fill("51.0");
    await card.getByLabel("Longitude").fill("10.0");

    const [publishResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().includes("/publish") && res.request().method() === "POST"),
      card.getByRole("button", { name: "Publish" }).click(),
    ]);
    const published = await publishResponse.json();
    expect(published.id).toBeTruthy();
    expect(published.id).not.toBe(kyivEventId);

    // Not /api/events (bounded to the last 45 days): this fixture's pubDate is fixed at 2026-01-01, which
    // is well outside that window by now, so a real published-and-public event would still legitimately
    // never appear there — the actual thing this test checks (a genuine, published, non-duplicate Event
    // row exists) is a direct lookup, unaffected by the public feed's own recency bound.
    const createdEvent = await prisma.event.findUnique({ where: { id: published.id } });
    expect(createdEvent?.published).toBe(true);
  });
});
