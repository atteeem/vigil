import { test, expect } from "@playwright/test";

// Proves the first real external-source ingestion workflow end-to-end
// against the actual BBC World RSS feed (spec: "Implement Vigil's first
// real external-source ingestion proof"). This hits a live network
// endpoint deliberately — that's the point of a *real* ingestion proof —
// so assertions avoid depending on specific article titles/counts that
// change as the real feed updates; they check structure and invariants
// (dedup, no-auto-publish, source attribution) instead.
test.describe.serial("RSS ingestion proof (BBC World)", () => {
  let bbcSourceId: string;

  test("1. BBC World RSS source exists, configured per spec", async ({ request }) => {
    const res = await request.get("/api/admin/sources");
    const sources = await res.json();
    const bbc = sources.find((s: { name: string }) => s.name === "BBC World");
    expect(bbc).toBeTruthy();
    expect(bbc.type).toBe("rss");
    expect(bbc.url).toBe("https://feeds.bbci.co.uk/news/world/rss.xml");
    expect(bbc.language).toBe("en");
    expect(bbc.sourceCategory).toBe("News");
    expect(bbc.reliabilityTier).toBe("A");
    expect(bbc.enabled).toBe(true);
    expect(bbc.autoIngest).toBe(true);
    bbcSourceId = bbc.id;
  });

  test("2. Fetch Now ingests real items with zero errors", async ({ request }) => {
    const res = await request.post(`/api/admin/sources/${bbcSourceId}/fetch`);
    expect(res.ok()).toBeTruthy();
    const result = await res.json();
    expect(result.errors).toBe(0);
    expect(result.fetched).toBeGreaterThan(0);
    expect(result.fetched).toBe(result.alreadyKnown + result.new);
  });

  test("4. A second fetch creates zero new items (dedup on source_id + external_id)", async ({ request }) => {
    const res = await request.post(`/api/admin/sources/${bbcSourceId}/fetch`);
    const result = await res.json();
    expect(result.errors).toBe(0);
    expect(result.new).toBe(0);
    expect(result.alreadyKnown).toBe(result.fetched);
  });

  test("3. New RSS entries appear in /admin/incoming with required fields", async ({ page }) => {
    await page.goto("/admin/incoming");
    const bbcCard = page.locator('[data-testid^="incoming-item-"]', { hasText: "BBC World" }).first();
    await expect(bbcCard).toBeVisible();
    await expect(bbcCard.getByRole("link", { name: /Original source/ })).toBeVisible();
    await expect(bbcCard.getByRole("button", { name: "Review" })).toBeVisible();
    await expect(bbcCard.getByRole("button", { name: "Reject" })).toBeVisible();
  });

  // Chromium's isMobile:true viewport emulation desyncs the visual/layout viewport after this form's
  // scrollIntoView-driven scroll, missing real click/fill targets on /admin/incoming — a confirmed
  // emulation artifact, not a real device's behavior (see tests/admin.spec.ts's "Admin Source Manager"
  // describe block for the full diagnosis). Scoped narrowly (not file-wide) because test "8-9." below
  // reads the isMobile fixture itself for its own conditional logic.
  test.describe("review-form click workaround", () => {
    test.use({ isMobile: false });

    test("5-7. Review opens, fields are editable, Conflict picker offers Russia–Ukraine, Publish creates a real event", async ({
      page,
      request,
    }) => {
      // Pick a raw item directly via the API — deterministic id, avoids
      // depending on which specific BBC headline is first in the feed today.
      const itemsRes = await request.get("/api/admin/incoming?status=pending");
    const items = await itemsRes.json();
    const bbcItem = items.find((i: { source: { name: string } }) => i.source.name === "BBC World");
    expect(bbcItem).toBeTruthy();

    await page.goto("/admin/incoming");
    const card = page.getByTestId(`incoming-item-${bbcItem.id}`);
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Review" }).click();

    // Independently-paraphrased summary — never the raw RSS description
    // verbatim (spec §1 "Public Vigil event summaries must be
    // independently written/paraphrased").
    const summaryBox = card.getByLabel("Summary");
    await summaryBox.fill("Independently summarized for Vigil from a BBC World report (ingestion proof test).");
    await card.getByLabel("Event type").selectOption("other");

    const conflictSelect = card.getByLabel("Conflict", { exact: true });
    await expect(conflictSelect.locator("option", { hasText: "Russia–Ukraine War" })).toHaveCount(1);
    await conflictSelect.selectOption({ label: "Russia–Ukraine War" });

    await card.getByLabel("Geographic scope").selectOption("point");
    await card.getByLabel("Latitude").fill("50.45");
    await card.getByLabel("Longitude").fill("30.52");
    await card.getByLabel("Country code").fill("UA");
    await card.getByLabel("Region").fill("Europe");

    await card.getByRole("button", { name: "Publish" }).click();
    await expect(page.getByTestId(`incoming-item-${bbcItem.id}`)).toHaveCount(0);

    // 6/7. Event exists, published, correctly attributed, conflict stored.
    const eventsRes = await request.get("/api/events");
    const events = await eventsRes.json();
    const published = events.find((e: { title: string }) => e.title === bbcItem.originalTitle);
    expect(published).toBeTruthy();
    expect(published.lat).toBe(50.45);
    expect(published.lng).toBe(30.52);
    expect(published.sources[0].name).toBe("BBC World");
    expect(published.sources[0].sourceType).toBe("News");
    expect(published.sources[0].url).toBe(bbcItem.originalUrl);
    expect(published.sourceCount).toBe(1);

    // 11. Event detail page shows full source attribution — scoped to the
    // Sources section specifically, since the (independently-written)
    // summary text above it also legitimately mentions "BBC World".
    await page.goto(`/event/${published.slug}`);
    const sourcesSection = page.locator("li", { hasText: "Originating report" });
    await expect(sourcesSection.getByText("BBC World")).toBeVisible();
    await expect(sourcesSection.getByText("Source type: News")).toBeVisible();
    await expect(sourcesSection.getByText(/^Published:/)).toBeVisible();
    await expect(
      sourcesSection.getByRole("link", {
        name: new RegExp(`Original source: ${bbcItem.originalUrl!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
      }),
    ).toBeVisible();
    await expect(sourcesSection.getByText("Originating report")).toBeVisible();
    });
  });

  test("8-9. Published event appears on /world map and in the chronological feed", async ({ page, request, isMobile }) => {
    if (isMobile) {
      // Desktop-only feed column — mobile uses a bottom sheet instead
      // (same root cause map.spec.ts's mobile skips document).
      test.skip();
    }
    const eventsRes = await request.get("/api/events");
    const events = await eventsRes.json();
    const published = events.find((e: { conflictId: string | null }) => e.conflictId !== null);
    expect(published).toBeTruthy();

    await page.goto("/world");
    await page.getByRole("radiogroup", { name: "Time" }).getByRole("radio", { name: "7D" }).click();
    await page.getByRole("radiogroup", { name: "Region" }).getByRole("radio", { name: "Europe" }).click();
    await page.getByTestId("left-tab-events").click();
    await expect(page.getByRole("heading", { name: published.title })).toBeVisible({ timeout: 10_000 });
  });

  test("12. Reject leaves the item stored but never creates a public event", async ({ page, request }) => {
    const itemsRes = await request.get("/api/admin/incoming?status=pending");
    const items = await itemsRes.json();
    const bbcItem = items.find((i: { source: { name: string } }) => i.source.name === "BBC World");
    expect(bbcItem).toBeTruthy();

    await page.goto("/admin/incoming");
    const card = page.getByTestId(`incoming-item-${bbcItem.id}`);
    await card.getByRole("button", { name: "Reject" }).click();
    await expect(page.getByTestId(`incoming-item-${bbcItem.id}`)).toHaveCount(0);

    // Still in the DB (audit trail), just not pending and not published.
    const rejectedRes = await request.get("/api/admin/incoming?status=rejected");
    const rejected = await rejectedRes.json();
    expect(rejected.some((i: { id: string }) => i.id === bbcItem.id)).toBe(true);

    const eventsRes = await request.get("/api/events");
    const events = await eventsRes.json();
    expect(events.some((e: { title: string }) => e.title === bbcItem.originalTitle)).toBe(false);
  });

  test("15. Live refresh: a newly published event reaches /api/events without a page reload", async ({
    page,
    request,
  }) => {
    await page.goto("/world");
    await page.getByRole("radiogroup", { name: "Time" }).getByRole("radio", { name: "7D" }).click();
    const countBefore = await page.getByText(/events in range/).textContent();

    // Publish one more BBC item directly via the API (equivalent to a
    // second admin completing a review) while the /world tab stays open —
    // hooks/use-live-events.ts polls /api/events every 20s.
    const itemsRes = await request.get("/api/admin/incoming?status=pending");
    const items = await itemsRes.json();
    const bbcItem = items.find((i: { source: { name: string } }) => i.source.name === "BBC World");
    test.skip(!bbcItem, "No more unpublished BBC items available for this run.");

    await request.post(`/api/admin/incoming/${bbcItem.id}/publish`, {
      data: {
        title: bbcItem.originalTitle ?? "Live refresh test event",
        summary: "Independently summarized for Vigil (live-refresh test).",
        eventType: "other",
        latitude: 50.45,
        longitude: 30.52,
        countryCode: "UA",
        region: "Europe",
        occurredAt: new Date().toISOString(),
        severity: "elevated",
        importance: 50,
        verificationStatus: "reported",
      },
    });

    await expect(async () => {
      const countAfter = await page.getByText(/events in range/).textContent();
      expect(countAfter).not.toBe(countBefore);
    }).toPass({ timeout: 25_000 });
  });
});
