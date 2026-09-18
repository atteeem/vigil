"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  resolveTimelineTimestamp,
  playbackStepMs,
  advancePlaybackTimestamp,
  clampToPlaybackRange,
  timestampAtProgress,
  roundDownToMinute,
  PLAYBACK_TICK_MS,
  type TimelinePresetKey,
  type PlaybackSpeed,
} from "@/lib/utils/world-timeline";

export interface WorldTimeline {
  preset: TimelinePresetKey;
  /** The timestamp currently being viewed, or null for Live. Starts as
   * the preset/custom selection's own resolved point and can move from
   * there via play/step/scrub — see `rangeStart` for that original,
   * fixed starting point. */
  asOf: Date | null;
  isHistorical: boolean;
  selectPreset: (preset: Exclude<TimelinePresetKey, "custom">) => void;
  selectCustomTimestamp: (date: Date) => void;
  returnToLive: () => void;

  // Animated Global Timeline Playback (spec "turn the existing
  // historical timeline into smooth Play/Pause playback without
  // changing the underlying reconstruction architecture"). The
  // playback range is always implicit from the active selection above —
  // rangeStart is that selection's own resolved timestamp (frozen, like
  // asOf always was), rangeEnd is "now" as of the moment that selection
  // was made (also frozen, not live-updating, so the range — and the
  // scrubber's 0-100% — stays stable for the whole session instead of
  // perpetually growing).
  rangeStart: Date | null;
  rangeEnd: Date | null;
  isPlaying: boolean;
  speed: PlaybackSpeed;
  play: () => void;
  pause: () => void;
  stepForward: () => void;
  stepBackward: () => void;
  setSpeed: (speed: PlaybackSpeed) => void;
  /** Jumps directly to a timestamp within the range (clamped) and pauses
   * — the progress slider's onChange, and spec's "dragging ... pauses
   * playback cleanly". */
  scrubTo: (date: Date) => void;
  /** Same as scrubTo but takes a 0-1 fraction of the range — what the
   * range-input scrubber actually reports. */
  scrubToProgress: (fraction: number) => void;
  /** The timestamp ONE tick further than `asOf`, only while playing —
   * lets hooks/use-world-events.ts warm its cache for the next frame
   * before it's actually needed (spec "prefetch nearby timestamps if
   * useful"). Null whenever there's nothing meaningful to prefetch. */
  previewNextAsOf: Date | null;
}

/**
 * Global Timeline / Historical Playback — the /world page's timeline
 * state, now including animated playback. All of it still boils down to
 * one displayed value, `asOf`, which is exactly what the rest of the
 * page (WorldMap, heatmap, clusters, event detail) already only cares
 * about — playback just became one more way to move it, alongside
 * preset/custom selection, no new consumer-facing shape.
 */
