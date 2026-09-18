"use client";

import { useState } from "react";
import { History, RotateCcw, Play, Pause, SkipBack, SkipForward } from "lucide-react";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Button } from "@/components/ui/button";
import { formatAbsoluteTime, cn } from "@/lib/utils";
import {
  TIMELINE_RANGE_PRESETS,
  PLAYBACK_SPEEDS,
  playbackProgress,
  type TimelinePresetKey,
  type PlaybackSpeed,
} from "@/lib/utils/world-timeline";

const PRESET_OPTIONS = [{ value: "live" as const, label: "Live" }, ...TIMELINE_RANGE_PRESETS.map((r) => ({ value: r, label: r }))];

// 0-1000 rather than 0-100: finer drag resolution on the scrubber
// without needing float step values on the underlying range input.
const SCRUBBER_RESOLUTION = 1000;

/**
 * Global Timeline / Historical Playback (spec §1/§4/§5): the /world
 * map's time selector — deliberately a SEPARATE control from the
 * pre-existing recency filter (MapFilters' "Time" segmented control,
 * same 1H/6H/24H/7D labels, but a different concept: "only show events
 * from the last N hours" vs. this control's "show me the world as it
 * was N hours ago"). Keeping them visually distinct (own labeled row,
 * own icon, own "Viewing ..." banner) is deliberate — the two could
 * otherwise read as the same control with a confusing double meaning.
 *
 * Always shown in UTC (spec "keep interaction simple") rather than
 * wired to the user's timezone preference — this page is
 * server-rendered on first paint, and resolving "auto" timezone
 * differently between server and client would be a real hydration
 * mismatch for a value this visible, the same class of problem
 * EventDetailPanel's own timezone handling already works around
 * elsewhere with a mount-guard; UTC sidesteps it entirely and reads
 * naturally for a "global" timeline besides.
 */
