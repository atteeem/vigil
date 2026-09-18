import { test, expect } from "@playwright/test";
import { describeHistoryEntry } from "@/lib/data/event-history-description";

// Deterministic coverage for the admin/public history-entry copy (spec
// "Casualties: 4 → 6", "Severity changed", "Location refined", "Conflict
// association updated").
test.describe("History entry descriptions (lib/data/event-history-description.ts)", () => {
  test("casualtiesKilled shows the old → new figures", () => {
    expect(describeHistoryEntry({ field: "casualtiesKilled", oldValue: "4", newValue: "6" })).toBe("Killed: 4 → 6");
  });

  test("severity change reads as 'Severity changed'", () => {
    expect(describeHistoryEntry({ field: "severity", oldValue: "elevated", newValue: "high" })).toBe(
      "Severity changed: elevated → high",
    );
  });

  test("location-family fields (locationName/countryCode/region/lat/lng) all read as 'Location refined'", () => {
    for (const field of ["locationName", "countryCode", "region", "latitude", "longitude"]) {
      expect(describeHistoryEntry({ field, oldValue: "a", newValue: "b" })).toBe("Location refined");
    }
  });

  test("conflict association reads as 'Conflict association updated'", () => {
    expect(describeHistoryEntry({ field: "conflictId", oldValue: null, newValue: "conflict-1" })).toBe(
      "Conflict association updated",
    );
  });

  test("a null oldValue (new-value fields) falls back to 'unknown', never crashes", () => {
    expect(describeHistoryEntry({ field: "eventType", oldValue: null, newValue: "airstrike" })).toBe(
      "Event type changed: unknown → airstrike",
    );
  });

  test("an unrecognized field still produces a readable fallback", () => {
    expect(describeHistoryEntry({ field: "someFutureField", oldValue: "a", newValue: "b" })).toBe("someFutureField updated");
  });
});
