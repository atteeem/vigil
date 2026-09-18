import { test, expect } from "@playwright/test";
import { resolveTimelineTimestamp } from "@/lib/utils/world-timeline";

// Deterministic coverage for the Global Timeline preset-resolution logic
// (spec "Global Timeline / Historical Playback"). Pure-function tests,
// same rationale as tests/globe-clusters.spec.ts — resolveTimelineTimestamp
// takes `now` as a parameter rather than reading the clock itself, so
// it's directly testable with no mocking.

const NOW = new Date("2026-09-18T14:37:42.123Z");

test.describe("Timeline preset resolution (lib/utils/world-timeline.ts)", () => {
  test("1. Live resolves to null (no historical timestamp at all)", () => {
    expect(resolveTimelineTimestamp("live", NOW)).toBeNull();
  });

  test("2. Each range preset resolves to now minus its own window, rounded down to the minute", () => {
    expect(resolveTimelineTimestamp("1H", NOW)?.toISOString()).toBe("2026-09-18T13:37:00.000Z");
    expect(resolveTimelineTimestamp("6H", NOW)?.toISOString()).toBe("2026-09-18T08:37:00.000Z");
    expect(resolveTimelineTimestamp("24H", NOW)?.toISOString()).toBe("2026-09-17T14:37:00.000Z");
    expect(resolveTimelineTimestamp("7D", NOW)?.toISOString()).toBe("2026-09-11T14:37:00.000Z");
    expect(resolveTimelineTimestamp("30D", NOW)?.toISOString()).toBe("2026-08-19T14:37:00.000Z");
  });

  test("3. Presets are monotonic — a longer window always resolves to an earlier timestamp", () => {
    const order = ["1H", "6H", "24H", "7D", "30D"] as const;
    let prev = NOW.getTime();
    for (const preset of order) {
      const resolved = resolveTimelineTimestamp(preset, NOW)!;
      expect(resolved.getTime()).toBeLessThan(prev);
      prev = resolved.getTime();
    }
  });

  test("4. Custom resolves to the given timestamp, rounded down to the minute", () => {
    const custom = new Date("2026-01-05T03:14:59.999Z");
    expect(resolveTimelineTimestamp("custom", NOW, custom)?.toISOString()).toBe("2026-01-05T03:14:00.000Z");
  });

  test("5. Custom with no timestamp supplied resolves to null (not an error)", () => {
    expect(resolveTimelineTimestamp("custom", NOW, null)).toBeNull();
    expect(resolveTimelineTimestamp("custom", NOW)).toBeNull();
  });

  test("6. Resolving the same preset twice at the same 'now' minute is idempotent (what the events cache relies on)", () => {
    const a = resolveTimelineTimestamp("6H", NOW);
    const b = resolveTimelineTimestamp("6H", NOW);
    expect(a?.toISOString()).toBe(b?.toISOString());
  });
});
