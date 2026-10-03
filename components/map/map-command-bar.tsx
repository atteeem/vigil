"use client";

import { useEffect, type ReactNode } from "react";
import { Flame, History, Layers, LayoutGrid, RotateCcw, SlidersHorizontal, HelpCircle, X } from "lucide-react";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { WhatChangedButton } from "@/components/brief/what-changed-panel";
import { WORLD_TIME_OPTIONS, type ViewMode } from "@/components/map/map-filters";
import { MAP_BASEMAP_MODE_LABEL, type MapBasemapMode } from "@/lib/map/style";
import { cn } from "@/lib/utils";
import type { TimeRange } from "@/lib/types";

/** The desktop map's expandable panels. Only one is open at a time (the page owns the state). */
export type MapPanelId = "timeline" | "filters" | "map" | "layers" | "legend" | "changed";

const BTN = "inline-flex min-h-[32px] shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
const BTN_IDLE = "border-border bg-surface/80 text-ink-dim hover:text-ink";
const BTN_ACTIVE = "border-accent/40 bg-accent-dim text-accent";
const BTN_OPEN = "border-ink bg-ink text-bg";
// Viewing the past is amber everywhere (bar outline, state chip, notice, map ring), never the live/accent colours.
const BTN_HISTORICAL = "border-elevated/60 bg-elevated-dim text-elevated";
const COMPACT_UTC = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
const BADGE = "rounded-full bg-accent/20 px-1.5 text-[10px] font-semibold text-accent";

export interface ActiveChip {
  id: string;
  label: string;
}

/**
 * The /world desktop command bar — the one place the map's controls live while collapsed:
 *   [ LIVE / historical time ] [ Time range ] [ Filters ] [ Layers ] [ Map mode ] [ Legend ] [ What changed ]
 * Everything detailed opens in ONE shared panel beneath it (see MapControlPanel), so the map keeps the screen.
 * Active filters and layers show as count badges and, below the bar, as short chips; viewing the past is never
 * hidden: the chip, the bar's outline and a one-line notice all stay visible, with Return to Live one click away.
 */
