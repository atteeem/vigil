import { notFound } from "next/navigation";
import { FollowButton } from "@/components/watch/follow-button";
import type { Metadata } from "next";
import Link from "next/link";
import { getCountryByCode } from "@/lib/reference/countries";
import { computeCountryExposure, getTopConflictsForCountry } from "@/lib/data/impact";
import { listPublicConflicts } from "@/lib/public/conflicts";
import { listPublicEvents } from "@/lib/public/events";
import { EmptyState } from "@/components/public/data-states";
import { ExposureCategoryCard } from "@/components/impact/exposure-category-card";
import { EventCard } from "@/components/events/event-card";
import { SetBaseCountryButton } from "@/components/home/set-base-country-button";
import { SEVERITY_LABEL, SEVERITY_TEXT_CLASS, severityFromScore } from "@/lib/utils/severity";
import { formatSigned, cn } from "@/lib/utils";

// Real conflicts and events, read on demand.
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}): Promise<Metadata> {
  const { code } = await params;
  const country = getCountryByCode(code.toUpperCase());
  return { title: country ? `${country.name} — Vigil` : "Country — Vigil" };
}

export default async function CountryPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const country = getCountryByCode(code.toUpperCase());
  if (!country) notFound();

  const conflicts = await listPublicConflicts();
  const exposure = computeCountryExposure(country, conflicts);
  const severity = severityFromScore(exposure.score);
  const topConflicts = getTopConflictsForCountry(country, conflicts, 5);
  const countryEvents = (await listPublicEvents({ countryCode: country.code, limit: 6, sinceDays: 365 })).events;

  return (
    <main className="mx-auto max-w-[1000px] px-4 pb-28 pt-24 sm:px-6 sm:pt-32">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-3xl" aria-hidden>{country.flag}</span>
          <div>
            <h1 className="text-2xl font-semibold text-ink sm:text-[28px]">{country.name}</h1>
            <p className="text-sm text-ink-faint">{country.region}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/brief/country/${country.code}`} className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-ink-dim hover:text-ink" data-testid="country-brief-link">
            Country brief
          </Link>
          <FollowButton entityType="country" entityKey={country.code} label={country.name} />
          <SetBaseCountryButton code={country.code} />
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-border bg-card/70 p-6">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-ink-faint">
          Country Exposure
        </p>
        <div className="mt-1 flex flex-wrap items-baseline gap-3">
          <span className={cn("text-5xl font-semibold tabular-nums", SEVERITY_TEXT_CLASS[severity])}>
            {exposure.score}
          </span>
          <span className="text-sm font-medium text-ink-dim">/ 100</span>
          <span className={cn("text-sm font-semibold", SEVERITY_TEXT_CLASS[severity])}>
            {SEVERITY_LABEL[severity]}
          </span>
          <span className="text-xs text-ink-faint">{formatSigned(exposure.change24h)} today</span>
        </div>
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

      <h2 className="mb-3 mt-10 text-sm font-semibold uppercase tracking-wide text-ink-faint">
        Relevant Conflicts
      </h2>
      {topConflicts.length === 0 && <EmptyState title="No tracked conflicts affect this country" testId="country-conflicts-empty" />}
      <div className="space-y-2">
        {topConflicts.map(({ conflict, impact }) => (
          <Link
            key={conflict.id}
            href={`/conflict/${conflict.slug}`}
            className="flex items-center justify-between rounded-xl border border-border bg-card/60 px-4 py-3 hover:border-border-strong"
          >
            <span className="text-sm text-ink">{conflict.shortName}</span>
            <span className="text-sm font-semibold tabular-nums text-accent">{impact.score}</span>
          </Link>
        ))}
      </div>

      <h2 className="mb-3 mt-10 text-sm font-semibold uppercase tracking-wide text-ink-faint">Latest Events In This Country</h2>
      {countryEvents.length === 0 ? (
        <EmptyState title="No published events for this country" detail="Nothing has been reported and published here in the last year." testId="country-events-empty" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {countryEvents.map((e) => (
            <EventCard key={e.id} event={e} compact />
          ))}
        </div>
      )}
    </main>
  );
}
