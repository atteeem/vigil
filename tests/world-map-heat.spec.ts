import { test, expect } from "@playwright/test";
import { eventsToHeatGeoJSON, conflictBaseGeoJSON } from "@/lib/map/heat-layers";
import type { ConflictEvent } from "@/lib/types";

// Deterministic coverage for the heatmap-mode visualization redesign
// (spec "improve globe conflict/event heatmaps"): color = severity,
// opacity = corroboration x recency, radius = geographic scope, and a
// separate wide "ongoing conflict" base layer aggregated from each
// conflict's own events. The paint expressions themselves (the actual
// interpolation curves in components/map/world-map.tsx) are MapLibre GL
// style spec JSON — there's no JS to unit-test there, and this project
// has no unit-test runner besides Playwright (see tests/*.spec.ts
// convention) — so this file tests the two pure functions that FEED
// those paint expressions (lib/map/heat-layers.ts), which is where all
// of the actual per-feature logic (max-not-sum severity, spread-radius,
// age calculation) lives. A short browser-driven test at the end proves
// the whole pipeline renders real published events without crashing.

function baseEvent(overrides: Partial<ConflictEvent>): ConflictEvent {
  return {
    id: "e1",
    slug: "e1",
    title: "Test event",
    summary: "test",
    eventType: "other",
    lat: 31.5,
    lng: 34.47,
    countryCode: "PS",
    region: "Middle East",
    conflictId: null,
    occurredAt: "2026-09-16T12:00:00.000Z",
    severity: "elevated",
    importance: 50,
    verificationStatus: "reported",
    disputed: false,
    sourceCount: 1,
    sources: [],
    timeline: [],
    ...overrides,
  };
}

const NOW = "2026-09-16T15:00:00.000Z"; // matches lib/data/constants.ts's MOCK_NOW

