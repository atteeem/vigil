import { test, expect } from "@playwright/test";
import {
  playbackStepMs,
  advancePlaybackTimestamp,
  clampToPlaybackRange,
  playbackProgress,
  timestampAtProgress,
} from "@/lib/utils/world-timeline";

// Deterministic coverage for Animated Global Timeline Playback's pure
// math (spec "turn the existing historical timeline into smooth
// Play/Pause playback"). Same rationale as tests/world-timeline.spec.ts
// — no React, no server, no mocking needed.

const START = new Date("2026-09-17T00:00:00.000Z");
const END_1H = new Date("2026-09-17T01:00:00.000Z");
const END_30D = new Date("2026-10-17T00:00:00.000Z");

test.describe("Playback step sizing (lib/utils/world-timeline.ts)", () => {
  test("1. A short range (1H) steps in small (~1 minute) increments", () => {
    const step = playbackStepMs(START, END_1H);
    expect(step).toBe(60_000); // 3,600,000 / 60 = 60,000, at the 1-minute floor
  });

  test("2. A long range (30D) steps in much larger increments than a short range", () => {
    const shortStep = playbackStepMs(START, END_1H);
    const longStep = playbackStepMs(START, END_30D);
    expect(longStep).toBeGreaterThan(shortStep);
    // 2,592,000,000ms / 60 = 43,200,000ms (~12h) — comfortably in "large step" territory.
    expect(longStep).toBeGreaterThan(60 * 60 * 1000);
  });

  test("3. A zero-or-negative span never divides by zero or returns a non-positive step", () => {
    expect(playbackStepMs(START, START)).toBeGreaterThan(0);
    expect(playbackStepMs(END_1H, START)).toBeGreaterThan(0);
  });
});

test.describe("Playback advancement (lib/utils/world-timeline.ts)", () => {
  test("4. Advancing forward moves asOf ahead by stepMs * speed, rounded to the minute", () => {
    const next = advancePlaybackTimestamp(START, 60_000, 1, 1, START, END_1H);
    expect(next.toISOString()).toBe("2026-09-17T00:01:00.000Z");
  });

  test("5. A higher speed advances further per tick, proportionally", () => {
    const at1x = advancePlaybackTimestamp(START, 60_000, 1, 1, START, END_1H);
    const at4x = advancePlaybackTimestamp(START, 60_000, 4, 1, START, END_1H);
    expect(at4x.getTime() - START.getTime()).toBe((at1x.getTime() - START.getTime()) * 4);
  });

  test("6. Stepping backward (direction -1) moves asOf earlier", () => {
    const mid = new Date(START.getTime() + 30 * 60_000);
    const next = advancePlaybackTimestamp(mid, 60_000, 1, -1, START, END_1H);
    expect(next.getTime()).toBeLessThan(mid.getTime());
  });

  test("7. Advancing past the range end clamps exactly to the end, never overshoots", () => {
    const nearEnd = new Date(END_1H.getTime() - 30_000);
    const next = advancePlaybackTimestamp(nearEnd, 60_000, 4, 1, START, END_1H);
    expect(next.getTime()).toBe(END_1H.getTime());
  });

  test("8. Stepping backward past the range start clamps exactly to the start", () => {
    const nearStart = new Date(START.getTime() + 30_000);
    const next = advancePlaybackTimestamp(nearStart, 60_000, 4, -1, START, END_1H);
    expect(next.getTime()).toBe(START.getTime());
  });
});

test.describe("Playback progress / scrubbing (lib/utils/world-timeline.ts)", () => {
  test("9. Progress is 0 at the range start and 1 at the range end", () => {
    expect(playbackProgress(START, START, END_1H)).toBe(0);
    expect(playbackProgress(END_1H, START, END_1H)).toBe(1);
  });

  test("10. Progress at the midpoint of the range is 0.5", () => {
    const mid = new Date(START.getTime() + (END_1H.getTime() - START.getTime()) / 2);
    expect(playbackProgress(mid, START, END_1H)).toBeCloseTo(0.5, 5);
  });

  test("11. Progress is clamped to [0, 1] even for an out-of-range timestamp", () => {
    const before = new Date(START.getTime() - 60_000);
    const after = new Date(END_1H.getTime() + 60_000);
    expect(playbackProgress(before, START, END_1H)).toBe(0);
    expect(playbackProgress(after, START, END_1H)).toBe(1);
  });

  test("12. timestampAtProgress is the inverse of playbackProgress at the start/end/midpoint", () => {
    expect(timestampAtProgress(0, START, END_1H).getTime()).toBe(START.getTime());
    expect(timestampAtProgress(1, START, END_1H).getTime()).toBe(END_1H.getTime());
    const mid = timestampAtProgress(0.5, START, END_1H);
    expect(playbackProgress(mid, START, END_1H)).toBeCloseTo(0.5, 1);
  });

  test("13. timestampAtProgress clamps an out-of-range fraction instead of extrapolating", () => {
    expect(timestampAtProgress(-0.5, START, END_1H).getTime()).toBe(START.getTime());
    expect(timestampAtProgress(1.5, START, END_1H).getTime()).toBe(END_1H.getTime());
  });
});

test.describe("Range clamping (lib/utils/world-timeline.ts)", () => {
  test("14. clampToPlaybackRange leaves an in-range timestamp untouched (aside from minute rounding)", () => {
    const mid = new Date(START.getTime() + 30 * 60_000 + 15_000);
    const clamped = clampToPlaybackRange(mid, START, END_1H);
    expect(clamped.toISOString()).toBe("2026-09-17T00:30:00.000Z");
  });

  test("15. clampToPlaybackRange pulls an out-of-range timestamp back to the nearest boundary", () => {
    expect(clampToPlaybackRange(new Date(START.getTime() - 999_999), START, END_1H).getTime()).toBe(START.getTime());
    expect(clampToPlaybackRange(new Date(END_1H.getTime() + 999_999), START, END_1H).getTime()).toBe(END_1H.getTime());
  });
});
