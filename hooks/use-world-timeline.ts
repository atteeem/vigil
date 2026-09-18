"use client";

import { useCallback, useMemo, useState } from "react";
import { resolveTimelineTimestamp, type TimelinePresetKey } from "@/lib/utils/world-timeline";

export interface WorldTimeline {
  preset: TimelinePresetKey;
  /** The resolved "as of" timestamp, or null for Live. A snapshot fixed
   * at selection time — it does not drift as real time passes, since
   * "1H ago" means the world one hour before the click, not a
   * continuously-rolling window. */
  asOf: Date | null;
  isHistorical: boolean;
  selectPreset: (preset: Exclude<TimelinePresetKey, "custom">) => void;
  selectCustomTimestamp: (date: Date) => void;
  returnToLive: () => void;
}

/**
 * Global Timeline / Historical Playback — the /world page's timeline
 * state. Playback foundation (spec §6): the entire piece of state a
 * future Play/Pause animation needs to drive is `asOf`; advancing
 * playback is just repeated calls to a setter that moves it forward
 * (e.g. `selectCustomTimestamp(new Date(asOf.getTime() + stepMs))` on an
 * interval) — WorldMap, the heatmap, and clusters are already pure
 * functions of whatever events array they're given (see
 * app/world/page.tsx), so nothing else needs to change shape to support
 * that later.
 */
export function useWorldTimeline(): WorldTimeline {
  const [preset, setPreset] = useState<TimelinePresetKey>("live");
  const [customTimestamp, setCustomTimestamp] = useState<Date | null>(null);

  // Resolved once per preset/customTimestamp change, not on every
  // render or on a timer — a historical selection is a fixed point in
  // time, not a moving one (see resolveTimelineTimestamp's own comment).
  const asOf = useMemo(() => resolveTimelineTimestamp(preset, new Date(), customTimestamp), [preset, customTimestamp]);

  const selectPreset = useCallback((next: Exclude<TimelinePresetKey, "custom">) => {
    setPreset(next);
  }, []);

  const selectCustomTimestamp = useCallback((date: Date) => {
    setCustomTimestamp(date);
    setPreset("custom");
  }, []);

  const returnToLive = useCallback(() => {
    setPreset("live");
  }, []);

  return { preset, asOf, isHistorical: asOf !== null, selectPreset, selectCustomTimestamp, returnToLive };
}
