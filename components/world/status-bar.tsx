"use client";

import { Radio } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CommandCenter } from "@/lib/world/types";
import { timeAgo } from "@/lib/utils/format";

const LIVE_TONE = { live: "text-stable", delayed: "text-accent", stale: "text-extreme", "no-data": "text-ink-faint" } as const;

function Stat({ label, value, testId, hint }: { label: string; value: string; testId: string; hint: string }) {
  return (
    <div className="flex items-baseline gap-1.5 whitespace-nowrap" title={hint}>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{label}</span>
      <span className="text-sm font-semibold tabular-nums text-ink" data-testid={testId}>
        {value}
      </span>
    </div>
  );
}

/** Compact status strip: three counters and the data-freshness indicator (from real ingestion timestamps). */
export function StatusBar({ data, loading, error, liveView }: { data: CommandCenter | undefined; loading: boolean; error: boolean; liveView: { active: boolean; paused: boolean; disabled: boolean; onToggle: () => void; onPauseResume: () => void } }) {
  const s = data?.status;
  const v = (n: number | undefined) => (s && n != null ? String(n) : loading ? "…" : "—");
  // Historical Playback (§6): the conflict registry has no version history, so these two counters always
  // read CURRENT state — never presented as though they describe the replayed moment.
  const historical = Boolean(data?.meta.asOf);
  const liveOnlySuffix = historical ? " — showing the current registry, not this historical moment." : "";
  return (
    <div className="no-scrollbar flex h-9 shrink-0 items-center gap-5 overflow-x-auto border-b border-border bg-surface/70 px-4 backdrop-blur" data-testid="status-bar" role="region" aria-label="World status">
      <Stat label={historical ? "Active conflicts (live)" : "Active conflicts"} value={v(s?.activeConflicts)} testId="stat-active" hint={`Conflicts with status Active in the canonical registry.${liveOnlySuffix}`} />
      <Stat label={historical ? "High tension (live)" : "High tension"} value={v(s?.highTension)} testId="stat-tension" hint={`Active conflicts with a severity score of ${data?.meta.thresholds.highTensionMinScore ?? 70} or more.${liveOnlySuffix}`} />
      <Stat label="New developments" value={v(s?.newDevelopments)} testId="stat-new" hint="Significant, de-duplicated developments in the last 24 hours (state changes, not article counts)." />
      <div className={cn("ml-auto hidden items-center gap-1.5 whitespace-nowrap text-[11px] sm:flex font-semibold uppercase tracking-wider", s ? LIVE_TONE[s.live.state] : "text-ink-faint")} data-testid="live-indicator" data-live-state={s?.live.state ?? (error ? "error" : "loading")} title={s?.live.lastIngestionAt ? `Newest successful ingestion ${timeAgo(s.live.lastIngestionAt)}` : "No successful ingestion recorded"}>
        <span className={cn("h-1.5 w-1.5 rounded-full bg-current", s?.live.state === "live" && "animate-pulse")} />
        {s ? s.live.label : error ? "UNAVAILABLE" : "…"}
      </div>
      {/* Phones: Live View first, where the thumb finds it without scrolling the strip. */}
      <div className="order-first flex shrink-0 items-center gap-1.5 sm:order-none">
        <button type="button" onClick={liveView.onToggle} disabled={liveView.disabled && !liveView.active} aria-pressed={liveView.active} data-testid="live-view-button" title={liveView.disabled && !liveView.active ? "No recent developments to cycle through" : "Cycle through recent developments on the map"} className={cn("inline-flex min-h-[28px] items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide transition-colors disabled:opacity-40", liveView.active ? "border-accent bg-accent/15 text-accent" : "border-border text-ink-dim hover:text-ink")}>
          <Radio className="h-3 w-3" /> Live view
        </button>
        {liveView.active && (
          <button type="button" onClick={liveView.onPauseResume} data-testid="live-view-pause" className="rounded-full border border-border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink-dim hover:text-ink">
            {liveView.paused ? "Resume" : "Pause"}
          </button>
        )}
      </div>
    </div>
  );
}
