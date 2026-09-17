"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowUp, ArrowDown, Minus } from "lucide-react";
import type { Conflict } from "@/lib/types";
import { SeverityBadge } from "@/components/ui/severity-badge";
import { Tabs } from "@/components/ui/tabs";
import { CountrySelector } from "@/components/home/country-selector";
import { ExposureRadar } from "@/components/impact/exposure-radar";
import { ImpactBreakdown } from "@/components/impact/impact-breakdown";
import { EventCard } from "@/components/events/event-card";
import { MarketMiniCard } from "@/components/markets/market-mini-card";
import { GlobeLoading } from "@/components/globe/globe-loading";
import { useAppStore } from "@/hooks/use-app-store";
import { getCountryByCode } from "@/lib/data/mock-countries";
import { computeImpact } from "@/lib/data/impact";
import { getEventsForConflict } from "@/lib/data/mock-events";
import { getSituationSnapshot } from "@/lib/data/situation-brief";
import { MOCK_MARKETS } from "@/lib/data/mock-markets";
import { formatSigned, timeAgo, cn } from "@/lib/utils";
import { MOCK_NOW } from "@/lib/data/constants";

const WorldMap = dynamic(() => import("@/components/map/world-map").then((m) => m.WorldMap), {
  ssr: false,
  loading: () => <GlobeLoading />,
});

type TabValue = "overview" | "map" | "timeline" | "impact" | "markets" | "sources";

const TABS: { value: TabValue; label: string }[] = [
  { value: "overview", label: "Overview" },
  { value: "impact", label: "Impact" },
  { value: "timeline", label: "Timeline" },
  { value: "map", label: "Live Map" },
  { value: "markets", label: "Markets" },
  { value: "sources", label: "Sources" },
];

