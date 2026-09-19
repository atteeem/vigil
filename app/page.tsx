"use client";

import { useState } from "react";
import Link from "next/link";
import { Newspaper, ArrowRight } from "lucide-react";
import { ConflictGlobe } from "@/components/globe/conflict-globe";
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
import { MOCK_CONFLICTS, getGlobalStatus, MOCK_EVENTS } from "@/lib/data";

export default function HomePage() {
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const baseCountryCode = useAppStore((s) => s.baseCountryCode);
  const layer = useAppStore((s) => s.layer);
  const viewMode = useAppStore((s) => s.globeViewMode);
  const globeLayers = useAppStore((s) => s.globeLayers);
  const contentSensitivity = useAppStore((s) => s.contentSensitivity);
  const { score, change24h } = getGlobalStatus();

  const selectedConflict = MOCK_CONFLICTS.find((c) => c.slug === selectedSlug) ?? null;

  return (
    <main className="min-h-screen bg-bg">
      <section className="relative h-[62vh] w-full overflow-hidden sm:h-[86vh]">
        <ConflictGlobe
          className="absolute inset-0 h-full w-full"
          conflicts={MOCK_CONFLICTS}
          events={MOCK_EVENTS}
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
            <GlobalStatusCard score={score} change24h={change24h} />
          </div>
          <div className="pointer-events-auto absolute right-6 top-24 flex flex-col items-end gap-2">
            <GlobeControls />
            <RelevantToYouCard
              baseCountryCode={baseCountryCode}
              onSelectConflict={setSelectedSlug}
            />
          </div>
          <div className="pointer-events-none absolute inset-x-0 top-24 flex justify-center">
            <p className="text-[11px] font-medium text-ink-faint">
              {MOCK_EVENTS.length} tracked events · {MOCK_CONFLICTS.filter((c) => c.status === "active" || c.status === "reduced").length} active conflicts
            </p>
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
        <MobileStatusStrip score={score} change24h={change24h} />
        <MobileTopExposureCard baseCountryCode={baseCountryCode} onSeeWhy={setSelectedSlug} />
        <div className="px-4">
          <TimeLayerControls className="items-start" />
        </div>
        <LatestEventsFeed className="px-4" limit={6} />
        <Link href="/intel" className="mx-4 flex items-center gap-1.5 text-xs font-medium text-accent hover:underline">
          <Newspaper className="h-3.5 w-3.5" />
          Regional Intel Briefings
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {/* Desktop: latest activity below the fold */}
      <div className="mx-auto hidden max-w-[1600px] px-6 py-10 sm:block">
        <div className="max-w-2xl">
          <LatestEventsFeed limit={8} />
          <Link
            href="/intel"
            className="mt-4 flex items-center gap-1.5 text-xs font-medium text-accent hover:underline"
          >
            <Newspaper className="h-3.5 w-3.5" />
            Regional Intel Briefings
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
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
