"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { MapFilters, type TypeFilter, type RegionFilter, type ViewMode } from "@/components/map/map-filters";
import { EventCard } from "@/components/events/event-card";
import { EventDetailPanel } from "@/components/events/event-detail-panel";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { MOCK_EVENTS } from "@/lib/data/mock-events";
import { MOCK_NOW } from "@/lib/data/constants";
import { isWithinRange } from "@/lib/utils/time-range";
import { cn } from "@/lib/utils";
import type { ConflictEvent, TimeRange } from "@/lib/types";
import { GlobeLoading } from "@/components/globe/globe-loading";
import { useAppStore } from "@/hooks/use-app-store";
import { useLiveEvents } from "@/hooks/use-live-events";
import { useWorldTimeline } from "@/hooks/use-world-timeline";
import { useWorldEvents } from "@/hooks/use-world-events";
import { TimelineControls } from "@/components/map/timeline-controls";

const WorldMap = dynamic(() => import("@/components/map/world-map").then((m) => m.WorldMap), {
  ssr: false,
  loading: () => <GlobeLoading />,
});

export default function WorldPage() {
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [region, setRegion] = useState<RegionFilter>("Global");
  const [timeRange, setTimeRange] = useState<TimeRange>("24H");
  const [viewMode, setViewMode] = useState<ViewMode>("markers");
  const [selected, setSelected] = useState<ConflictEvent | null>(null);
  const basemapMode = useAppStore((s) => s.mapBasemapMode);
  const setBasemapMode = useAppStore((s) => s.setMapBasemapMode);
  const liveEvents = useLiveEvents();

  // Global Timeline / Historical Playback: `timeline.asOf` is null for
  // Live and a fixed past Date once a preset/custom timestamp is
  // selected — see hooks/use-world-timeline.ts for why that single value
  // is enough state for a later Play/Pause animation too.
  const timeline = useWorldTimeline();
  const { events: historicalEvents, loading: historicalLoading } = useWorldEvents(timeline.asOf);

  // Published admin events are merged in alongside the mock-data set, so
  // /world keeps working exactly as before with zero live events (e.g. a
  // fresh DB) and grows automatically as reports get published — see
  // Implementation Order #13 / spec §15. In historical mode, mock events
  // are deliberately EXCLUDED: they have no createdAt/history to
  // reconstruct from, so mixing them into "the world as it was at time
  // T" would be showing data with no real historical grounding — spec
  // "do not show current event state while the map is in historical
  // mode" is read here as "only show data that's actually been
  // reconstructed for T."
  const allEvents = useMemo(
    () => (timeline.isHistorical ? historicalEvents : [...MOCK_EVENTS, ...liveEvents]),
    [timeline.isHistorical, historicalEvents, liveEvents],
  );

  const filteredEvents = useMemo(() => {
    return allEvents.filter((e) => {
      if (typeFilter !== "all" && e.eventType !== typeFilter) return false;
      if (region !== "Global" && e.region !== region) return false;
      // The recency filter ("only show events from the last N hours,
      // relative to right now") is a different axis from the timeline's
      // own historical selection and would otherwise filter out almost
      // everything when viewing a point further back than the recency
      // window — skipped while historical, since "show me everything
      // known as of T" is the whole point of that mode.
      if (!timeline.isHistorical && !isWithinRange(e.occurredAt, timeRange, MOCK_NOW)) return false;
      return true;
    });
  }, [allEvents, typeFilter, region, timeRange, timeline.isHistorical]);

  return (
    <main className="relative h-screen w-full overflow-hidden pt-16 sm:pt-0">
      <div className="grid h-full grid-cols-1 sm:grid-cols-[320px_1fr_360px]">
        {/* Desktop live feed */}
        <aside className="hidden h-full flex-col overflow-y-auto border-r border-border bg-surface/60 p-4 pt-24 sm:flex">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-ink-faint">
            {timeline.isHistorical ? "Historical Event Feed" : "Live Event Feed"}
          </h2>
          <p className="mb-3 text-xs text-ink-faint">
            {timeline.isHistorical && historicalLoading ? "Loading historical state…" : `${filteredEvents.length} events in range`}
          </p>
          <div className="space-y-3">
            {filteredEvents.slice(0, 40).map((e) => (
              <button key={e.id} onClick={() => setSelected(e)} className="block w-full text-left">
                <EventCard event={e} compact />
              </button>
            ))}
            {filteredEvents.length === 0 && (
              <p className="mt-8 text-center text-xs text-ink-faint">No events match your filters.</p>
            )}
          </div>
        </aside>

        {/* Map */}
        <div className="relative h-full">
          <WorldMap
            events={filteredEvents}
            viewMode={viewMode}
            basemapMode={basemapMode}
            onSelectEvent={setSelected}
            className={cn(
              "absolute inset-0 h-full w-full",
              // Avoid users mistaking historical data for live data: a
              // persistent amber ring around the viewport itself, not
              // just the banner text, so it reads at a glance even if
              // the top overlay scrolls out of view on mobile.
              timeline.isHistorical && "ring-2 ring-inset ring-accent/50",
            )}
          />
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col items-center gap-2 px-4 pt-4 sm:pt-24">
            <div className="pointer-events-auto w-full max-w-2xl rounded-2xl border border-border bg-surface/80 p-3 backdrop-blur-xl">
              <TimelineControls
                preset={timeline.preset}
                asOf={timeline.asOf}
                onSelectPreset={timeline.selectPreset}
                onSelectCustom={timeline.selectCustomTimestamp}
                onReturnToLive={timeline.returnToLive}
              />
            </div>
            <div className="pointer-events-auto w-full max-w-2xl rounded-2xl border border-border bg-surface/80 p-3 backdrop-blur-xl">
              <MapFilters
                typeFilter={typeFilter}
                onTypeFilter={setTypeFilter}
                region={region}
                onRegion={setRegion}
                timeRange={timeRange}
                onTimeRange={setTimeRange}
                viewMode={viewMode}
                onViewMode={setViewMode}
                basemapMode={basemapMode}
                onBasemapMode={setBasemapMode}
              />
            </div>
          </div>
        </div>

        {/* Desktop selected-event panel */}
        <aside className="hidden h-full overflow-y-auto border-l border-border bg-surface/60 p-5 pt-24 sm:block">
          {selected ? (
            <>
              <button
                onClick={() => setSelected(null)}
                className="mb-3 inline-flex items-center gap-1 text-xs text-ink-faint hover:text-ink"
              >
                <X className="h-3.5 w-3.5" /> Close
              </button>
              <EventDetailPanel event={selected} />
            </>
          ) : (
            <p className="mt-8 text-center text-sm text-ink-faint">
              Select an event on the map or feed to see details.
            </p>
          )}
        </aside>
      </div>

      {/* Mobile bottom sheet */}
      <BottomSheet open={!!selected} onClose={() => setSelected(null)} label={selected?.title}>
        {selected && <EventDetailPanel event={selected} />}
      </BottomSheet>
    </main>
  );
}
