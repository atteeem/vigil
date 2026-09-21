"use client";

import { useState } from "react";
import { FollowButton } from "@/components/watch/follow-button";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ArrowUp, ArrowDown, Minus } from "lucide-react";
import type { PublicConflictDetail } from "@/lib/public/conflict-detail";
import { SeverityBadge } from "@/components/ui/severity-badge";
import { RelativeTime } from "@/components/ui/relative-time";
import { CountrySelector } from "@/components/home/country-selector";
import { ExposureRadar } from "@/components/impact/exposure-radar";
import { ImpactBreakdown } from "@/components/impact/impact-breakdown";
import { EventCard } from "@/components/events/event-card";
import { GlobeLoading } from "@/components/globe/globe-loading";
import { EmptyState, FreshnessStamp } from "@/components/public/data-states";
import { ConflictingClaimsBlock } from "@/components/events/evidence-panel";
import { useAppStore } from "@/hooks/use-app-store";
import { getCountryByCode } from "@/lib/reference/countries";
import { computeImpact } from "@/lib/data/impact";
import { SOURCE_TIER_LABEL } from "@/lib/registry/source-tiers";
import { STALE_SOURCE_HOURS } from "@/lib/public/stale";
import { BriefPanel } from "@/components/brief/brief-view";
import { formatSigned, cn } from "@/lib/utils";

const WorldMap = dynamic(() => import("@/components/map/world-map").then((m) => m.WorldMap), {
  ssr: false,
  loading: () => <GlobeLoading />,
});

const CLASSIFICATION_LABEL: Record<string, string> = {
  established: "Established armed conflict",
  uncertain: "Classification uncertain",
  disputed: "Classification disputed",
};

const HEALTH_LABEL: Record<string, { label: string; detail: string }> = {
  healthy: { label: "Healthy coverage", detail: "Fresh reports from more than one independent source." },
  weak: { label: "Weak coverage", detail: "Sources exist but coverage is thin or not diverse." },
  stale: { label: "Stale coverage", detail: "The sources covering this conflict have stopped reporting recently." },
  no_source: { label: "No source", detail: "No source is currently tracking this conflict." },
  inactive: { label: "Not a live conflict", detail: "Coverage is not assessed for a dormant or ended conflict." },
};

