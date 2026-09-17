import { test, expect } from "@playwright/test";
import { clusterEvents, clusterRadiusForAltitude, formatClusterCount } from "@/lib/globe/event-clusters";
import type { ConflictEvent } from "@/lib/types";

// Deterministic coverage for the globe's cluster-count markers (spec
// "globe cluster counts"). Pure-function tests, same rationale as
// tests/world-map-heat.spec.ts — no unit-test runner besides Playwright
// exists in this project, and these functions have no DOM/Three.js
// dependency, so they're exercised directly rather than through a
// rendered globe.

function ev(overrides: Partial<ConflictEvent>): ConflictEvent {
  return {
    id: "e",
    slug: "e",
    title: "t",
    summary: "s",
    eventType: "other",
    lat: 0,
    lng: 0,
    countryCode: "XX",
    region: "Global",
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

test.describe("Globe event clustering (lib/globe/event-clusters.ts)", () => {
  test("1. Events within the radius merge into one cluster with the correct count", () => {
    const events = [
      ev({ id: "a", lat: 31.5, lng: 34.47 }),
      ev({ id: "b", lat: 31.51, lng: 34.48 }),
      ev({ id: "c", lat: 31.49, lng: 34.46 }),
    ];
    const clusters = clusterEvents(events, 1); // 1 degree radius, comfortably covers all three
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.count).toBe(3);
    expect(clusters[0]!.ids.sort()).toEqual(["a", "b", "c"]);
  });

  test("2. Events far apart stay in separate clusters", () => {
    const events = [ev({ id: "a", lat: 31.5, lng: 34.47 }), ev({ id: "b", lat: -33.9, lng: 18.4 })]; // Gaza vs. Cape Town
    const clusters = clusterEvents(events, 1);
    expect(clusters).toHaveLength(2);
    expect(clusters.every((c) => c.count === 1)).toBe(true);
  });

  test("3. A cluster's severity is the worst among its events, never an average or a count", () => {
    const events = [
      ev({ id: "a", lat: 0, lng: 0, severity: "stable" }),
      ev({ id: "b", lat: 0.01, lng: 0.01, severity: "guarded" }),
      ev({ id: "c", lat: -0.01, lng: -0.01, severity: "extreme" }),
    ];
    const clusters = clusterEvents(events, 1);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.severity).toBe("extreme");

    // The inverse: many low-severity events must not somehow read as
    // severe just because there are a lot of them.
    const manyLow = Array.from({ length: 40 }, (_, i) => ev({ id: `low-${i}`, lat: i * 0.001, lng: i * 0.001, severity: "guarded" }));
    const lowClusters = clusterEvents(manyLow, 1);
    expect(lowClusters).toHaveLength(1);
    expect(lowClusters[0]!.count).toBe(40);
    expect(lowClusters[0]!.severity).toBe("guarded");
  });

  test("4. Count formatting caps the label at 99+ without altering the underlying count", () => {
    expect(formatClusterCount(1)).toBe("1");
    expect(formatClusterCount(42)).toBe("42");
    expect(formatClusterCount(99)).toBe("99");
    expect(formatClusterCount(100)).toBe("99+");
    expect(formatClusterCount(500)).toBe("99+");

    const events = Array.from({ length: 150 }, (_, i) => ev({ id: `e-${i}`, lat: 0, lng: 0 }));
    const clusters = clusterEvents(events, 1);
    expect(clusters[0]!.count).toBe(150); // the real count is preserved internally
    expect(formatClusterCount(clusters[0]!.count)).toBe("99+"); // only the label caps
  });

  test("5. Clustering radius grows as the camera zooms out (altitude increases), so zoom levels behave correctly", () => {
    const close = clusterRadiusForAltitude(0.3);
    const mid = clusterRadiusForAltitude(2);
    const far = clusterRadiusForAltitude(4);
    expect(close).toBeLessThan(mid);
    expect(mid).toBeLessThan(far);
    // Out-of-range altitudes clamp rather than extrapolating wildly.
    expect(clusterRadiusForAltitude(100)).toBe(far);
    expect(clusterRadiusForAltitude(-5)).toBe(close);
  });

  test("6. The same events cluster differently at close vs. far altitude — zoom in splits a group apart", () => {
    const events = [
      ev({ id: "a", lat: 31.5, lng: 34.47 }),
      ev({ id: "b", lat: 32.3, lng: 35.0 }), // ~100km away — merges when zoomed out, splits when zoomed in
    ];
    const farClusters = clusterEvents(events, clusterRadiusForAltitude(4));
    const closeClusters = clusterEvents(events, clusterRadiusForAltitude(0.3));
    expect(farClusters).toHaveLength(1);
    expect(closeClusters).toHaveLength(2);
  });
});