export function useWorldTimeline(): WorldTimeline {
  const [preset, setPreset] = useState<TimelinePresetKey>("live");
  const [customTimestamp, setCustomTimestamp] = useState<Date | null>(null);
  // "now" frozen at the moment of the current selection — null in Live
  // mode, where there's no range to play back through.
  const [rangeEnd, setRangeEnd] = useState<Date | null>(null);
  // Overrides rangeStart once play/step/scrub has moved off the initial
  // selected point; reset to null (falls back to rangeStart) by every
  // fresh preset/custom selection.
  const [playbackAsOf, setPlaybackAsOf] = useState<Date | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);

  // Resolved once per preset/customTimestamp change, not on every
  // render or on a timer — this is the range's OWN starting point, a
  // fixed moment in time (see resolveTimelineTimestamp's own comment).
  const rangeStart = useMemo(() => resolveTimelineTimestamp(preset, new Date(), customTimestamp), [preset, customTimestamp]);

  const asOf = playbackAsOf ?? rangeStart;

  // Every setter below resets playback state SYNCHRONOUSLY in the same
  // handler that changes preset/customTimestamp (not via a separate
  // effect reacting to them afterward) — React batches these into one
  // re-render, so there's never a frame where the new preset is applied
  // but stale playback state briefly shows through.
  const selectPreset = useCallback((next: Exclude<TimelinePresetKey, "custom">) => {
    setPreset(next);
    setPlaybackAsOf(null);
    setIsPlaying(false);
    setRangeEnd(next === "live" ? null : roundDownToMinute(new Date()));
  }, []);

  const selectCustomTimestamp = useCallback((date: Date) => {
    setCustomTimestamp(date);
    setPreset("custom");
    setPlaybackAsOf(null);
    setIsPlaying(false);
    setRangeEnd(roundDownToMinute(new Date()));
  }, []);

  const returnToLive = useCallback(() => {
    setPreset("live");
    setPlaybackAsOf(null);
    setIsPlaying(false);
    setRangeEnd(null);
  }, []);

  const play = useCallback(() => {
    if (rangeStart === null || rangeEnd === null) return; // nothing to play in Live mode
    setIsPlaying(true);
  }, [rangeStart, rangeEnd]);

  const pause = useCallback(() => setIsPlaying(false), []);

  const step = useCallback(
    (direction: 1 | -1) => {
      if (rangeStart === null || rangeEnd === null) return;
      setIsPlaying(false);
      setPlaybackAsOf((prev) => {
        const current = prev ?? rangeStart;
        const stepMs = playbackStepMs(rangeStart, rangeEnd);
        return advancePlaybackTimestamp(current, stepMs, speed, direction, rangeStart, rangeEnd);
      });
    },
    [rangeStart, rangeEnd, speed],
  );
  const stepForward = useCallback(() => step(1), [step]);
  const stepBackward = useCallback(() => step(-1), [step]);

  const scrubTo = useCallback(
    (date: Date) => {
      if (rangeStart === null || rangeEnd === null) return;
      setIsPlaying(false);
      setPlaybackAsOf(clampToPlaybackRange(date, rangeStart, rangeEnd));
    },
    [rangeStart, rangeEnd],
  );

  const scrubToProgress = useCallback(
    (fraction: number) => {
      if (rangeStart === null || rangeEnd === null) return;
      setIsPlaying(false);
      setPlaybackAsOf(timestampAtProgress(fraction, rangeStart, rangeEnd));
    },
    [rangeStart, rangeEnd],
  );

  // The actual ticking. A "latest asOf" ref, not `asOf` itself, as the
  // dependency: including `asOf` directly would tear the interval down
  // and rebuild it every single tick (since asOf changes every tick),
  // which both defeats a steady cadence and would be needless churn —
  // the ref lets the interval read the current position without being
  // recreated because of it.
  const asOfRef = useRef(asOf);
  useEffect(() => {
    asOfRef.current = asOf;
  }, [asOf]);

  useEffect(() => {
    if (!isPlaying || rangeStart === null || rangeEnd === null) return;
    const id = setInterval(() => {
      const current = asOfRef.current ?? rangeStart;
      const stepMs = playbackStepMs(rangeStart, rangeEnd);
      const next = advancePlaybackTimestamp(current, stepMs, speed, 1, rangeStart, rangeEnd);
      setPlaybackAsOf(next);
      if (next.getTime() >= rangeEnd.getTime()) {
        // Reached the end of the range — auto-pause exactly at the
        // boundary rather than looping or drifting past it.
        setIsPlaying(false);
      }
    }, PLAYBACK_TICK_MS);
    return () => clearInterval(id);
  }, [isPlaying, rangeStart, rangeEnd, speed]);

  const previewNextAsOf = useMemo(() => {
    if (!isPlaying || rangeStart === null || rangeEnd === null || asOf === null) return null;
    const stepMs = playbackStepMs(rangeStart, rangeEnd);
    const next = advancePlaybackTimestamp(asOf, stepMs, speed, 1, rangeStart, rangeEnd);
    return next.getTime() === asOf.getTime() ? null : next;
  }, [isPlaying, rangeStart, rangeEnd, asOf, speed]);

  return {
    preset,
    asOf,
    isHistorical: asOf !== null,
    selectPreset,
    selectCustomTimestamp,
    returnToLive,
    rangeStart,
    rangeEnd,
    isPlaying,
    speed,
    play,
    pause,
    stepForward,
    stepBackward,
    setSpeed,
    scrubTo,
    scrubToProgress,
    previewNextAsOf,
  };
}
