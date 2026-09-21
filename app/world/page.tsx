"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { MapFilters, type TypeFilter, type RegionFilter, type ViewMode } from "@/components/map/map-filters";
import { EventCard } from "@/components/events/event-card";
import { EventDetailPanel } from "@/components/events/event-detail-panel";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { usePublicOverview } from "@/hooks/use-public-overview";
import { selectHeatConflicts } from "@/lib/heat/public-inputs";
import { isWithinRange } from "@/lib/utils/time-range";
import { cn } from "@/lib/utils";
import type { ConflictEvent, TimeRange } from "@/lib/types";
import { GlobeLoading } from "@/components/globe/globe-loading";
import { useAppStore } from "@/hooks/use-app-store";
import { useLiveEvents } from "@/hooks/use-live-events";
import { useWorldTimeline } from "@/hooks/use-world-timeline";
import { useWorldEvents } from "@/hooks/use-world-events";
import { useTerritorialControl } from "@/hooks/use-territorial-control";
import { TimelineControls } from "@/components/map/timeline-controls";
import { TerritoryLegend } from "@/components/map/territory-legend";
import { TerritoryDetailPanel } from "@/components/map/territory-detail-panel";
import type { TerritoryFeatureProperties } from "@/lib/types/territorial-control";
import { HAZARD_LAYERS, type HazardLayer } from "@/lib/hazards/types";
import { useHazards, type HazardViewport } from "@/hooks/use-hazards";
import { HazardPanel } from "@/components/hazards/hazard-panel";
import { WhatChangedPanel } from "@/components/brief/what-changed-panel";
import type { BriefDevelopment } from "@/lib/brief/types";

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
  const [showTerritorial, setShowTerritorial] = useState(false);
  const [selectedTerritory, setSelectedTerritory] = useState<TerritoryFeatureProperties | null>(null);
  // Natural-hazard layers: independent toggles (all off by default), remembered per browser.
  const [hazardLayers, setHazardLayers] = useState<HazardLayer[]>([]);
  const [selectedHazardId, setSelectedHazardId] = useState<string | null>(null);
  const [viewport, setViewport] = useState<HazardViewport | null>(null);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("vigil.hazardLayers") ?? "[]") as string[];
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring persisted UI state after mount (SSR renders the default)
      setHazardLayers(HAZARD_LAYERS.filter((l) => saved.includes(l)));
    } catch {
      /* private mode / blocked storage: start with none */
    }
  }, []);
  // Notification deep links: /world?layers=aviation&hazard=<id>&focus=lat,lng,zoom&at=<iso>. Applied once on
  // load; the same map, layers, selection and timeline as everywhere else (no separate experience).
  const [focus, setFocus] = useState<{ lat: number; lng: number; zoom: number } | null>(null);
  const [deepLinkAt, setDeepLinkAt] = useState<Date | null>(null);
  const [pendingEventId, setPendingEventId] = useState<string | null>(null);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const layers = (p.get("layers") ?? "").split(",").filter((l): l is HazardLayer => (HAZARD_LAYERS as readonly string[]).includes(l));
    if (layers.length) setHazardLayers((prev) => [...new Set([...prev, ...layers])]); // eslint-disable-line react-hooks/set-state-in-effect -- one-time URL application
    const hazard = p.get("hazard");
    if (hazard) setSelectedHazardId(hazard);
    const f = (p.get("focus") ?? "").split(",").map(Number);
    if (f.length === 3 && f.every(Number.isFinite)) setFocus({ lat: f[0]!, lng: f[1]!, zoom: f[2]! });
    const at = p.get("at");
    if (at && !Number.isNaN(new Date(at).getTime())) setDeepLinkAt(new Date(at));
    // Briefing links: a conflict event to select, and/or Territorial Control switched on.
    const ev = p.get("event");
    if (ev) setPendingEventId(ev);
    if (p.get("territory") === "1") setShowTerritorial(true);
  }, []);

  const toggleHazardLayer = useCallback((layer: HazardLayer) => {
    setHazardLayers((prev) => {
      const next = prev.includes(layer) ? prev.filter((l) => l !== layer) : [...prev, layer];
      try {
        localStorage.setItem("vigil.hazardLayers", JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);
  const basemapMode = useAppStore((s) => s.mapBasemapMode);
  const setBasemapMode = useAppStore((s) => s.setMapBasemapMode);
  const liveEvents = useLiveEvents();

  // Global Timeline / Historical Playback: `timeline.asOf` is null for
  // Live and a fixed past Date once a preset/custom timestamp is
  // selected — see hooks/use-world-timeline.ts for why that single value
  // is enough state for a later Play/Pause animation too.
  const timeline = useWorldTimeline();
  useEffect(() => {
    if (deepLinkAt) timeline.selectCustomTimestamp(deepLinkAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- apply the deep-link timestamp once
  }, [deepLinkAt]);
  const { events: historicalEvents, loading: historicalLoading } = useWorldEvents(timeline.asOf, timeline.previewNextAsOf);
  // Territorial Control Mode: the SAME asOf/previewNextAsOf drives
  // territorial polygons too (spec §5 "do not create a second timeline
  // system") — Live and historical/playback both flow through this one
  // hook exactly like useWorldEvents above.
  const { featureCollection: territorialFeatures } = useTerritorialControl(timeline.asOf, timeline.previewNextAsOf);
  // Hazards ride the SAME asOf as events and territory — no second timeline.
  const { data: hazards } = useHazards(hazardLayers, timeline.asOf, viewport, timeline.previewNextAsOf);

  // Animated playback (spec "opening event details during playback must
  // show data for the current historical timestamp"): pausing first
  // means the selected event's data can never drift out from under the
  // open detail panel — `asOf` stops advancing the instant something is
  // selected, so whatever was current at that moment stays current for
  // as long as the panel is open. Simpler and more robust than trying to
  // keep a live-updating reference in sync with a still-animating asOf.
  function selectEvent(event: ConflictEvent) {
    if (timeline.isPlaying) timeline.pause();
    setSelectedTerritory(null);
    setSelectedHazardId(null);
    setSelected(event);
  }

  function selectTerritory(properties: TerritoryFeatureProperties) {
    if (timeline.isPlaying) timeline.pause();
    setSelected(null);
    setSelectedHazardId(null);
    setSelectedTerritory(properties);
  }

  function selectHazard(id: string) {
    if (timeline.isPlaying) timeline.pause();
    setSelected(null);
    setSelectedTerritory(null);
    setSelectedHazardId(id);
  }

  // Live: the bounded published-event window from the database (the same data
  // the homepage globe uses). Historical: the world as reconstructed for the
  // timeline's asOf — never the current state. An empty database is an empty
  // map, not sample data.
  const allEvents = useMemo(
    () => (timeline.isHistorical ? historicalEvents : liveEvents),
    [timeline.isHistorical, historicalEvents, liveEvents],
  );

  useEffect(() => {
    if (!pendingEventId) return;
    const ev = allEvents.find((e) => e.id === pendingEventId);
    if (!ev) return;
    /* eslint-disable react-hooks/set-state-in-effect -- one-time selection once the linked event has loaded */
    setPendingEventId(null);
    setSelectedTerritory(null);
    setSelectedHazardId(null);
    setSelected(ev);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [pendingEventId, allEvents]);

  // "What changed": a brief item enables its layer, selects the record, centres the SAME map and, when
  // viewing a past moment, moves the timeline to when it happened.
  function openDevelopment(d: BriefDevelopment) {
    const t = d.mapTarget;
    if (!t) {
      window.location.href = d.deepLink;
      return;
    }
    if (timeline.isPlaying) timeline.pause();
    const layers = t.layers.filter((l): l is HazardLayer => (HAZARD_LAYERS as readonly string[]).includes(l));
    if (layers.length) setHazardLayers((prev) => [...new Set([...prev, ...layers])]);
    if (t.territory) setShowTerritorial(true);
    if (t.lat != null && t.lng != null) setFocus({ lat: t.lat, lng: t.lng, zoom: t.zoom ?? 6 });
    if (timeline.isHistorical && t.at) timeline.selectCustomTimestamp(new Date(t.at));
    if (t.hazardId) selectHazard(t.hazardId);
    else if (t.eventId) {
      const ev = allEvents.find((e) => e.id === t.eventId);
      if (ev) selectEvent(ev);
      else setPendingEventId(t.eventId);
    }
  }

  // Heat surface inputs. Live: the curated conflicts (sustained base) narrowed
  // by the region filter. Historical: no curated conflicts — those carry only
  // their CURRENT state, which is not "known at T"; the surface then derives
  // conflict bases from the timeline's own reconstructed events. Reference
  // time is the same asOf the events/territory already use.
  const overview = usePublicOverview();
  const realConflicts = overview.data?.conflicts;
  const selectedConflictRef = useMemo(() => {
    const c = selected?.conflictId ? realConflicts?.find((x) => x.id === selected.conflictId) : undefined;
    return c ? { slug: c.slug, shortName: c.shortName } : null;
  }, [selected, realConflicts]);
  const heatConflicts = useMemo(
    () => (timeline.isHistorical ? undefined : selectHeatConflicts(realConflicts).filter((c) => region === "Global" || c.region === region)),
    [timeline.isHistorical, region, realConflicts],
  );
  // Live: real clock at the time the event set last changed. Historical: the timeline's asOf.
  const heatNowIso = useMemo(() => (timeline.asOf ? timeline.asOf.toISOString() : new Date().toISOString()), [timeline.asOf, liveEvents]); // eslint-disable-line react-hooks/exhaustive-deps -- liveEvents: re-read the clock when new data arrives

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
      if (!timeline.isHistorical && !isWithinRange(e.occurredAt, timeRange, new Date().toISOString())) return false;
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
              <button key={e.id} onClick={() => selectEvent(e)} className="block w-full text-left">
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
            conflicts={heatConflicts}
            nowIso={heatNowIso}
            live={!timeline.isHistorical}
            basemapMode={basemapMode}
            onSelectEvent={selectEvent}
            territorialFeatures={territorialFeatures}
            showTerritorial={showTerritorial}
            onSelectTerritory={selectTerritory}
            hazards={hazards}
            focus={focus}
            hazardLayers={hazardLayers}
            onSelectHazard={selectHazard}
            onViewportChange={setViewport}
            className={cn(
              "absolute inset-0 h-full w-full",
              // Avoid users mistaking historical data for live data: a
              // persistent amber ring around the viewport itself, not
              // just the banner text, so it reads at a glance even if
              // the top overlay scrolls out of view on mobile.
              timeline.isHistorical && "ring-2 ring-inset ring-accent/50",
            )}
          />
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col items-center gap-2 px-4 pt-4 sm:pt-20">
            <div className="pointer-events-auto w-full max-w-2xl rounded-2xl border border-border bg-surface/80 p-3 backdrop-blur-xl">
              <TimelineControls
                preset={timeline.preset}
                asOf={timeline.asOf}
                rangeStart={timeline.rangeStart}
                rangeEnd={timeline.rangeEnd}
                isPlaying={timeline.isPlaying}
                speed={timeline.speed}
                onSelectPreset={timeline.selectPreset}
                onSelectCustom={timeline.selectCustomTimestamp}
                onReturnToLive={timeline.returnToLive}
                onPlay={timeline.play}
                onPause={timeline.pause}
                onStepForward={timeline.stepForward}
                onStepBackward={timeline.stepBackward}
                onSetSpeed={timeline.setSpeed}
                onScrubProgress={timeline.scrubToProgress}
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
                showTerritorial={showTerritorial}
                onToggleTerritorial={setShowTerritorial}
                hazardLayers={hazardLayers}
                onToggleHazardLayer={toggleHazardLayer}
                hazardHealth={hazards?.meta.health}
              />
            </div>
            <WhatChangedPanel timeRange={timeRange} asOf={timeline.asOf} onSelect={openDevelopment} />
            {showTerritorial && (
              <div className="pointer-events-auto w-full max-w-2xl rounded-2xl border border-border bg-surface/80 p-3 backdrop-blur-xl">
                <TerritoryLegend featureCollection={territorialFeatures} />
              </div>
            )}
          </div>
        </div>

        {/* Desktop selected-event/territory panel */}
        <aside className="hidden h-full overflow-y-auto border-l border-border bg-surface/60 p-5 pt-24 sm:block">
          {selected ? (
            <>
              <button
                onClick={() => setSelected(null)}
                className="mb-3 inline-flex items-center gap-1 text-xs text-ink-faint hover:text-ink"
              >
                <X className="h-3.5 w-3.5" /> Close
              </button>
              <EventDetailPanel event={selected} conflict={selectedConflictRef} />
            </>
          ) : selectedTerritory ? (
            <>
              <button
                onClick={() => setSelectedTerritory(null)}
                className="mb-3 inline-flex items-center gap-1 text-xs text-ink-faint hover:text-ink"
              >
                <X className="h-3.5 w-3.5" /> Close
              </button>
              <TerritoryDetailPanel territory={selectedTerritory} />
            </>
          ) : selectedHazardId ? (
            <>
              <button
                onClick={() => setSelectedHazardId(null)}
                className="mb-3 inline-flex items-center gap-1 text-xs text-ink-faint hover:text-ink"
              >
                <X className="h-3.5 w-3.5" /> Close
              </button>
              <HazardPanel id={selectedHazardId} asOf={timeline.asOf} />
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
        {selected && <EventDetailPanel event={selected} conflict={selectedConflictRef} />}
      </BottomSheet>
      <BottomSheet open={!!selectedHazardId} onClose={() => setSelectedHazardId(null)} label="Hazard details">
        {selectedHazardId && <HazardPanel id={selectedHazardId} asOf={timeline.asOf} />}
      </BottomSheet>
      <BottomSheet
        open={!!selectedTerritory}
        onClose={() => setSelectedTerritory(null)}
        label={selectedTerritory?.actorName ?? undefined}
      >
        {selectedTerritory && <TerritoryDetailPanel territory={selectedTerritory} />}
      </BottomSheet>
    </main>
  );
}
