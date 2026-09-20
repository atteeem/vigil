"use client";

import { LayoutGrid, Flame, Flag } from "lucide-react";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { EVENT_TYPE_LABEL } from "@/components/events/event-type-icon";
import { EVENT_TYPES, REGIONS, type EventType, type Region, type TimeRange } from "@/lib/types";
import { MAP_BASEMAP_MODES, MAP_BASEMAP_MODE_LABEL, type MapBasemapMode } from "@/lib/map/style";
import { cn } from "@/lib/utils";
import { HazardLayerPanel } from "@/components/map/hazard-layer-panel";
import type { HazardLayer } from "@/lib/hazards/types";
import type { HazardLayerHealth } from "@/lib/hazards/public-types";

export type TypeFilter = "all" | EventType;
export type RegionFilter = "Global" | Region;
export type ViewMode = "markers" | "heatmap";

const WORLD_TIME_OPTIONS: { value: TimeRange; label: string }[] = [
  { value: "1H", label: "1H" },
  { value: "6H", label: "6H" },
  { value: "24H", label: "24H" },
  { value: "7D", label: "7D" },
];

export function MapFilters({
  typeFilter,
  onTypeFilter,
  region,
  onRegion,
  timeRange,
  onTimeRange,
  viewMode,
  onViewMode,
  basemapMode,
  onBasemapMode,
  showTerritorial,
  onToggleTerritorial,
  hazardLayers = [],
  onToggleHazardLayer,
  hazardHealth,
  className,
}: {
  typeFilter: TypeFilter;
  onTypeFilter: (v: TypeFilter) => void;
  region: RegionFilter;
  onRegion: (v: RegionFilter) => void;
  timeRange: TimeRange;
  onTimeRange: (v: TimeRange) => void;
  viewMode: ViewMode;
  onViewMode: (v: ViewMode) => void;
  basemapMode: MapBasemapMode;
  onBasemapMode: (v: MapBasemapMode) => void;
  // Territorial Control Mode — an independent toggle, not a third
  // mutually-exclusive viewMode value (see world-map.tsx's own comment):
  // it composes with either Markers or Heatmap, so ON + Heatmap is spec's
  // "Both" mode.
  showTerritorial: boolean;
  onToggleTerritorial: (v: boolean) => void;
  // Natural-hazard layers (Live Global Data Layers): a compact expandable group, all off by default.
  hazardLayers?: readonly HazardLayer[];
  onToggleHazardLayer?: (layer: HazardLayer) => void;
  hazardHealth?: readonly HazardLayerHealth[];
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2.5", className)}>
      <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto">
        {(["all", ...EVENT_TYPES] as TypeFilter[]).map((t) => (
          <button
            key={t}
            onClick={() => onTypeFilter(t)}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              typeFilter === t
                ? "border-accent/40 bg-accent-dim text-accent"
                : "border-border-strong text-ink-dim hover:text-ink",
            )}
          >
            {t === "all" ? "All" : EVENT_TYPE_LABEL[t]}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          aria-label="Basemap"
          options={MAP_BASEMAP_MODES.map((m) => ({ value: m, label: MAP_BASEMAP_MODE_LABEL[m] }))}
          value={basemapMode}
          onChange={onBasemapMode}
        />
        <SegmentedControl aria-label="Time" options={WORLD_TIME_OPTIONS} value={timeRange} onChange={onTimeRange} />
        <SegmentedControl
          aria-label="Region"
          options={[{ value: "Global", label: "Global" }, ...REGIONS.map((r) => ({ value: r, label: r }))]}
          value={region}
          onChange={onRegion}
        />
        <div className="ml-auto flex items-center gap-1 rounded-full border border-border bg-surface/70 p-1">
          <button
            onClick={() => onViewMode("markers")}
            aria-pressed={viewMode === "markers"}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium",
              viewMode === "markers" ? "bg-ink text-bg" : "text-ink-dim hover:text-ink",
            )}
          >
            <LayoutGrid className="h-3.5 w-3.5" /> Markers
          </button>
          <button
            onClick={() => onViewMode("heatmap")}
            aria-pressed={viewMode === "heatmap"}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium",
              viewMode === "heatmap" ? "bg-ink text-bg" : "text-ink-dim hover:text-ink",
            )}
          >
            <Flame className="h-3.5 w-3.5" /> Heatmap
          </button>
        </div>
        <button
          onClick={() => onToggleTerritorial(!showTerritorial)}
          aria-pressed={showTerritorial}
          data-testid="territorial-toggle"
          className={cn(
            "flex items-center gap-1.5 rounded-full border p-1 px-3 py-1.5 text-xs font-medium transition-colors",
            showTerritorial ? "border-accent/40 bg-accent-dim text-accent" : "border-border-strong text-ink-dim hover:text-ink",
          )}
        >
          <Flag className="h-3.5 w-3.5" /> Territorial Control
        </button>
        {onToggleHazardLayer && <HazardLayerPanel enabled={hazardLayers} onToggle={onToggleHazardLayer} health={hazardHealth} />}
      </div>
    </div>
  );
}
