import { test, expect } from "@playwright/test";

// Deterministic suite for "Event corroboration metadata" — the
// admin-only /admin/events/[id] view surfacing supporting-report count,
// independent-source count, source categories represented, and
// earliest/latest corroboration timestamps for an already-published
// event (lib/data/corroboration.ts's getEventCorroboration()). No new
// scoring/matching logic is under test here — only that the existing
// Event.sources data is summarized correctly and displayed as
// descriptive metadata, never as a credibility/truth verdict.
test.describe.serial("Event corroboration metadata", () => {
  let newsSourceId: string;
  let officialSourceId: string;
  let eventId: string;
  const t0 = Date.now() - 3 * 60 * 60_000; // 3h ago: originating report

  test("setup: two categorized sources, a published event, a corroborating report, and a relay of the same source", async ({
    request,
  }) => {
    const news = await request
      .post("/api/admin/sources", {
        data: { name: `Corroboration News Source ${Date.now()}`, type: "manual", sourceCategory: "News", enabled: true },
      })
      .then((r) => r.json());
    newsSourceId = news.id;

    const official = await request
      .post("/api/admin/sources", {
        data: {
          name: `Corroboration Official Source ${Date.now()}`,
          type: "manual",
          sourceCategory: "official",
          enabled: true,
        },
      })
      .then((r) => r.json());
    officialSourceId = official.id;

    // Originating report, t0 (3h ago).
    const originating = await request
      .post("/api/admin/incoming/manual", {
        data: {
          sourceId: newsSourceId,
          externalId: `corrob-originating-${Date.now()}`,
          originalUrl: "https://fixture.test/corroboration/originating",
          originalTitle: "Warehouse fire reported in Lagos industrial district",
          originalText: "A fire broke out at a warehouse in the Lagos industrial district.",
          publishedAt: new Date(t0).toISOString(),
        },
      })
      .then((r) => r.json());

    const published = await request
      .post(`/api/admin/incoming/${originating.id}/publish`, {
        data: {
          title: "Warehouse fire reported in Lagos industrial district",
          summary: "Independently written summary for the corroboration metadata test event.",
          eventType: "fire",
          latitude: 6.45,
          longitude: 3.39,
          countryCode: "NG",
          region: "Africa",
          occurredAt: new Date(t0).toISOString(),
          severity: "elevated",
          importance: 40,
          verificationStatus: "reported",
        },
      })
      .then((r) => r.json());
    eventId = published.id;
    expect(eventId).toBeTruthy();

    // Genuinely independent corroborating report, t0 + 1h, different source/category.
    const corroborating = await request
      .post("/api/admin/incoming/manual", {
        data: {
          sourceId: officialSourceId,
          externalId: `corrob-independent-${Date.now()}`,
          originalUrl: "https://fixture.test/corroboration/official-statement",
          originalTitle: "Official statement confirms warehouse fire in Lagos",
          originalText: "A government statement confirmed the fire at the Lagos warehouse.",
          publishedAt: new Date(t0 + 60 * 60_000).toISOString(),
        },
      })
      .then((r) => r.json());
    await request.post(`/api/admin/incoming/${corroborating.id}/merge`, {
      data: { eventId, relationship: "corroborating" },
    });

    // A relay of the SAME originating source, t0 + 2h — must count as a
    // supporting report but NOT as an additional independent source.
    const relay = await request
      .post("/api/admin/incoming/manual", {
        data: {
          sourceId: newsSourceId,
          externalId: `corrob-relay-${Date.now()}`,
          originalUrl: "https://fixture.test/corroboration/relay",
          originalTitle: "Warehouse fire reported in Lagos industrial district (repost)",
          originalText: "Repost of the original warehouse fire report.",
          publishedAt: new Date(t0 + 2 * 60 * 60_000).toISOString(),
        },
      })
      .then((r) => r.json());
    await request.post(`/api/admin/incoming/${relay.id}/merge`, { data: { eventId, relationship: "relay" } });
  });

  test("1. Admin event view shows independent-source count, supporting-report count, categories, and corroboration timestamps", async ({
    page,
  }) => {
    await page.goto(`/admin/events/${eventId}`);
    await expect(page.getByTestId("admin-event-detail")).toBeVisible();

    // 2 independent sources (originating + corroborating) — the relay does not count.
    await expect(page.getByTestId("corroboration-source-count")).toContainText("2");
    await expect(page.getByTestId("corroboration-source-count")).toContainText("independent source");

    // 3 supporting reports total (originating + corroborating + relay).
    await expect(page.getByTestId("corroboration-report-count")).toContainText("3");
    await expect(page.getByTestId("corroboration-report-count")).toContainText("supporting report");

    // Both source categories represented (News from the originating/relay
    // source, Official from the corroborating source), never collapsed to one.
    const categories = page.getByTestId("corroboration-categories");
    await expect(categories).toContainText("News");
    await expect(categories).toContainText("Official");

    // Latest corroboration is the relay's timestamp (t0 + 2h) — any
    // supporting report, independent or not, extends how recently this was
    // last reported. First-reported stays anchored to the originating report.
    await expect(page.getByTestId("corroboration-last-updated")).toContainText("Last corroborated");
    await expect(page.getByTestId("corroboration-last-updated")).toContainText(/1h ago|2h ago/);
    await expect(page.getByTestId("corroboration-first-reported")).toContainText("First reported");
    await expect(page.getByTestId("corroboration-first-reported")).toContainText(/3h ago/);
  });

  test("2. Corroboration metadata is presented descriptively, never as a credibility or truth score", async ({ page }) => {
    await page.goto(`/admin/events/${eventId}`);
    await expect(page.getByTestId("corroboration-panel")).toContainText(/not a truth or credibility score/i);
  });

  test("3. The events list links to the detail view and shows the same independent-source count", async ({ page }) => {
    await page.goto("/admin/events");
    const row = page.getByTestId(`admin-event-row-${eventId}`);
    await expect(row).toBeVisible();
    await expect(row).toContainText("2"); // independent sourceCount column
    await row.getByRole("link", { name: /Warehouse fire/ }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/events/${eventId}$`));
    await expect(page.getByTestId("admin-event-detail")).toBeVisible();
  });

  test("4. Boundary: an event with exactly one source uses singular wording, not plural", async ({ page, request }) => {
    const source = await request
      .post("/api/admin/sources", { data: { name: `Corroboration Single Source ${Date.now()}`, type: "manual", sourceCategory: "News" } })
      .then((r) => r.json());
    const item = await request
      .post("/api/admin/incoming/manual", {
        data: {
          sourceId: source.id,
          externalId: `corrob-single-${Date.now()}`,
          originalUrl: "https://fixture.test/corroboration/single",
          originalTitle: "Isolated report with a single source",
          originalText: "A single, uncorroborated report.",
          publishedAt: new Date().toISOString(),
        },
      })
      .then((r) => r.json());
    const published = await request
      .post(`/api/admin/incoming/${item.id}/publish`, {
        data: {
          title: "Isolated report with a single source",
          summary: "Single-source corroboration boundary test event.",
          eventType: "other",
          latitude: 1.0,
          longitude: 1.0,
          countryCode: "XX",
          region: "Global",
          occurredAt: new Date().toISOString(),
          severity: "guarded",
          importance: 20,
          verificationStatus: "reported",
        },
      })
      .then((r) => r.json());

    await page.goto(`/admin/events/${published.id}`);
    await expect(page.getByTestId("corroboration-source-count")).toContainText("1 independent source");
    await expect(page.getByTestId("corroboration-source-count")).not.toContainText("sources");
    await expect(page.getByTestId("corroboration-report-count")).toContainText("1 supporting report");
    await expect(page.getByTestId("corroboration-report-count")).not.toContainText("reports");
  });
});
