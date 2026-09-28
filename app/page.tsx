"use client";

import { useState } from "react";
import Link from "next/link";
import { Newspaper, ArrowRight } from "lucide-react";
import { ConflictGlobe } from "@/components/globe/conflict-globe";
import { OpenLiveMap, OverviewBriefs, OverviewSignals, OverviewStatus, OverviewWatching, OverviewWhatChanged } from "@/components/home/overview-landing";
import { useConflictReportCounts } from "@/hooks/use-conflict-report-counts";
import { GlobeControls } from "@/components/globe/globe-controls";
import { GlobalStatusCard } from "@/components/home/global-status-card";
import { RelevantToYouCard } from "@/components/home/relevant-to-you-card";
import { ConflictPreviewPanel } from "@/components/home/conflict-preview-panel";
import { TimeLayerControls } from "@/components/home/time-layer-controls";
import { LatestEventsFeed } from "@/components/home/latest-events-feed";
import {
  MobileStatusStrip,
  MobileTopExposureCard,
} from "@/components/home/mobile-home-sections";
import { useAppStore } from "@/hooks/use-app-store";
import { getGlobalStatus } from "@/lib/data";
import { usePublicOverview, useRefreshOnFocus } from "@/hooks/use-public-overview";
import { LatestTerritorialChanges } from "@/components/home/latest-territorial-changes";
import { IntelOverview } from "@/components/home/intel-overview";
import { FreshnessStamp } from "@/components/public/data-states";
import { STALE_SOURCE_HOURS } from "@/lib/public/stale";
import { isWithinRange, TIME_RANGE_LABEL } from "@/lib/utils/time-range";

const EMPTY_CONFLICTS: never[] = [];
const EMPTY_EVENTS: never[] = [];

