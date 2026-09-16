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
import type { ConflictEvent, TimeRange } from "@/lib/types";
import { GlobeLoading } from "@/components/globe/globe-loading";
import { useAppStore } from "@/hooks/use-app-store";
import { useLiveEvents } from "@/hooks/use-live-events";

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

  // Published admin events are merged in alongside the mock-data set, so
  // /world keeps working exactly as before with zero live events (e.g. a
  // fresh DB) and grows automatically as reports get published — see
  // Implementation Order #13 / spec §15.
  const allEvents = useMemo(() => [...MOCK_EVENTS, ...liveEvents], [liveEvents]);

  const filteredEvents = useMemo(() => {
    return allEvents.filter((e) => {
      if (typeFilter !== "all" && e.eventType !== typeFilter) return false;
      if (region !== "Global" && e.region !== region) return false;
      if (!isWithinRange(e.occurredAt, timeRange, MOCK_NOW)) return false;
      return true;
    });
  }, [allEvents, typeFilter, region, timeRange]);

  return (
    <main className="relative h-screen w-full overflow-hidden pt-16 sm:pt-0">
      <div className="grid h-full grid-cols-1 sm:grid-cols-[320px_1fr_360px]">
        {/* Desktop live feed */}
        <aside className="hidden h-full flex-col overflow-y-auto border-r border-border bg-surface/60 p-4 pt-24 sm:flex">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-ink-faint">
            Live Event Feed
          </h2>
          <p className="mb-3 text-xs text-ink-faint">{filteredEvents.length} events in range</p>
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
            className="absolute inset-0 h-full w-full"
          />
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center px-4 pt-4 sm:pt-24">
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
