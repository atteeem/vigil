"use client";

import Link from "next/link";
import { CountUp } from "@/components/ui/count-up";
import { CountrySelector } from "@/components/home/country-selector";
import { ExposureCategoryCard } from "@/components/impact/exposure-category-card";
import { SEVERITY_LABEL, SEVERITY_TEXT_CLASS, severityFromScore } from "@/lib/utils/severity";
import { formatSigned, cn } from "@/lib/utils";
import { distanceKm } from "@/lib/utils/geo";
import { useAppStore } from "@/hooks/use-app-store";
import { getCountryByCode, computeCountryExposure } from "@/lib/data";
import { rankConflictsForCountry } from "@/lib/data/priority";
import { useNowMs } from "@/hooks/use-now";
import { usePublicOverview } from "@/hooks/use-public-overview";
import { EmptyState, FreshnessStamp, LoadingLine } from "@/components/public/data-states";
import { STALE_SOURCE_HOURS } from "@/lib/public/stale";
import { BriefPanel } from "@/components/brief/brief-view";
import { useWatches } from "@/hooks/use-watcher";
import { ForYouDevelopments } from "@/components/discovery/for-you-feed";
import { OverviewWatching } from "@/components/home/overview-landing";

export default function ForYouPage() {
  const baseCountryCode = useAppStore((s) => s.baseCountryCode);
  const { data: watches } = useWatches();
  const country = getCountryByCode(baseCountryCode);
  // Real, DB-backed conflicts (the same set the homepage uses). Relevance comes only from the
  // explicitly selected country, through the centralized impact engine.
  const overview = usePublicOverview();
  const now = useNowMs(overview.data);
  if (!country) return null;
  if (!overview.data) {
    return (
      <main className="mx-auto max-w-[1000px] px-4 pb-28 pt-24 sm:px-6 sm:pt-32">
        <h1 className="text-2xl font-semibold text-ink sm:text-[28px]">How The World Affects You</h1>
        {overview.status === "loading" ? (
          <LoadingLine className="mt-6" />
        ) : (
          <EmptyState className="mt-6" title="Conflict data could not be loaded" detail="Try again in a moment." testId="for-you-error" />
        )}
      </main>
    );
  }
  const conflicts = overview.data.conflicts;
  const activeCount = conflicts.filter((c) => c.status === "active" || c.status === "reduced").length;
  const exposure = computeCountryExposure(country, conflicts);
  const severity = severityFromScore(exposure.score);
  const topConflicts = rankConflictsForCountry(country, conflicts, overview.data.events, now, 6);

  return (
    <main className="mx-auto max-w-[1000px] px-4 pb-28 pt-24 sm:px-6 sm:pt-32">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-ink sm:text-[28px]">
          How The World Affects You
        </h1>
        <div className="flex items-center gap-2">
          <Link href={`/country/${country.code}`} className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-ink-dim hover:text-ink" data-testid="for-you-country-page">
            {country.name} country page
          </Link>
          <CountrySelector />
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-border bg-card/70 p-6">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-ink-faint">
          Your Global Exposure
        </p>
        <div className="mt-1 flex flex-wrap items-baseline gap-3">
          <span className={cn("text-5xl font-semibold tabular-nums", SEVERITY_TEXT_CLASS[severity])}>
            <CountUp value={exposure.score} />
          </span>
          <span className="text-sm font-medium text-ink-dim">/ 100</span>
          <span className={cn("text-sm font-semibold", SEVERITY_TEXT_CLASS[severity])}>
            {SEVERITY_LABEL[severity]}
          </span>
          <span className="text-xs text-ink-faint">{formatSigned(exposure.change24h)} today</span>
        </div>
        <p className="mt-2 max-w-xl text-sm text-ink-dim">
          Estimated exposure for {country.name} (your selected country), based on the current registry indicators for {activeCount} active conflict{activeCount === 1 ? "" : "s"}. Not a prediction.
        </p>
        <p className="mt-1" data-testid="for-you-freshness">
          <FreshnessStamp label="Last event" iso={overview.data.freshness.lastEventAt} staleAfterHours={STALE_SOURCE_HOURS} none="no published events" />
        </p>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {exposure.components.map((c) => (
          <ExposureCategoryCard
            key={c.dimension}
            dimension={c.dimension}
            value={c.value}
            change24h={exposure.change24h}
            topConflictName={c.drivers[0]?.label}
            basis={c.basis}
          />
        ))}
      </div>

      <section className="mt-8" data-testid="for-you-following">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-ink-faint">From what you follow</h2>
        <p className="mb-3 text-xs text-ink-faint">Meaningful developments of the last 7 days that relate to something you watch or to {country.name}. Each says why it is here; nothing is inferred from your browsing.</p>
        <ForYouDevelopments country={country.code} />
        <OverviewWatching className="mt-5" />
      </section>

      <section className="mt-10" data-testid="for-you-brief">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-ink-faint">Your brief</h2>
        <p className="mb-3 text-xs text-ink-faint">
          What materially changed for {country.name} (your selected country, through the impact model){(watches?.length ?? 0) > 0 ? ` and the ${watches!.length} thing${watches!.length === 1 ? "" : "s"} you follow` : ""}. Nothing is inferred beyond what you selected or followed.
        </p>
        <BriefPanel scope={{ country: country.code, watchlist: (watches?.length ?? 0) > 0 }} initialWindow="24h" compact allowSave={false} />
      </section>

      <h2 className="mb-3 mt-10 text-sm font-semibold uppercase tracking-wide text-ink-faint">
        Top Conflicts Affecting You
      </h2>
      {topConflicts.length === 0 && <EmptyState title="No conflicts to rank" detail="Nothing tracked affects this country yet." testId="for-you-empty" />}
      <div className="space-y-2" data-testid="for-you-top-conflicts">
        {topConflicts.map(({ conflict, impact, reasons }) => {
          const km = Math.round(distanceKm(country, conflict));
          const sec = impact.components.find((c) => c.dimension === "security")?.value ?? 0;
          const energy = impact.components.find((c) => c.dimension === "energy")?.value ?? 0;
          const trade = impact.components.find((c) => c.dimension === "trade")?.value ?? 0;
          return (
            <Link
              key={conflict.id}
              href={`/conflict/${conflict.slug}`}
              className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-border bg-card/60 px-4 py-3 hover:border-border-strong hover:bg-card"
            >
              <div className="min-w-[140px] flex-1">
                <p className="text-sm font-medium text-ink">{conflict.shortName}</p>
                <p className="text-xs text-ink-faint">{conflict.locationKnown ? `${km.toLocaleString("en-US")} km away` : "Location unknown"}</p>
                {reasons.length > 0 && (
                  <p className="mt-0.5 text-[11px] text-ink-dim" data-testid="for-you-reasons">
                    {reasons.join(" · ")}
                  </p>
                )}
              </div>
              <MiniMetric label="Impact" value={impact.score} accent />
              <MiniMetric label="Security" value={sec} />
              <MiniMetric label="Energy" value={energy} />
              <MiniMetric label="Trade" value={trade} />
              <span className="text-xs text-ink-faint">{formatSigned(impact.change24h)}</span>
            </Link>
          );
        })}
      </div>
    </main>
  );
}

function MiniMetric({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="w-16 text-center">
      <p className={cn("text-sm font-semibold tabular-nums", accent ? "text-accent" : "text-ink")}>
        {value}
      </p>
      <p className="text-[10px] uppercase tracking-wide text-ink-faint">{label}</p>
    </div>
  );
}