export function ConflictDetailClient({ conflict }: { conflict: Conflict }) {
  const [tab, setTab] = useState<TabValue>("overview");
  const baseCountryCode = useAppStore((s) => s.baseCountryCode);
  const basemapMode = useAppStore((s) => s.mapBasemapMode);
  const country = getCountryByCode(baseCountryCode);
  const events = useMemo(() => getEventsForConflict(conflict.id), [conflict.id]);
  const impact = country ? computeImpact(country, conflict) : null;
  const snapshot = useMemo(() => getSituationSnapshot(conflict, events), [conflict, events]);
  const markets = MOCK_MARKETS.filter((m) => m.relevantConflictSlugs.includes(conflict.slug));

  const TrendIcon = conflict.intensityChange24h > 0 ? ArrowUp : conflict.intensityChange24h < 0 ? ArrowDown : Minus;

  return (
    <main className="mx-auto max-w-[1100px] px-4 pb-28 pt-24 sm:px-6 sm:pt-32">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <SeverityBadge severity={conflict.severity} />
          <h1 className="mt-2 text-2xl font-semibold text-ink sm:text-[32px]">{conflict.name}</h1>
          <p className="mt-1 text-sm text-ink-dim">
            Active since {new Date(conflict.startedAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
            {" · "}Status: {conflict.status === "active" ? "Active" : conflict.status}
          </p>
        </div>
        <CountrySelector />
      </div>

      <div className="mt-6 grid grid-cols-3 gap-4 sm:max-w-md">
        <StatBlock label="Intensity" value={conflict.intensity} />
        <StatBlock
          label="24h Change"
          value={
            <span className="flex items-center gap-1">
              <TrendIcon className="h-4 w-4 text-ink-faint" />
              {Math.abs(conflict.intensityChange24h)}
            </span>
          }
        />
        <StatBlock label="Impact on you" value={impact?.score ?? "—"} accent />
      </div>

      <Tabs tabs={TABS} value={tab} onChange={setTab} className="mt-8" />

      <div className="mt-6">
        {tab === "overview" && (
          <div className="space-y-6">
            <div className="rounded-2xl border border-border bg-card/70 p-5">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-ink-faint">
                {snapshot.windowLabel.toUpperCase()}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-ink-dim">{conflict.summary}</p>
              <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                <MiniStat label="Events" value={snapshot.eventsInWindow} />
                <MiniStat label="Air activity" value={snapshot.airActivity} />
                <MiniStat label="Ground activity" value={snapshot.groundActivity} />
                <MiniStat label="Territorial change" value={snapshot.territorialChange} />
              </div>
              <p className="mt-4 text-[11px] text-ink-faint">
                Computed from monitored mock events, not an AI narrative. Estimated
                exposure, not a prediction.
              </p>
            </div>

            <div>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-faint">
                Recent Events
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {events.slice(0, 6).map((e) => (
                  <EventCard key={e.id} event={e} compact />
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === "impact" && impact && (
          <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
            <div className="rounded-2xl border border-border bg-card/70 p-5">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-ink-faint">
                Impact on {country?.name}
              </p>
              <p className="mt-1 text-4xl font-semibold tabular-nums text-accent">{impact.score}</p>
              <p className="text-xs text-ink-faint">{formatSigned(impact.change24h)} today · Estimated exposure</p>
              <ExposureRadar components={impact.components} />
              <div className="mt-2 border-t border-border pt-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                  Why this score?
                </p>
                <div className="mt-2 space-y-1.5">
                  {impact.overallDrivers.map((d) => (
                    <div key={d.label} className="flex items-center justify-between text-xs">
                      <span className="text-ink-dim">{d.label}</span>
                      <span className="font-medium text-ink">+{d.contribution}</span>
                    </div>
                  ))}
                  <div className="mt-1 flex items-center justify-between border-t border-border pt-1.5 text-xs font-semibold">
                    <span className="text-ink">Total</span>
                    <span className="text-ink">{impact.score}</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {impact.components.map((c) => (
                <ImpactBreakdown key={c.dimension} component={c} />
              ))}
            </div>
          </div>
        )}

        {tab === "timeline" && (
          <ol className="space-y-4 border-l border-border pl-4">
            {events.map((e) => (
              <li key={e.id} className="relative">
                <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-accent" aria-hidden />
                <p className="text-xs text-ink-faint">{timeAgo(e.occurredAt, MOCK_NOW)}</p>
                <p className="text-sm font-medium text-ink">{e.title}</p>
                <p className="text-xs text-ink-dim">{e.summary}</p>
              </li>
            ))}
          </ol>
        )}

        {tab === "map" && (
          <div className="h-[500px] overflow-hidden rounded-2xl border border-border">
            <WorldMap
              events={events}
              viewMode="markers"
              basemapMode={basemapMode}
              onSelectEvent={() => {}}
              className="h-full w-full"
            />
          </div>
        )}

        {tab === "markets" && (
          <div className="grid gap-3 sm:grid-cols-2">
            {markets.length > 0 ? (
              markets.map((m) => <MarketMiniCard key={m.id} asset={m} />)
            ) : (
              <p className="text-sm text-ink-faint">
                No directly linked market assets tracked for this conflict yet.
              </p>
            )}
          </div>
        )}

        {tab === "sources" && (
          <div className="space-y-3">
            <p className="text-[11px] text-ink-faint">
              Phase 1 sources are development/mock data — links are safe
              placeholders (example.com), not live articles.
            </p>
            {events.flatMap((e) => e.sources.map((s) => ({ ...s, eventTitle: e.title }))).slice(0, 20).map((s, i) => (
              // s.id is the underlying Source (outlet)'s id — the same
              // outlet can legitimately appear more than once across this
              // flattened multi-event list (or even twice on one event),
              // so the key needs the index too (see event-detail-panel.tsx
              // for the same fix and full reasoning).
              <div key={`${s.id}-${i}`} className="rounded-xl border border-border bg-card/70 p-3.5">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-ink">{s.name}</p>
                  <span className="shrink-0 text-xs text-ink-faint">{timeAgo(s.publishedAt, MOCK_NOW)}</span>
                </div>
                <p className="text-xs text-ink-faint">{s.sourceType} · re: {s.eventTitle}</p>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 block truncate text-xs text-accent hover:underline"
                >
                  {s.url}
                </a>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function StatBlock({ label, value, accent }: { label: string; value: React.ReactNode; accent?: boolean }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">{label}</p>
      <p className={cn("mt-0.5 text-2xl font-semibold tabular-nums", accent ? "text-accent" : "text-ink")}>
        {value}
      </p>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-wide text-ink-faint">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-ink">{value}</p>
    </div>
  );
}
