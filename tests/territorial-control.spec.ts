import { test, expect } from "@playwright/test";
import { deriveDisplayStatus, isValidTerritorialGeometry, parseTerritorialGeometry, RECENTLY_CHANGED_WINDOW_MS } from "@/lib/data/territorial-control";
import { nextActorColor, ACTOR_COLOR_PALETTE } from "@/lib/map/territorial-colors";

// Deterministic coverage for Territorial Control Mode's pure logic (no
// DB, no React) — same rationale as tests/world-timeline.spec.ts and
// tests/world-playback.spec.ts.

test.describe("deriveDisplayStatus (lib/data/territorial-control.ts)", () => {
  test("1. A version whose validFrom is within the recently-changed window displays as recently_changed", () => {
    const validFrom = new Date("2026-09-18T12:00:00.000Z");
    const asOf = new Date(validFrom.getTime() + 60_000); // 1 minute later
    expect(deriveDisplayStatus("controlled", validFrom, asOf)).toBe("recently_changed");
  });

  test("2. A version older than the window displays its own assigned status", () => {
    const validFrom = new Date("2026-09-18T12:00:00.000Z");
    const asOf = new Date(validFrom.getTime() + RECENTLY_CHANGED_WINDOW_MS + 60_000);
    expect(deriveDisplayStatus("contested", validFrom, asOf)).toBe("contested");
  });

  test("3. Exactly at the window boundary still displays as recently_changed (inclusive)", () => {
    const validFrom = new Date("2026-09-18T12:00:00.000Z");
    const asOf = new Date(validFrom.getTime() + RECENTLY_CHANGED_WINDOW_MS);
    expect(deriveDisplayStatus("uncertain", validFrom, asOf)).toBe("recently_changed");
  });

  test("4. Viewing a moment BEFORE validFrom (asOf earlier than the version starts) never shows recently_changed", () => {
    const validFrom = new Date("2026-09-18T12:00:00.000Z");
    const asOf = new Date(validFrom.getTime() - 60_000);
    expect(deriveDisplayStatus("controlled", validFrom, asOf)).toBe("controlled");
  });
});

test.describe("isValidTerritorialGeometry / parseTerritorialGeometry (lib/data/territorial-control.ts)", () => {
  test("5. A well-formed Polygon is valid", () => {
    expect(isValidTerritorialGeometry({ type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] })).toBe(true);
  });

  test("6. A well-formed MultiPolygon is valid", () => {
    expect(
      isValidTerritorialGeometry({
        type: "MultiPolygon",
        coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]], [[[2, 2], [3, 2], [3, 3], [2, 2]]]],
      }),
    ).toBe(true);
  });

  test("7. A non-Polygon/MultiPolygon GeoJSON type is rejected", () => {
    expect(isValidTerritorialGeometry({ type: "Point", coordinates: [0, 0] })).toBe(false);
  });

  test("8. Malformed shapes (missing coordinates, wrong nesting) are rejected", () => {
    expect(isValidTerritorialGeometry({ type: "Polygon" })).toBe(false);
    expect(isValidTerritorialGeometry({ type: "Polygon", coordinates: [] })).toBe(false);
    expect(isValidTerritorialGeometry(null)).toBe(false);
    expect(isValidTerritorialGeometry("not an object")).toBe(false);
  });

  test("9. parseTerritorialGeometry returns null for invalid JSON rather than throwing", () => {
    expect(parseTerritorialGeometry("{not json")).toBeNull();
  });

  test("10. parseTerritorialGeometry returns null for valid JSON that isn't a valid geometry", () => {
    expect(parseTerritorialGeometry('{"type":"Point","coordinates":[0,0]}')).toBeNull();
  });

  test("11. parseTerritorialGeometry round-trips a valid geometry", () => {
    const geometry = { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
    expect(parseTerritorialGeometry(JSON.stringify(geometry))).toEqual(geometry);
  });
});

test.describe("nextActorColor (lib/map/territorial-colors.ts)", () => {
  test("12. Actor colors are assigned in palette order by position", () => {
    expect(nextActorColor(0)).toBe(ACTOR_COLOR_PALETTE[0]);
    expect(nextActorColor(1)).toBe(ACTOR_COLOR_PALETTE[1]);
  });

  test("13. Color assignment cycles once the palette is exhausted, never returning undefined", () => {
    const color = nextActorColor(ACTOR_COLOR_PALETTE.length);
    expect(color).toBe(ACTOR_COLOR_PALETTE[0]);
  });
});
