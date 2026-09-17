import { test, expect } from "@playwright/test";

// Deterministic suite for the "Event Matching / Clustering Foundation"
// stage — hardens lib/ingestion/duplicates.ts (already built in the
// classification milestone as the duplicate-candidate engine) with
// event-type compatibility groups and a generic-headline guard, and
// proves the specific scenarios the spec calls out by name. Publishes
// its own reference events via the real publish API, then queries
// POST /api/admin/incoming/[id]/duplicates directly with synthetic
// candidate reports — no fixture RSS feed needed, this stage is about
// the scoring function itself, not ingestion.
test.describe.serial("Event matching / clustering foundation", () => {
  // Every /duplicates call below needs *some* raw-item id in the URL
  // (route symmetry — lib/ingestion/duplicates.ts's scoring itself takes
  // the query fields directly, not the id), so one throwaway item is
  // created once and reused as `queryItemId` for every check in this file.
  let queryItemId: string;
  let kyivEventId: string;
  let kyivOccurredAt: string;

  test("setup: a manual source, a throwaway query item, and a reference published event (explosion, central Kyiv)", async ({
    request,
  }) => {
    const source = await request
      .post("/api/admin/sources", {
        data: { name: `Event Matching Source ${Date.now()}`, type: "manual", enabled: true, autoIngest: false, autoProcessing: false },
      })
      .then((r) => r.json());

    const queryItem = await request
      .post("/api/admin/incoming/manual", {
        data: {
          sourceId: source.id,
          externalId: `matching-query-${Date.now()}`,
          originalUrl: "https://fixture.test/matching/query",
          originalTitle: "Placeholder query item",
          originalText: "Used only as the [id] for POST duplicates checks in this suite.",
          publishedAt: new Date().toISOString(),
        },
      })
      .then((r) => r.json());
    queryItemId = queryItem.id;

    const referenceItem = await request
      .post("/api/admin/incoming/manual", {
        data: {
          sourceId: source.id,
          externalId: `matching-ref-${Date.now()}`,
          originalUrl: "https://fixture.test/matching/ref",
          originalTitle: "Explosion reported in central Kyiv",
          originalText: "An explosion was reported in central Kyiv this evening.",
          publishedAt: new Date().toISOString(),
        },
      })
      .then((r) => r.json());

    kyivOccurredAt = new Date().toISOString();
    const published = await request
      .post(`/api/admin/incoming/${referenceItem.id}/publish`, {
        data: {
          title: "Explosion reported in central Kyiv",
          summary: "Independently written summary for the event-matching reference event.",
          eventType: "explosion",
          latitude: 50.45,
          longitude: 30.523,
          countryCode: "UA",
          region: "Europe",
          occurredAt: kyivOccurredAt,
          severity: "elevated",
          importance: 50,
          verificationStatus: "reported",
        },
      })
      .then((r) => r.json());
    kyivEventId = published.id;
    expect(kyivEventId).toBeTruthy();
  });

  test("1. Obvious same event: close in time (15 min) and space (~1 km) produces a strong match with explanatory reasons", async ({
    request,
  }) => {
    const candidateTime = new Date(new Date(kyivOccurredAt).getTime() + 15 * 60_000).toISOString();
    const res = await request.post(`/api/admin/incoming/${queryItemId}/duplicates`, {
      data: {
        title: "Explosion reported near central Kyiv",
        eventType: "explosion",
        latitude: 50.459, // ~1km from 50.45,30.523
        longitude: 30.523,
        countryCode: "UA",
        region: "Europe",
        occurredAt: candidateTime,
      },
    });
    const candidates = await res.json();
    const match = candidates.find((c: { eventId: string }) => c.eventId === kyivEventId);
    expect(match).toBeTruthy();
    expect(match.score).toBeGreaterThanOrEqual(70);
    expect(match.sameEventType).toBe(true);
    expect(match.eventTypeCompatible).toBe(true);
    expect(match.reasons.length).toBeGreaterThan(0);
    expect(match.reasons.some((r: string) => r.includes("min apart") || r.includes("m away") || r.includes("km away"))).toBe(true);
  });

  test("2. Same location, substantially different time (several days apart) scores much lower than the close-in-time match", async ({
    request,
  }) => {
    const daysLaterTime = new Date(new Date(kyivOccurredAt).getTime() + 3 * 86_400_000).toISOString();
    const res = await request.post(`/api/admin/incoming/${queryItemId}/duplicates`, {
      data: {
        title: "Explosion reported near central Kyiv",
        eventType: "explosion",
        latitude: 50.459,
        longitude: 30.523,
        countryCode: "UA",
        region: "Europe",
        occurredAt: daysLaterTime,
      },
    });
    const candidates = await res.json();
    const match = candidates.find((c: { eventId: string }) => c.eventId === kyivEventId);
    // Time contributes ~0 past 12h, but same-type/place/title can still
    // clear MIN_SCORE — this is a legitimate lower-confidence "possibly
    // related" suggestion (never auto-merged), not a false claim of
    // certainty. What matters is it scores well below a genuine near-duplicate.
    if (match) expect(match.score).toBeLessThan(70);
  });

  test("3. Same event type, different country: distance alone keeps it well under the match threshold", async ({
    request,
  }) => {
    const candidateTime = new Date(new Date(kyivOccurredAt).getTime() + 10 * 60_000).toISOString();
    const res = await request.post(`/api/admin/incoming/${queryItemId}/duplicates`, {
      data: {
        title: "Explosion reported in central Kyiv",
        eventType: "explosion",
        latitude: 35.6762, // Tokyo — same event type/title, opposite side of the world
        longitude: 139.6503,
        countryCode: "JP",
        region: "Asia",
        occurredAt: candidateTime,
      },
    });
    const candidates = await res.json();
    expect(candidates.some((c: { eventId: string }) => c.eventId === kyivEventId)).toBe(false);
  });

  test("4. Same place and time but an incompatible event type (earthquake vs explosion) is reduced well below a same-type match", async ({
    request,
  }) => {
    const candidateTime = new Date(new Date(kyivOccurredAt).getTime() + 5 * 60_000).toISOString();
    const res = await request.post(`/api/admin/incoming/${queryItemId}/duplicates`, {
      data: {
        title: "Seismic activity detected near Kyiv",
        eventType: "earthquake",
        latitude: 50.45,
        longitude: 30.523,
        countryCode: "UA",
        region: "Europe",
        occurredAt: candidateTime,
      },
    });
    const candidates = await res.json();
    const match = candidates.find((c: { eventId: string }) => c.eventId === kyivEventId);
    // Distance+time alone would be ~50/100 — comfortably over MIN_SCORE
    // (35) if event-type incompatibility didn't actively penalize it.
    if (match) {
      expect(match.eventTypeCompatible).toBe(false);
      expect(match.score).toBeLessThan(50);
    }
  });

  test("5. Similar wording but geographically unrelated never matches on title alone", async ({ request }) => {
    const candidateTime = new Date(new Date(kyivOccurredAt).getTime() + 10 * 60_000).toISOString();
    const res = await request.post(`/api/admin/incoming/${queryItemId}/duplicates`, {
      data: {
        title: "Explosion reported in central Bogota", // shares "explosion" + "central" wording
        eventType: "explosion",
        latitude: 4.711, // Bogotá, Colombia
        longitude: -74.0721,
        countryCode: "CO",
        region: "Americas",
        occurredAt: candidateTime,
      },
    });
    const candidates = await res.json();
    expect(candidates.some((c: { eventId: string }) => c.eventId === kyivEventId)).toBe(false);
  });

  test("6. Generic headline false-positive protection: two unrelated 'Breaking news' reports don't match on boilerplate wording", async ({
    request,
  }) => {
    const candidateTime = new Date(new Date(kyivOccurredAt).getTime() + 10 * 60_000).toISOString();
    const res = await request.post(`/api/admin/incoming/${queryItemId}/duplicates`, {
      data: {
        // Deliberately generic/boilerplate-heavy title with no real
        // content overlap with "Explosion reported in central Kyiv"
        // beyond wire-service filler words.
        title: "Breaking news update: latest report live",
        eventType: "diplomacy",
        latitude: -33.8688, // Sydney — unrelated location
        longitude: 151.2093,
        countryCode: "AU",
        region: "Asia",
        occurredAt: candidateTime,
      },
    });
    const candidates = await res.json();
    expect(candidates.some((c: { eventId: string }) => c.eventId === kyivEventId)).toBe(false);
  });

  test("7. Boundary condition: a candidate scoring just under MIN_SCORE (35) is excluded, not just ranked last", async ({
    request,
  }) => {
    // Different type (incompatible group), far enough to mostly kill
    // distance, no conflict/region/title overlap — should net out under
    // threshold and therefore be entirely absent from the results.
    const candidateTime = new Date(new Date(kyivOccurredAt).getTime() + 6 * 60 * 60_000).toISOString(); // 6h apart
    const res = await request.post(`/api/admin/incoming/${queryItemId}/duplicates`, {
      data: {
        title: "Flooding reported across the region",
        eventType: "flood",
        latitude: 50.6, // ~17km from the Kyiv event — distance score partial, not zero
        longitude: 30.6,
        countryCode: "UA",
        region: "Europe", // shares region — the one factor keeping this near the boundary
        occurredAt: candidateTime,
      },
    });
    const candidates = await res.json();
    expect(candidates.some((c: { eventId: string }) => c.eventId === kyivEventId)).toBe(false);
  });

  test("8. No-candidate case: an empty/near-empty window returns an empty array, not an error", async ({ request }) => {
    const farFuture = new Date(new Date(kyivOccurredAt).getTime() + 365 * 86_400_000).toISOString(); // 1 year later, outside the 14-day window
    const res = await request.post(`/api/admin/incoming/${queryItemId}/duplicates`, {
      data: {
        title: "Explosion reported in central Kyiv",
        eventType: "explosion",
        latitude: 50.45,
        longitude: 30.523,
        countryCode: "UA",
        region: "Europe",
        occurredAt: farFuture,
      },
    });
    expect(res.ok()).toBeTruthy();
    const candidates = await res.json();
    expect(Array.isArray(candidates)).toBe(true);
    expect(candidates.some((c: { eventId: string }) => c.eventId === kyivEventId)).toBe(false);
  });
});