const MONTH = (key: string) => new Date(`${key}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

/** The public conflict intelligence page. Everything shown comes from the
 * database through lib/public/conflict-detail; a section with no data shows an
 * empty state instead of filler. */
export function ConflictDetailClient({ detail }: { detail: PublicConflictDetail }) {
  const { conflict } = detail;
  const [showMap, setShowMap] = useState(false);
  const baseCountryCode = useAppStore((s) => s.baseCountryCode);
  const basemapMode = useAppStore((s) => s.mapBasemapMode);
  const showPartyClaims = useAppStore((s) => s.showPartyClaims);
  const country = getCountryByCode(baseCountryCode);
  const impact = country ? computeImpact(country, conflict) : null;
  const TrendIcon = conflict.intensityChange24h > 0 ? ArrowUp : conflict.intensityChange24h < 0 ? ArrowDown : Minus;
  const coverage = detail.coverage;
  const health = coverage ? HEALTH_LABEL[coverage.health] : null;
  const allReports = detail.recentEvents.flatMap((e) => e.sources.map((s) => ({ ...s, eventTitle: e.title, eventSlug: e.slug })));
  // Party / aligned claims are hidden by default (Profile -> Sources); they are counted, not dropped.
  const hiddenPartyClaims = showPartyClaims ? 0 : allReports.filter((s) => s.trust?.category === "party_claim").length;
  const latestReports = allReports.filter((s) => showPartyClaims || s.trust?.category !== "party_claim").slice(0, 8);

  return (
    <main className="mx-auto max-w-[1100px] px-4 pb-28 pt-24 sm:px-6 sm:pt-32" data-testid="conflict-page">
      {/* Overview */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={conflict.severity} />
            {conflict.fullScaleWar && (
              <span className="rounded-full border border-severe/40 bg-severe-dim px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-severe" data-testid="full-scale-war-flag">
                Full-scale war
              </span>
            )}
          </div>
          <h1 className="mt-2 text-2xl font-semibold text-ink sm:text-[32px]" data-testid="conflict-name">
            {conflict.name}
          </h1>
          <FollowButton entityType="conflict" entityKey={conflict.slug} label={conflict.shortName ?? conflict.name} className="mt-2" />
          <p className="mt-1 text-sm text-ink-dim" data-testid="conflict-overview-line">
            Status: {detail.statusLabel}
            {detail.family && <span data-testid="conflict-family">{" · "}{detail.family.name} family</span>}
            {" · "}
            {conflict.startedAt ? `Started ${new Date(conflict.startedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })}` : "Start date not recorded"}
            {" · "}
            <span data-testid="classification">{CLASSIFICATION_LABEL[conflict.classificationConfidence] ?? conflict.classificationConfidence}</span>
          </p>
          <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-ink-faint" data-testid="conflict-freshness">
            <FreshnessStamp label="Last event" iso={detail.freshness.lastEventAt} staleAfterHours={24 * 7} none="no published events" />
            <FreshnessStamp label="Last source fetch" iso={detail.freshness.lastSourceFetchAt} staleAfterHours={STALE_SOURCE_HOURS} none="never" />
            <FreshnessStamp label="Record updated" iso={detail.freshness.conflictUpdatedAt} />
          </p>
        </div>
        <CountrySelector />
      </div>
      {conflict.summary && <p className="mt-4 max-w-3xl text-sm leading-relaxed text-ink-dim">{conflict.summary}</p>}

      {/* Brief: what changed in a selected period, from recorded events and reviewed evidence */}
      <Section title="Brief" testId="section-brief">
        <BriefPanel scope={{ conflict: conflict.slug }} initialWindow="24h" compact allowSave={false} />
      </Section>

      {/* Geography */}
      <Section title="Geography" testId="section-geography">
        <div className="grid gap-4 rounded-2xl border border-border bg-card/70 p-5 sm:grid-cols-3">
          <GeoList label="Fighting occurs in" testId="geo-fighting" items={detail.geography.fighting.map((c) => c.name)} empty="No fighting geography recorded" />
          <GeoList label="Participants / belligerents" testId="geo-participants" items={detail.geography.participants.map((c) => c.name)} empty="None recorded" />
          <GeoList label="External supporters" testId="geo-supporters" items={detail.geography.supporters.map((c) => c.name)} empty="None recorded" />
        </div>
        <p className="mt-2 text-xs text-ink-faint">
          {conflict.region}
          {detail.family ? ` · ${detail.family.name} family` : ""}
          {detail.geography.regions.length > 0 ? ` · ${detail.geography.regions.join(", ")}` : ""}
          {" · "}Participation is not the same as fighting on a country&apos;s soil.
        </p>
      </Section>

      {/* Scores */}
      <Section title="Scores" testId="section-scores">
        <div className="grid gap-4 md:grid-cols-3">
          <ScoreCard
            label="Severity"
            value={detail.scores?.severity.severityScore ?? conflict.intensity}
            sub={`Intensity ${conflict.intensity} / 100 · `}
            extra={
              <span className="inline-flex items-center gap-0.5">
                <TrendIcon className="h-3 w-3" />
                {Math.abs(conflict.intensityChange24h)} 24h
              </span>
            }
            reasons={detail.scores?.severity.reasons ?? []}
            testId="score-severity"
          />
          <ScoreCard
            label="Confidence"
            value={detail.scores?.confidence.confidenceScore ?? null}
            sub="Evidence quality, separate from severity · "
            reasons={detail.scores?.confidence.reasons ?? []}
            testId="score-confidence"
            emptyText="Not enough evidence to score"
          />
          <ScoreCard
            label={country ? `Impact on ${country.name}` : "Impact"}
            value={impact?.score ?? null}
            sub="Estimated exposure · "
            extra={impact ? <span>{formatSigned(impact.change24h)} today</span> : undefined}
            reasons={impact ? impact.overallDrivers.map((d) => d.description).filter(Boolean) : []}
            testId="score-impact"
            emptyText="Select a country"
            accent
          />
        </div>
        {impact && (
          <details className="mt-3 rounded-2xl border border-border bg-card/70 p-4" data-testid="impact-details">
            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-ink-faint">Impact breakdown for {country?.name}</summary>
            <div className="mt-3 grid gap-6 lg:grid-cols-[320px_1fr]">
              <ExposureRadar components={impact.components} />
              <div className="grid gap-3 sm:grid-cols-2">
                {impact.components.map((c) => (
                  <ImpactBreakdown key={c.dimension} component={c} />
                ))}
              </div>
            </div>
          </details>
        )}
      </Section>

      {/* Recent events */}
      <Section title="Recent events" testId="section-events" aside={<span className="text-xs text-ink-faint">{detail.activity.last24h} in 24h · {detail.activity.last7d} in 7d · {detail.activity.total} total</span>}>
        {detail.recentEvents.length === 0 ? (
          <EmptyState title="No published events for this conflict yet" detail="Events appear here once reports are reviewed and published." testId="events-empty" />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {detail.recentEvents.slice(0, 8).map((e) => (
              <EventCard key={e.id} event={e} compact />
            ))}
          </div>
        )}
      </Section>

      {/* Actors */}
      <Section title="Actors" testId="section-actors">
        {detail.actors.length === 0 ? (
          <EmptyState title="No linked armed actors recorded" testId="actors-empty" />
        ) : (
          <ul className="flex flex-wrap gap-2">
            {detail.actors.map((a) => (
              <li key={a.name} className="flex flex-col items-start" data-testid="conflict-actor">
                {a.href ? (
                  <Link href={a.href} data-testid="actor-link" className="rounded-full border border-border-strong px-3 py-1 text-xs text-accent hover:bg-white/5">
                    {a.name}
                  </Link>
                ) : (
                  <span className="rounded-full border border-border px-3 py-1 text-xs text-ink-dim">{a.name}</span>
                )}
                <span className="mt-0.5 pl-3 text-[10px] text-ink-faint" data-testid="actor-role">
                  {a.role}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Territorial control */}
      <Section title="Territorial control" testId="section-territory">
        {detail.territory.areas === 0 ? (
          <EmptyState title="No published territorial control for this conflict" detail="Control areas are drawn and verified by reviewers; none are currently recorded." testId="territory-empty" />
        ) : (
          <div className="rounded-2xl border border-border bg-card/70 p-5 text-sm text-ink-dim" data-testid="territory-summary">
            <p>
              {detail.territory.areas} published area{detail.territory.areas === 1 ? "" : "s"}
              {detail.territory.lastChangeAt && (
                <>
                  {" · latest change "}
                  <RelativeTime iso={detail.territory.lastChangeAt} />
                </>
              )}
            </p>
            {detail.territory.actors.length > 0 && (
              <p className="mt-1">
                Controlling actors:{" "}
                {detail.territory.actors.map((a, i) => (
                  <span key={a.name}>
                    {i > 0 && ", "}
                    {a.link.href ? (
                      <Link href={a.link.href} className="text-accent hover:underline" data-testid="actor-link">
                        {a.name}
                      </Link>
                    ) : (
                      a.name
                    )}{" "}
                    ({a.areas})
                  </span>
                ))}
              </p>
            )}
            <Link href="/world" className="mt-2 inline-block text-xs text-accent hover:underline">
              View on the map (turn on Territorial Control)
            </Link>
          </div>
        )}
        {detail.territorialChanges.length > 0 && (
          <ul className="mt-3 space-y-2" data-testid="territorial-changes">
            {detail.territorialChanges.map((c) => (
              <li key={c.id} className="rounded-xl border border-border bg-card/60 px-3 py-2 text-xs text-ink-dim">
                <span className="font-medium text-ink">{c.description}</span>
                {c.claimedActor && (
                  <span>
                    {" · "}
                    {c.claimedActor.href ? (
                      <Link href={c.claimedActor.href} className="text-accent hover:underline" data-testid="actor-link">
                        {c.claimedActor.name}
                      </Link>
                    ) : (
                      c.claimedActor.name
                    )}
                  </span>
                )}
                <span className="text-ink-faint">
                  {" · "}
                  <RelativeTime iso={c.observedAt ?? c.reviewedAt} fallback="date unknown" />
                  {!c.geometryApplied && " · map not yet updated"}
                </span>
                {c.sourceUrl ? (
                  <a href={c.sourceUrl} target="_blank" rel="noopener noreferrer" className="ml-1 text-accent hover:underline">
                    {c.sourceName ?? "source"}
                  </a>
                ) : (
                  <span className="ml-1 text-ink-faint">Source unavailable</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {detail.conflictingClaims.length > 0 && (
        <Section title="Conflicting claims" testId="section-conflicting-claims">
          {detail.conflictingClaims.map((g) => (
            <ConflictingClaimsBlock key={g.location} group={g} />
          ))}
        </Section>
      )}

      {/* Sources + coverage */}
      <Section title="Sources and coverage" testId="section-sources">
        {health && coverage ? (
          <div className="rounded-2xl border border-border bg-card/70 p-5" data-testid="coverage-state">
            <p className="text-sm font-semibold text-ink" data-testid="coverage-health">
              {health.label}
            </p>
            <p className="mt-0.5 text-xs text-ink-dim">{health.detail}</p>
            {coverage.reasons.length > 0 && <p className="mt-1 text-xs text-ink-faint">{coverage.reasons.join(" ")}</p>}
            {coverage.dedicatedSources === 0 && (
              <p className="mt-1 text-xs text-elevated" data-testid="no-dedicated-sources">
                No dedicated source: nothing is specifically tracking this conflict, so its coverage relies on general outlets.
              </p>
            )}
            <p className="mt-2 text-xs text-ink-faint">
              {coverage.enabledSources} enabled source{coverage.enabledSources === 1 ? "" : "s"} · {coverage.independentSources} independent · {coverage.tierDiversity} source tier{coverage.tierDiversity === 1 ? "" : "s"}
            </p>
            {coverage.sources.length === 0 ? (
              <EmptyState className="mt-3" title="No sources linked to this conflict" testId="sources-empty" />
            ) : (
              <ul className="mt-3 divide-y divide-border text-xs" data-testid="source-list">
                {coverage.sources.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="font-medium text-ink" data-testid="source-card">
                      {s.name}
                      <span className={cn("ml-2 rounded-full border px-1.5 py-0.5 align-middle text-[9px] font-semibold uppercase tracking-wide", s.trust.category === "party_claim" ? "border-high/50 text-high" : s.trust.category === "strong" ? "border-stable/40 text-stable" : "border-border-strong text-ink-faint")} data-testid="trust-label">
                        {s.trust.badge ?? s.trust.label}
                      </span>
                      {s.trust.perspective && <span className="block text-[11px] font-normal text-ink-dim">{s.trust.perspective}</span>}
                    </span>
                    <span className="text-ink-faint">
                      {SOURCE_TIER_LABEL[s.tier]} · {s.kind === "specialist_local" ? "local / specialist" : s.kind}
                      {!s.enabled && " · disabled"}
                    </span>
                    <FreshnessStamp label="Last fetch" iso={s.lastSuccessfulIngestion} staleAfterHours={STALE_SOURCE_HOURS} none="never" />
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <EmptyState title="Coverage unavailable" />
        )}
        <h3 className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Latest reports</h3>
        {hiddenPartyClaims > 0 && (
          <p className="mb-2 text-xs text-ink-faint" data-testid="party-claims-hidden">
            {hiddenPartyClaims} party claim{hiddenPartyClaims === 1 ? "" : "s"} hidden (Profile → Sources → Show Party / Aligned Claims)
          </p>
        )}
        {latestReports.length === 0 ? (
          <EmptyState title="No supporting reports yet" testId="reports-empty" />
        ) : (
          <ul className="space-y-2" data-testid="latest-reports">
            {latestReports.map((s, i) => (
              <li key={`${s.id}-${i}`} className="rounded-xl border border-border bg-card/70 p-3 text-xs" data-testid="latest-report">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium text-ink">
                    {s.name}
                    {s.trust && <span className="ml-2 rounded-full border border-border-strong px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-ink-faint">{s.trust.badge ?? s.trust.label}</span>}
                  </p>
                  <RelativeTime iso={s.publishedAt} className="shrink-0 text-ink-faint" />
                </div>
                <p className="text-ink-faint">
                  re: <Link href={`/event/${s.eventSlug}`} className="hover:underline">{s.eventTitle}</Link>
                </p>
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="mt-1 block truncate text-accent hover:underline" data-testid="original-source-link">
                    {s.url}
                  </a>
                ) : (
                  <p className="mt-1 text-ink-faint" data-testid="source-unavailable">
                    Source unavailable
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* History */}
      <Section title="History" testId="section-history">
        {detail.history.length === 0 ? (
          <EmptyState title="No event history in the last 12 months" testId="history-empty" />
        ) : (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="history-months">
            {detail.history.map((h) => (
              <li key={h.month} className="rounded-xl border border-border bg-card/60 px-3 py-2 text-xs">
                <span className="text-ink-faint">{MONTH(h.month)}</span>
                <span className="ml-2 font-semibold text-ink">{h.events}</span> events
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Map */}
      <Section title="Map" testId="section-map">
        {showMap ? (
          <div className="h-[420px] overflow-hidden rounded-2xl border border-border">
            <WorldMap events={detail.recentEvents} conflicts={conflict.locationKnown ? [conflict] : []} viewMode="markers" basemapMode={basemapMode} onSelectEvent={() => {}} className="h-full w-full" />
          </div>
        ) : (
          <button type="button" onClick={() => setShowMap(true)} className="rounded-xl border border-border-strong px-4 py-2 text-xs font-medium text-accent hover:bg-white/5" data-testid="show-map">
            Show map of recent events
          </button>
        )}
      </Section>
    </main>
  );
}

function Section({ title, children, testId, aside }: { title: string; children: React.ReactNode; testId: string; aside?: React.ReactNode }) {
  return (
    <section className="mt-8" data-testid={testId}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-faint">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function GeoList({ label, items, empty, testId }: { label: string; items: string[]; empty: string; testId: string }) {
  return (
    <div data-testid={testId}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">{label}</p>
      <p className="mt-1 text-sm text-ink">{items.length > 0 ? items.join(", ") : <span className="text-ink-faint">{empty}</span>}</p>
    </div>
  );
}

function ScoreCard({
  label,
  value,
  sub,
  extra,
  reasons,
  testId,
  emptyText = "Unavailable",
  accent,
}: {
  label: string;
  value: number | null;
  sub?: string;
  extra?: React.ReactNode;
  reasons: string[];
  testId: string;
  emptyText?: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card/70 p-5" data-testid={testId}>
      <p className="text-[11px] font-semibold uppercase tracking-widest text-ink-faint">{label}</p>
      {value === null ? (
        <p className="mt-2 text-sm text-ink-faint">{emptyText}</p>
      ) : (
        <p className={cn("mt-1 text-3xl font-semibold tabular-nums", accent ? "text-accent" : "text-ink")} data-testid={`${testId}-value`}>
          {Math.round(value)}
          <span className="text-sm font-medium text-ink-faint"> / 100</span>
        </p>
      )}
      <p className="mt-0.5 text-[11px] text-ink-faint">
        {sub}
        {extra}
      </p>
      {reasons.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-ink-dim" data-testid={`${testId}-reasons`}>
          {reasons.slice(0, 5).map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
