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

function roundDownToMinute(date: Date): Date {
  const rounded = new Date(date.getTime());
  rounded.setSeconds(0, 0);
  return rounded;
}