export function TimelineControls({
  preset,
  asOf,
  rangeStart,
  rangeEnd,
  isPlaying,
  speed,
  onSelectPreset,
  onSelectCustom,
  onReturnToLive,
  onPlay,
  onPause,
  onStepForward,
  onStepBackward,
  onSetSpeed,
  onScrubProgress,
  className,
}: {
  preset: TimelinePresetKey;
  asOf: Date | null;
  rangeStart: Date | null;
  rangeEnd: Date | null;
  isPlaying: boolean;
  speed: PlaybackSpeed;
  onSelectPreset: (p: Exclude<TimelinePresetKey, "custom">) => void;
  onSelectCustom: (d: Date) => void;
  onReturnToLive: () => void;
  onPlay: () => void;
  onPause: () => void;
  onStepForward: () => void;
  onStepBackward: () => void;
  onSetSpeed: (speed: PlaybackSpeed) => void;
  onScrubProgress: (fraction: number) => void;
  className?: string;
}) {
  const [customOpen, setCustomOpen] = useState(false);
  const [customValue, setCustomValue] = useState("");

  function applyCustom() {
    if (!customValue) return;
    const date = new Date(customValue);
    if (Number.isNaN(date.getTime())) return;
    onSelectCustom(date);
    setCustomOpen(false);
  }

  const isHistorical = asOf !== null;
  const canPlayback = isHistorical && rangeStart !== null && rangeEnd !== null;
  const progress = canPlayback ? playbackProgress(asOf!, rangeStart!, rangeEnd!) : 0;
  const atRangeStart = canPlayback && asOf!.getTime() <= rangeStart!.getTime();
  const atRangeEnd = canPlayback && asOf!.getTime() >= rangeEnd!.getTime();

  return (
    <div className={cn("flex flex-col gap-2", className)} data-testid="timeline-controls">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex shrink-0 items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
          <History className="h-3 w-3" /> Timeline
        </span>
        <SegmentedControl
          // NOT "Timeline" or anything containing "Time" — Playwright's
          // getByRole name matching is substring-based by default, and
          // the pre-existing recency filter's own radiogroup is already
          // labeled "Time" (components/map/map-filters.tsx); a
          // "Timeline" label here would ambiguously match both groups in
          // any test using getByRole without exact:true (found via a
          // real test failure, not a hypothetical).
          aria-label="Playback"
          options={PRESET_OPTIONS}
          value={preset as Exclude<TimelinePresetKey, "custom">}
          onChange={onSelectPreset}
        />
        <button
          type="button"
          onClick={() => setCustomOpen((v) => !v)}
          aria-pressed={preset === "custom"}
          data-testid="timeline-custom-toggle"
          className={cn(
            "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
            preset === "custom"
              ? "border-accent/40 bg-accent-dim text-accent"
              : "border-border-strong text-ink-dim hover:text-ink",
          )}
        >
          Custom…
        </button>
      </div>

      {customOpen && (
        <div className="flex items-center gap-2" data-testid="timeline-custom-panel">
          <input
            type="datetime-local"
            value={customValue}
            // No `max` clamp to "now": a future timestamp is harmless
            // (it just degrades to the current state — see
            // reconstructEventState/reconstructWorldStateAt, already
            // covered by tests/world-timeline-api.spec.ts), and skipping
            // the clamp avoids a real class of picker edge cases (a
            // value a few seconds/minutes ahead of a fast-moving "now"
            // being silently rejected) for no real correctness benefit.
            onChange={(e) => setCustomValue(e.target.value)}
            className="rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-ink"
            data-testid="timeline-custom-input"
          />
          <Button size="sm" variant="accent" onClick={applyCustom} data-testid="timeline-custom-apply">
            View
          </Button>
        </div>
      )}

      {isHistorical && (
        <div
          className="flex flex-wrap items-center gap-2 rounded-lg border border-accent/30 bg-accent-dim/40 px-3 py-1.5 text-xs text-accent"
          data-testid="historical-indicator"
        >
          <span>Viewing {formatAbsoluteTime(asOf.toISOString(), "UTC")}</span>
          <Button size="sm" variant="ghost" onClick={onReturnToLive} className="ml-auto" data-testid="return-to-live-button">
            <RotateCcw className="h-3 w-3" /> Return to Live
          </Button>
        </div>
      )}

      {canPlayback && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface/60 px-3 py-2" data-testid="playback-controls">
          <div className="flex items-center gap-1.5">
            <Button
              size="icon"
              variant="ghost"
              onClick={onStepBackward}
              disabled={atRangeStart}
              aria-label="Step backward"
              data-testid="playback-step-backward"
            >
              <SkipBack className="h-3.5 w-3.5" />
            </Button>
            {isPlaying ? (
              <Button size="icon" variant="accent" onClick={onPause} aria-label="Pause" data-testid="playback-pause">
                <Pause className="h-3.5 w-3.5" />
              </Button>
            ) : (
              <Button
                size="icon"
                variant="accent"
                onClick={onPlay}
                disabled={atRangeEnd}
                aria-label="Play"
                data-testid="playback-play"
              >
                <Play className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              size="icon"
              variant="ghost"
              onClick={onStepForward}
              disabled={atRangeEnd}
              aria-label="Step forward"
              data-testid="playback-step-forward"
            >
              <SkipForward className="h-3.5 w-3.5" />
            </Button>

            <div className="ml-1 flex items-center gap-1" role="group" aria-label="Playback speed">
              {PLAYBACK_SPEEDS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => onSetSpeed(s)}
                  aria-pressed={speed === s}
                  data-testid={`playback-speed-${s}x`}
                  className={cn(
                    "rounded-full border px-2 py-1 text-[10px] font-medium transition-colors",
                    speed === s
                      ? "border-accent/40 bg-accent-dim text-accent"
                      : "border-border-strong text-ink-dim hover:text-ink",
                  )}
                >
                  {s}x
                </button>
              ))}
            </div>

            <span className="ml-auto text-[10px] text-ink-faint" data-testid="playback-progress-label">
              {Math.round(progress * 100)}%
            </span>
          </div>

          <input
            type="range"
            min={0}
            max={SCRUBBER_RESOLUTION}
            value={Math.round(progress * SCRUBBER_RESOLUTION)}
            onChange={(e) => onScrubProgress(Number(e.target.value) / SCRUBBER_RESOLUTION)}
            className="w-full accent-accent"
            aria-label="Playback position"
            data-testid="playback-scrubber"
          />
        </div>
      )}
    </div>
  );
}
