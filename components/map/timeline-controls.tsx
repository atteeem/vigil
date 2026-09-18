"use client";

import { useState } from "react";
import { History, RotateCcw } from "lucide-react";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Button } from "@/components/ui/button";
import { formatAbsoluteTime, cn } from "@/lib/utils";
import { TIMELINE_RANGE_PRESETS, type TimelinePresetKey } from "@/lib/utils/world-timeline";

const PRESET_OPTIONS = [{ value: "live" as const, label: "Live" }, ...TIMELINE_RANGE_PRESETS.map((r) => ({ value: r, label: r }))];

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
  onSelectPreset,
  onSelectCustom,
  onReturnToLive,
  className,
}: {
  preset: TimelinePresetKey;
  asOf: Date | null;
  onSelectPreset: (p: Exclude<TimelinePresetKey, "custom">) => void;
  onSelectCustom: (d: Date) => void;
  onReturnToLive: () => void;
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
    </div>
  );
}