export function MapCommandBar({
  openPanel,
  onOpenPanel,
  isHistorical,
  asOf,
  onReturnToLive,
  timeRange,
  onTimeRange,
  filterCount,
  layerCount,
  viewMode,
  basemapMode,
  chips,
}: {
  openPanel: MapPanelId | null;
  onOpenPanel: (id: MapPanelId | null) => void;
  isHistorical: boolean;
  asOf: Date | null;
  onReturnToLive: () => void;
  timeRange: TimeRange;
  onTimeRange: (v: TimeRange) => void;
  filterCount: number;
  layerCount: number;
  viewMode: ViewMode;
  basemapMode: MapBasemapMode;
  chips: ActiveChip[];
}) {
  const toggle = (id: MapPanelId) => onOpenPanel(openPanel === id ? null : id);
  const state = (id: MapPanelId, active = false) => (openPanel === id ? BTN_OPEN : active ? BTN_ACTIVE : BTN_IDLE);

  useEffect(() => {
    if (!openPanel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenPanel(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openPanel, onOpenPanel]);

  return (
    <div className="pointer-events-auto flex max-w-full flex-col items-center gap-1.5" data-testid="map-command-bar" data-mode={isHistorical ? "historical" : "live"}>
      <div
        className={cn("flex max-w-full flex-wrap items-center justify-center gap-1.5 rounded-2xl border bg-surface/85 p-1.5 backdrop-blur-xl", isHistorical ? "border-elevated/70" : "border-border")}
        role="toolbar"
        aria-label="Map controls"
      >
        {/* 1. Live / historical state + the timeline panel */}
        <button
          type="button"
          onClick={() => toggle("timeline")}
          aria-expanded={openPanel === "timeline"}
          aria-controls="map-control-panel"
          data-testid="timeline-toggle"
          title={isHistorical ? "Viewing a past moment, not live data. Open to change it or to play back." : "Live: the map shows current published reports. Open to view a past moment."}
          className={cn(BTN, "font-semibold uppercase tracking-wide", openPanel === "timeline" ? BTN_OPEN : isHistorical ? BTN_HISTORICAL : "border-border bg-surface/80 text-ink hover:bg-white/5")}
        >
          {isHistorical && asOf ? (
            <>
              <History className="h-3.5 w-3.5" aria-hidden />
              <span data-testid="timeline-state">Historical · {COMPACT_UTC.format(asOf)} UTC</span>
            </>
          ) : (
            <>
              <span className="relative flex h-2 w-2" aria-hidden>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-stable opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-stable" />
              </span>
              <span data-testid="timeline-state">Live</span>
            </>
          )}
        </button>
        {isHistorical && (
          <button type="button" onClick={onReturnToLive} data-testid="return-to-live-inline" className={cn(BTN, "border-elevated bg-elevated text-bg hover:opacity-90")}>
            <RotateCcw className="h-3 w-3" aria-hidden /> Return to Live
          </button>
        )}

        {/* 2. Time range: how far back reports are shown (the playback timeline above is a different control). */}
        <div className={cn("flex items-center gap-1.5", isHistorical && "opacity-60")} title={isHistorical ? "Not used while viewing a past moment: the timeline sets the window." : "Show reports from the last…"}>
          <span className="hidden text-[10px] font-semibold uppercase tracking-wide text-ink-faint xl:inline" aria-hidden>
            Reports
          </span>
          <SegmentedControl aria-label="Time" size="sm" options={WORLD_TIME_OPTIONS} value={timeRange} onChange={onTimeRange} />
        </div>

        {/* 3-6. Panels */}
        <button type="button" onClick={() => toggle("filters")} aria-expanded={openPanel === "filters"} aria-controls="map-control-panel" data-testid="map-filters-button" title="Filter reports by event type and region" className={cn(BTN, state("filters", filterCount > 0))}>
          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden /> Filters
          {filterCount > 0 && <span className={BADGE} data-testid="map-filters-count">{filterCount}</span>}
        </button>
        <button type="button" onClick={() => toggle("layers")} aria-expanded={openPanel === "layers"} aria-controls="map-control-panel" data-testid="map-layers-button" title="Territorial control and live hazard layers" className={cn(BTN, state("layers", layerCount > 0))}>
          <Layers className="h-3.5 w-3.5" aria-hidden /> Layers
          {layerCount > 0 && <span className={BADGE} data-testid="map-layers-count">{layerCount}</span>}
        </button>
        <button type="button" onClick={() => toggle("map")} aria-expanded={openPanel === "map"} aria-controls="map-control-panel" data-testid="map-mode-button" title={`Map mode: ${viewMode === "heatmap" ? "Heatmap" : "Markers"} on the ${MAP_BASEMAP_MODE_LABEL[basemapMode]} basemap`} className={cn(BTN, state("map", viewMode === "heatmap"))}>
          {viewMode === "heatmap" ? <Flame className="h-3.5 w-3.5" aria-hidden /> : <LayoutGrid className="h-3.5 w-3.5" aria-hidden />}
          <span className="sr-only">Map mode: </span>
          {viewMode === "heatmap" ? "Heatmap" : "Markers"}
        </button>
        <button type="button" onClick={() => toggle("legend")} aria-expanded={openPanel === "legend"} aria-controls="map-control-panel" data-testid="map-legend-button" title="What the marks on the map mean" className={cn(BTN, state("legend"))}>
          <HelpCircle className="h-3.5 w-3.5" aria-hidden /> Legend
        </button>
        <WhatChangedButton open={openPanel === "changed"} onClick={() => toggle("changed")} className={cn(openPanel === "changed" ? BTN_OPEN : BTN_IDLE)} />
      </div>

      {/* Closed-state summary: what is currently narrowing or adding to the map, and the past-state notice. */}
      {(isHistorical && openPanel !== "timeline") || chips.length > 0 ? (
        <div className="flex max-w-full flex-wrap items-center justify-center gap-1" data-testid="map-active-state">
          {isHistorical && openPanel !== "timeline" && (
            <span className="rounded-full border border-elevated/40 bg-surface/85 px-2.5 py-0.5 text-[11px] text-elevated backdrop-blur-xl" data-testid="historical-notice">
              Past state, not live · conflict markers and status counters show the current registry
            </span>
          )}
          {chips.map((c) => (
            <span key={c.id} className="rounded-full border border-border bg-surface/85 px-2 py-0.5 text-[11px] text-ink-dim backdrop-blur-xl" data-testid="map-active-chip">
              {c.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** The single expandable panel under the command bar (a popover: it floats over the map and closes on Escape,
 * on its own close button, or when the map is clicked). */
export function MapControlPanel({ id, title, onClose, children, wide = false }: { id: MapPanelId; title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div
      id="map-control-panel"
      role="region"
      aria-label={title}
      data-testid="map-control-panel"
      data-panel={id}
      className={cn("pointer-events-auto max-h-[min(60vh,32rem)] w-full overflow-y-auto rounded-2xl border border-border bg-surface/95 p-3 shadow-xl backdrop-blur-xl", wide ? "max-w-2xl" : "max-w-xl")}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{title}</span>
        <button type="button" onClick={onClose} aria-label={`Close ${title.toLowerCase()} panel`} className="rounded p-1 text-ink-faint hover:text-ink">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {children}
    </div>
  );
}

/** A titled group inside a panel (EVENTS / MAP / INTELLIGENCE LAYERS / HAZARDS). */
export function PanelSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-border pb-3 last:border-0 last:pb-0 [&:not(:first-of-type)]:pt-3">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink">{title}</h3>
      {children}
    </section>
  );
}