export default function HomePage() {
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const baseCountryCode = useAppStore((s) => s.baseCountryCode);
  const layer = useAppStore((s) => s.layer);
  const viewMode = useAppStore((s) => s.globeViewMode);
  const globeLayers = useAppStore((s) => s.globeLayers);
  const contentSensitivity = useAppStore((s) => s.contentSensitivity);
  // Homepage time-range control (1H/6H/24H/7D/30D — Pre-Launch Critical Correctness & Security v1 §7):
  // the same TimeRange type/values and the same isWithinRange filter /world's own recency filter already
  // uses (lib/utils/time-range.ts), so the "same time selection" genuinely means the same canonical event
  // universe on both pages (§9). The underlying fetch stays the existing bounded 30-day/200-event window
  // (usePublicOverview is a shared singleton read by 3 other pages too — every selectable range here is
  // <=30 days, so client-filtering that window is exact, not an approximation.
  const timeRange = useAppStore((s) => s.timeRange);
  // Real, DB-backed data — the same conflicts and events /world uses.
  useRefreshOnFocus();
  const overview = usePublicOverview();
  const conflicts = overview.data?.conflicts ?? EMPTY_CONFLICTS;
  const events = overview.data?.events ?? EMPTY_EVENTS;
  const nowIso = overview.data?.freshness.generatedAt ?? new Date().toISOString();
  const rangeEvents = events.filter((e) => isWithinRange(e.occurredAt, timeRange, nowIso));
  // The real 30-day total (never events.length, which is capped at 200 — see PublicOverview.eventsTotal)
  // when the full window is selected; the exact, uncapped count of the already-fetched window for any
  // narrower range, since every selectable range fits inside the fetched 30 days.
  const rangeEventsTotal = timeRange === "30D" ? (overview.data?.eventsTotal ?? rangeEvents.length) : rangeEvents.length;
  // Conflict hotspot numbers: the canonical server aggregate over the SELECTED range (not a count
  // of the capped event feed), identical to what /world's conflict markers read for the same state.
  const reportCounts = useConflictReportCounts({ window: timeRange, dataVersion: `${events.length}:${events[0]?.id ?? ""}` });
  const freshness = overview.data?.freshness ?? null;
  const loading = overview.status === "loading";
  const status = getGlobalStatus(conflicts);
  const activeCount = conflicts.filter((c) => c.status === "active" || c.status === "reduced").length;

  const selectedConflict = conflicts.find((c) => c.slug === selectedSlug) ?? null;

  // The same real counts and freshness stamps on every screen size (desktop: over the globe; phones: below it).
  const dataSummary = (
    <>
      <p className="text-[11px] font-medium text-ink-faint">
        {loading ? "Loading data…" : `${rangeEventsTotal} published events (${TIME_RANGE_LABEL[timeRange]}) · ${activeCount} active conflicts`}
      </p>
      {!loading && (
        <p className="text-[10px] text-ink-faint">
          <FreshnessStamp label="Last event" iso={freshness?.lastEventAt} staleAfterHours={STALE_SOURCE_HOURS} className="text-[10px]" />
          {" · "}
          <FreshnessStamp label="Last source fetch" iso={freshness?.lastIngestionAt} staleAfterHours={STALE_SOURCE_HOURS} none="never" className="text-[10px]" />
          {overview.status === "error" && <span className="ml-1.5 text-elevated" data-testid="home-data-error">· may be out of date</span>}
        </p>
      )}
    </>
  );

  return (
    <main className="min-h-screen bg-bg">
      <section className="relative h-[62vh] w-full overflow-hidden sm:h-[86vh]">
        <ConflictGlobe
          className="absolute inset-0 h-full w-full"
          conflicts={conflicts}
          events={rangeEvents}
          conflictReportCounts={reportCounts.data?.conflicts}
          selectedSlug={selectedSlug}
          onSelectConflict={(c) => setSelectedSlug(c.slug)}
          layer={layer}
          viewMode={viewMode}
          globeLayers={globeLayers}
          contentSensitivity={contentSensitivity}
        />

        {/* Mobile overlay chrome (below the fixed top bar) */}
        <div className="pointer-events-none absolute inset-x-0 top-14 flex justify-end px-3 sm:hidden">
          <GlobeControls className="pointer-events-auto" />
        </div>

        {/* Desktop overlay chrome */}
        <div className="pointer-events-none absolute inset-0 hidden sm:block">
          <div className="pointer-events-auto absolute left-6 top-24">
            <GlobalStatusCard status={status} conflicts={conflicts} loading={loading} />
          </div>
          <div className="pointer-events-auto absolute right-6 top-24 flex flex-col items-end gap-2">
            <GlobeControls />
            <RelevantToYouCard
              baseCountryCode={baseCountryCode}
              conflicts={conflicts}
              events={events}
              onSelectConflict={setSelectedSlug}
            />
          </div>
          <div className="pointer-events-none absolute inset-x-0 top-24 flex flex-col items-center gap-0.5" data-testid="home-data-summary">
            {dataSummary}
          </div>
          <div
            className={
              "absolute inset-x-0 bottom-8 flex justify-center transition-opacity duration-200 " +
              (selectedSlug ? "pointer-events-none opacity-0" : "pointer-events-auto opacity-100")
            }
            aria-hidden={Boolean(selectedSlug)}
            inert={Boolean(selectedSlug)}
            data-testid="globe-layer-controls"
          >
            <TimeLayerControls />
          </div>
        </div>
      </section>

      {/* Mobile stacked sections, overlapping the globe fold slightly */}
      <div className="relative z-10 -mt-6 space-y-4 rounded-t-3xl bg-bg pb-24 pt-5 sm:hidden">
        <MobileStatusStrip status={status} />
        <div className="flex flex-col gap-0.5 px-4" data-testid="home-data-summary">
          {dataSummary}
        </div>
        <MobileTopExposureCard baseCountryCode={baseCountryCode} conflicts={conflicts} events={events} onSeeWhy={setSelectedSlug} />
        <div className="px-4">
          <TimeLayerControls className="items-start" />
        </div>
        <OverviewStatus className="px-4" />
        <OverviewWhatChanged className="px-4" />
        <IntelOverview className="px-4" conflicts={conflicts} events={events} loading={loading} />
        <OverviewWatching className="px-4" />
        <OpenLiveMap className="mx-4" />
        <OverviewSignals className="px-4" />
        <OverviewBriefs className="px-4" />
        <LatestEventsFeed className="px-4" events={events} loading={loading} limit={4} />
        <LatestTerritorialChanges className="px-4" changes={overview.data?.territorialChanges ?? []} />
        <Link href="/intel" className="mx-4 flex items-center gap-1.5 text-xs font-medium text-accent hover:underline">
          <Newspaper className="h-3.5 w-3.5" />
          Regional Intel Briefings
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {/* Desktop: the Overview landing below the globe — a summary; spatial investigation lives on /world */}
      <div className="mx-auto hidden max-w-[1400px] px-6 py-10 sm:block" data-testid="overview-landing">
        <OverviewStatus />
        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            <OverviewWhatChanged />
            <IntelOverview className="mt-8" conflicts={conflicts} events={events} loading={loading} />
            <LatestEventsFeed className="mt-8" events={events} loading={loading} limit={5} />
          </div>
          <div className="min-w-0 space-y-8">
            <OpenLiveMap />
            <OverviewWatching />
            <OverviewSignals />
            <OverviewBriefs />
            <LatestTerritorialChanges changes={overview.data?.territorialChanges ?? []} />
            <Link href="/intel" className="flex items-center gap-1.5 text-xs font-medium text-accent hover:underline">
              <Newspaper className="h-3.5 w-3.5" />
              Regional Intel Briefings
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </div>

      <ConflictPreviewPanel
        conflict={selectedConflict}
        baseCountryCode={baseCountryCode}
        onClose={() => setSelectedSlug(null)}
      />
    </main>
  );
}
