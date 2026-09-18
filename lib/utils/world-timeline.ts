import { TIME_RANGE_MS } from "./time-range";
import type { TimeRange } from "@/lib/types";

/**
 * Global Timeline / Historical Playback — pure preset-to-timestamp
 * resolution, no React. `TimelinePresetKey` deliberately extends the
 * EXISTING `TimeRange` type (1H/6H/24H/7D/30D, already used by the map's
 * unrelated recency filter — see components/map/map-filters.tsx) rather
 * than inventing a parallel set of period constants, plus two states
 * `TimeRange` doesn't have: "live" (the default — not a timestamp at
 * all) and "custom" (a user-picked date/time).
 */
export type TimelinePresetKey = "live" | TimeRange | "custom";

export const TIMELINE_RANGE_PRESETS: TimeRange[] = ["1H", "6H", "24H", "7D", "30D"];

/**
 * Resolves a preset to the "as of" timestamp it represents, or `null`
 * for Live — the map's live/current data path, not a historical
 * reconstruction. `now` is passed in (not read internally) so this stays
 * pure and directly testable.
 *
 * Rounded down to the minute: (a) the "Viewing ..." indicator never
 * shows a confusing stray second, and (b) re-resolving the same preset
 * twice within the same minute yields the IDENTICAL timestamp, which is
 * what lets hooks/use-world-events.ts's exact-timestamp cache actually
 * hit instead of missing on sub-second jitter.
 */
export function resolveTimelineTimestamp(preset: TimelinePresetKey, now: Date, customTimestamp?: Date | null): Date | null {
  if (preset === "live") return null;
  if (preset === "custom") return customTimestamp ? roundDownToMinute(customTimestamp) : null;
  return roundDownToMinute(new Date(now.getTime() - TIME_RANGE_MS[preset]));
}

/** Exported so callers that mint a fresh "now" for other purposes (e.g.
 * hooks/use-world-timeline.ts's playback rangeEnd) can share the exact
 * same rounding convention as `resolveTimelineTimestamp` — keeping both
 * ends of a playback range on the same minute granularity is what makes
 * `rangeEnd - rangeStart` (and therefore every step/progress
 * calculation over it) land on clean, whole-minute values instead of
 * carrying a few seconds of skew from whenever "now" happened to be
 * captured. */
export function roundDownToMinute(date: Date): Date {
  const rounded = new Date(date.getTime());
  rounded.setSeconds(0, 0);
  return rounded;
}

/**
 * Animated Global Timeline Playback — pure playback math, no React (same
 * split as resolveTimelineTimestamp above). The "playback range" is
 * always implicit from whatever historical selection is already active
 * (spec "preserve existing Live/1H/6H/24H/7D/30D/Custom controls" — no
 * new range-selection UI): `rangeStart` is that selection's resolved
 * timestamp, `rangeEnd` is "now" as it was at the moment of selection
 * (frozen, not live-updating — see hooks/use-world-timeline.ts).
 */
export const PLAYBACK_SPEEDS = [0.5, 1, 2, 4] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

// Fixed cadence the ticking interval fires at, independent of speed —
// speed only changes how far `asOf` jumps per tick (see
// advancePlaybackTimestamp), never how often a tick (and therefore a
// potential fetch) happens. This is what bounds the request rate at
// every speed (spec "prevent request buildup at higher speeds") and
// keeps ticking well short of "per animation frame" (spec "avoid
// per-frame backend calls").
export const PLAYBACK_TICK_MS = 500;

// A full range traverses in this many ticks at 1x — chosen so a 1H
// range steps in ~1-minute increments and a 30D range steps in
// ~12-hour increments (spec "short ranges → smaller time steps, long
// ranges → larger time steps"), floored so an already-short range never
// produces a step finer than the cache's own minute granularity.
const PLAYBACK_TOTAL_STEPS = 60;
const PLAYBACK_MIN_STEP_MS = 60_000;

/** How far one playback tick moves `asOf`, before the speed multiplier —
 * proportional to the selected range's own span, per spec §2. */
export function playbackStepMs(rangeStart: Date, rangeEnd: Date): number {
  const span = rangeEnd.getTime() - rangeStart.getTime();
  if (span <= 0) return PLAYBACK_MIN_STEP_MS;
  return Math.max(PLAYBACK_MIN_STEP_MS, Math.round(span / PLAYBACK_TOTAL_STEPS));
}

/** Clamps a timestamp into `[rangeStart, rangeEnd]`, rounded down to the
 * minute (same convention as resolveTimelineTimestamp, so every asOf
 * this module can produce — whether from a preset, a step, a scrub, or
 * a playback tick — shares one cache-key granularity). */
export function clampToPlaybackRange(date: Date, rangeStart: Date, rangeEnd: Date): Date {
  const clamped = Math.min(Math.max(date.getTime(), rangeStart.getTime()), rangeEnd.getTime());
  return roundDownToMinute(new Date(clamped));
}

/** One step (or one playback tick) forward/backward from `current`,
 * clamped to the range. `direction` is +1 (forward — the only direction
 * Play itself ever advances) or -1 (Step Backward only). */
export function advancePlaybackTimestamp(
  current: Date,
  stepMs: number,
  speed: number,
  direction: 1 | -1,
  rangeStart: Date,
  rangeEnd: Date,
): Date {
  const next = current.getTime() + stepMs * speed * direction;
  return clampToPlaybackRange(new Date(next), rangeStart, rangeEnd);
}

/** 0-1 fraction of the way through the range — "progress through
 * selected range" (spec §3), and what drives the scrubber's position. */
export function playbackProgress(current: Date, rangeStart: Date, rangeEnd: Date): number {
  const span = rangeEnd.getTime() - rangeStart.getTime();
  if (span <= 0) return 1;
  return Math.min(1, Math.max(0, (current.getTime() - rangeStart.getTime()) / span));
}

/** Inverse of playbackProgress — maps a scrubber position (0-1) back to
 * a timestamp within the range, for the draggable progress slider. */
export function timestampAtProgress(fraction: number, rangeStart: Date, rangeEnd: Date): Date {
  const clampedFraction = Math.min(1, Math.max(0, fraction));
  const t = rangeStart.getTime() + clampedFraction * (rangeEnd.getTime() - rangeStart.getTime());
  return clampToPlaybackRange(new Date(t), rangeStart, rangeEnd);
}
