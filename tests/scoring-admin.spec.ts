import { test, expect } from "@playwright/test";

// Central Conflict Scoring Engine v1 §8 — admin/debugging integration:
// GET .../score endpoints for real, DB-backed Conflict/Event rows, and the
// "impact preview for a selected country" query param.
test.describe("Scoring engine admin API", () => {
  test("GET /api/admin/conflicts/:id/score returns severity+confidence always, impact only with ?countryCode=", async ({ request }) => {
    const conflict = await request
      .post("/api/admin/conflicts", {
        data: {
          slug: `scoring-conflict-${Date.now()}`,
          name: "Scoring Test War",
          region: "Europe",
          status: "active",
          severity: "extreme",
          intensity: 95,
          countries: ["UA", "RU"],
          lat: 48.5,
          lng: 37.0,
        },
      })
      .then((r) => r.json());

    const withoutCountry = await request.get(`/api/admin/conflicts/${conflict.id}/score`).then((r) => r.json());
    expect(withoutCountry.severity.severityScore).toBe(100); // active + extreme -> full-scale-war hard rule
    expect(withoutCountry.severity.reasons).toContain("Full-scale active war");
    expect(withoutCountry.confidence.confidenceScore).toBeGreaterThanOrEqual(0);
    expect(withoutCountry.impact).toBeNull();

    const withCountry = await request.get(`/api/admin/conflicts/${conflict.id}/score?countryCode=FI`).then((r) => r.json());
    expect(withCountry.impact).toBeTruthy();
    expect(withCountry.impact.impactScore).toBeGreaterThanOrEqual(75); // Finland borders Russia
  });

  test("GET /api/admin/events/:id/score returns severity+confidence, impact with ?countryCode=", async ({ request }) => {
    const event = await request
      .post("/api/admin/events", {
        data: {
          title: `Scoring admin API test ${Date.now()}`,
          summary: "test summary",
          eventType: "other",
          latitude: 48.5,
          longitude: 37.0,
          countryCode: "UA",
          region: "Europe",
          occurredAt: new Date().toISOString(),
          severity: "extreme",
          importance: 90,
          sourceName: "Scoring Admin Test Source",
          published: true,
        },
      })
      .then((r) => r.json());

    const scores = await request.get(`/api/admin/events/${event.id}/score`).then((r) => r.json());
    expect(scores.severity.severityScore).toBe(100);
    expect(scores.confidence).toBeTruthy();
    expect(scores.impact).toBeNull();

    const withCountry = await request.get(`/api/admin/events/${event.id}/score?countryCode=UA`).then((r) => r.json());
    expect(withCountry.impact.impactScore).toBe(100); // same-country active war

    await request.delete(`/api/admin/events/${event.id}`);
  });

  test("A non-existent conflict/event id returns 404, not a crash", async ({ request }) => {
    const conflictRes = await request.get("/api/admin/conflicts/does-not-exist/score");
    expect(conflictRes.status()).toBe(404);
    const eventRes = await request.get("/api/admin/events/does-not-exist/score");
    expect(eventRes.status()).toBe(404);
  });
});