test.describe("Heat layer data pipeline (lib/map/heat-layers.ts)", () => {
  test("1. Report count never drives color: a conflict with many low-severity events stays low-severity, not red", () => {
    const manyLowSeverityEvents: ConflictEvent[] = Array.from({ length: 30 }, (_, i) =>
      baseEvent({ id: `low-${i}`, conflictId: "c-1", severity: "guarded", sourceCount: 1 }),
    );
    const bases = conflictBaseGeoJSON(manyLowSeverityEvents);
    expect(bases.features).toHaveLength(1);
    expect(bases.features[0]!.properties.severity).toBe("guarded");
    expect(bases.features[0]!.properties.eventCount).toBe(30);
  });

  test("2. A severe event can be red even with a single source and no other reports", () => {
    const events: ConflictEvent[] = [baseEvent({ id: "severe-1", conflictId: "c-2", severity: "severe", sourceCount: 1 })];
    const bases = conflictBaseGeoJSON(events);
    expect(bases.features[0]!.properties.severity).toBe("severe");
    expect(bases.features[0]!.properties.eventCount).toBe(1);

    const heat = eventsToHeatGeoJSON(events, NOW);
    expect(heat.features[0]!.properties.severity).toBe("severe");
    // Low source count must not have been used to downgrade severity —
    // it's an entirely separate property feeding a different paint
    // channel (opacity, not color).
    expect(heat.features[0]!.properties.sourceCount).toBe(1);
  });

  test("3. A sustained conflict spanning many locations gets a wide spread radius, not a point", () => {
    const spreadOut: ConflictEvent[] = [
      baseEvent({ id: "a", conflictId: "c-3", lat: 31.5, lng: 34.47 }), // Gaza
      baseEvent({ id: "b", conflictId: "c-3", lat: 32.0, lng: 35.25 }), // West Bank (~48km away)
      baseEvent({ id: "c", conflictId: "c-3", lat: 31.9, lng: 34.8 }),
    ];
    const bases = conflictBaseGeoJSON(spreadOut);
    expect(bases.features[0]!.properties.spreadKm).toBeGreaterThan(30);

    const tight: ConflictEvent[] = [
      baseEvent({ id: "d", conflictId: "c-4", lat: 31.5, lng: 34.47 }),
      baseEvent({ id: "e", conflictId: "c-4", lat: 31.501, lng: 34.471 }),
    ];
    const tightBases = conflictBaseGeoJSON(tight);
    expect(tightBases.features[0]!.properties.spreadKm).toBeLessThan(1);
    // Both still produce a real feature — the paint expression's own
    // floor (110px even at spreadKm 0) is what keeps a tight cluster from
    // rendering as a pinpoint; that floor lives in world-map.tsx's
    // circle-radius interpolation, not here.
  });

  test("4. Recency: an old isolated event's ageHours is large; a fresh one's is near zero", () => {
    const old = baseEvent({ id: "old", occurredAt: "2026-08-01T00:00:00.000Z" }); // ~6 weeks before NOW
    const fresh = baseEvent({ id: "fresh", occurredAt: "2026-09-16T14:30:00.000Z" }); // 30 min before NOW
    const heat = eventsToHeatGeoJSON([old, fresh], NOW);
    const oldProps = heat.features.find((f) => f.properties.id === "old")!.properties;
    const freshProps = heat.features.find((f) => f.properties.id === "fresh")!.properties;
    expect(oldProps.ageHours).toBeGreaterThan(720); // > 30 days — comfortably past world-map.tsx's fade-out stop
    expect(freshProps.ageHours).toBeLessThan(1);
  });

  test("5. Corroboration: independent source count is carried through unchanged by severity", () => {
    const heat = eventsToHeatGeoJSON(
      [
        baseEvent({ id: "one-source", severity: "high", sourceCount: 1 }),
        baseEvent({ id: "many-sources", severity: "high", sourceCount: 7 }),
      ],
      NOW,
    );
    const one = heat.features.find((f) => f.properties.id === "one-source")!.properties;
    const many = heat.features.find((f) => f.properties.id === "many-sources")!.properties;
    expect(one.severity).toBe(many.severity); // same color driver
    expect(many.sourceCount).toBeGreaterThan(one.sourceCount); // different opacity driver
  });

  test("6. Events with no conflictId (one-off incidents) get no base layer — only conflict-tagged events do", () => {
    const events: ConflictEvent[] = [baseEvent({ id: "standalone", conflictId: null, severity: "extreme" })];
    expect(conflictBaseGeoJSON(events).features).toHaveLength(0);
  });

  test("7. Multiple distinct conflicts each get their own independent base feature", () => {
    const events: ConflictEvent[] = [
      baseEvent({ id: "a1", conflictId: "conflict-a", severity: "severe", lat: 31.5, lng: 34.47 }),
      baseEvent({ id: "a2", conflictId: "conflict-a", severity: "elevated", lat: 31.6, lng: 34.5 }),
      baseEvent({ id: "b1", conflictId: "conflict-b", severity: "guarded", lat: 48.0, lng: 37.0 }),
    ];
    const bases = conflictBaseGeoJSON(events);
    expect(bases.features).toHaveLength(2);
    const a = bases.features.find((f) => f.properties.conflictId === "conflict-a")!;
    const b = bases.features.find((f) => f.properties.conflictId === "conflict-b")!;
    expect(a.properties.severity).toBe("severe"); // max of severe+elevated
    expect(b.properties.severity).toBe("guarded");
  });

  // Central Conflict Scoring Engine v1 §7 "Use centralized severityScore
  // for color/intensity" / "confidence influences opacity" — the two heat
  // GeoJSON builders must go through lib/scoring/severity.ts and
  // lib/scoring/confidence.ts, not compute their own color/opacity numbers.
  test("8. Heatmap features carry the centralized engine's severityScore/confidenceScore, not ad hoc numbers", () => {
    const heat = eventsToHeatGeoJSON(
      [
        baseEvent({ id: "war", severity: "extreme", sourceCount: 3, sources: [{ id: "s1", name: "Wire", sourceType: "Wire", url: "https://x", publishedAt: NOW }] }),
        baseEvent({ id: "minor", severity: "guarded", sourceCount: 1 }),
      ],
      NOW,
    );
    const war = heat.features.find((f) => f.properties.id === "war")!.properties;
    const minor = heat.features.find((f) => f.properties.id === "minor")!.properties;
    // Full-scale-war hard rule (100 = deepest red) reaches the heatmap unchanged.
    expect(war.severityScore).toBe(100);
    expect(war.severity).toBe("extreme");
    // More/diverse corroboration -> higher confidenceScore -> higher opacity driver.
    expect(war.confidenceScore).toBeGreaterThan(minor.confidenceScore);

    const bases = conflictBaseGeoJSON([
      baseEvent({ id: "c1", conflictId: "conflict-war", severity: "extreme", lat: 31.5, lng: 34.47 }),
    ]);
    expect(bases.features[0]!.properties.severityScore).toBe(100);
  });
});

test.describe("World map heatmap rendering (real published events)", () => {
  test("8. Real published events of varying severity/corroboration/age render in heatmap mode with no console errors", async ({
    request,
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    const source = await request
      .post("/api/admin/sources", { data: { name: `Heat Test Source ${Date.now()}`, type: "manual" } })
      .then((r) => r.json());

    async function publish(title: string, lat: number, lng: number, severity: string, occurredAt: string) {
      const item = await request
        .post("/api/admin/incoming/manual", {
          data: { sourceId: source.id, externalId: `heat-${title}-${Date.now()}`, originalTitle: title, originalText: "heat test fixture" },
        })
        .then((r) => r.json());
      return request
        .post(`/api/admin/incoming/${item.id}/publish`, {
          data: {
            title,
            summary: "Heat-layer manual verification fixture.",
            eventType: "other",
            latitude: lat,
            longitude: lng,
            occurredAt,
            severity,
          },
        })
        .then((r) => r.json());
    }

    const now = new Date().toISOString();
    const monthAgo = new Date(Date.now() - 45 * 24 * 3_600_000).toISOString();
    await publish("Heat test: severe single-source incident", 33.0, 44.0, "severe", now);
    await publish("Heat test: old isolated low-severity report", 10.0, 20.0, "guarded", monthAgo);

    await page.goto("/world");
    await page.getByRole("button", { name: "Heatmap" }).click();
    await page.waitForTimeout(1000);

    const canvas = page.locator(".maplibregl-canvas");
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box?.width).toBeGreaterThan(100);
    expect(errors).toEqual([]);
  });
});
