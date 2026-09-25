"use client";

import Link from "next/link";
import { ArrowUp, ArrowDown, Minus, Map as MapIcon } from "lucide-react";
import { FollowButton } from "@/components/watch/follow-button";
import { SeverityBadge } from "@/components/ui/severity-badge";
import { RelativeTime } from "@/components/ui/relative-time";
import { CountrySelector } from "@/components/home/country-selector";
import { EmptyState, FreshnessStamp } from "@/components/public/data-states";
import { ConflictingClaimsBlock } from "@/components/events/evidence-panel";
import { CountrySection } from "@/components/country/country-sections";
import { ConflictFeed, ConflictMap, ImpactScoreCard, WhatChanged } from "@/components/conflicts/conflict-intel-client";
import { useAppStore } from "@/hooks/use-app-store";
import { SOURCE_TIER_LABEL } from "@/lib/registry/source-tiers";
import { STALE_SOURCE_HOURS } from "@/lib/public/stale";
import { BriefPanel } from "@/components/brief/brief-view";
import type { ConflictIntelligence, RelatedCountry } from "@/lib/conflicts/intelligence";
import { OTHER_IMPACT_MIN } from "@/lib/conflicts/constants";
import { SEVERITY_TEXT_CLASS, severityFromScore } from "@/lib/utils/severity";
import { cn } from "@/lib/utils";

const VERDICT_TONE: Record<string, string> = { GOOD: "border-emerald-400/40 text-emerald-300", LIMITED: "border-yellow-400/40 text-yellow-200", STALE: "border-orange-400/40 text-orange-300" };

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

/** The public conflict intelligence page. Everything shown comes from ONE server aggregation
 * (lib/conflicts/intelligence.ts over lib/public/conflict-detail); a section with no data shows an explicit empty state. */
export function ConflictDetailClient({ intel }: { intel: ConflictIntelligence }) {
  const detail = intel.detail;
  const { conflict } = detail;
  const showPartyClaims = useAppStore((s) => s.showPartyClaims);
  const TrendIcon = conflict.intensityChange24h > 0 ? ArrowUp : conflict.intensityChange24h < 0 ? ArrowDown : Minus;
  const coverage = detail.coverage;
  const health = coverage ? HEALTH_LABEL[coverage.health] : null;
  const allReports = detail.recentEvents.flatMap((e) => e.sources.map((s) => ({ ...s, eventTitle: e.title, eventSlug: e.slug })));
  // Party / aligned claims are hidden by default (Profile -> Sources); they are counted, not dropped.
  const hiddenPartyClaims = showPartyClaims ? 0 : allReports.filter((s) => s.trust?.category === "party_claim").length;
  const latestReports = allReports.filter((s) => showPartyClaims || s.trust?.category !== "party_claim").slice(0, 8);
  const focus = (() => {
    const u = new URL(intel.mapHref, "http://x").searchParams.get("focus")?.split(",").map(Number) ?? [];
    return { lat: u[0] ?? conflict.lat, lng: u[1] ?? conflict.lng, zoom: u[2] ?? 5 };
  })();
  const sev = intel.scores.severity;
  const conf = intel.scores.confidence;
  const territoryAvailable = intel.territory.datasets.length > 0 || detail.territory.areas > 0;

  return (
    <main className="mx-auto w-full max-w-[1100px] overflow-x-hidden px-4 pb-28 pt-24 sm:px-6 sm:pt-28" data-testid="conflict-page" data-slug={conflict.slug}>
      {/* Header / primary status */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={conflict.severity} />
            {conflict.fullScaleWar && (
              <span className="rounded-full border border-severe/40 bg-severe-dim px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-severe" data-testid="full-scale-war-flag">
                Full-scale war
              </span>
            )}
            <span className="text-[11px] text-ink-faint" data-testid="classification">
              {CLASSIFICATION_LABEL[conflict.classificationConfidence] ?? conflict.classificationConfidence}
            </span>
          </div>
          <h1 className="mt-2 text-2xl font-semibold text-ink sm:text-[30px]" data-testid="conflict-name">
            {conflict.name}
          </h1>
          <p className="mt-1 text-sm text-ink-dim" data-testid="conflict-overview-line">
            Status: {detail.statusLabel}
            {" · "}
            {conflict.region}
            {detail.family && <span data-testid="conflict-family">{" · "}{detail.family.name} family</span>}
            {" · "}
            {conflict.startedAt ? `Started ${new Date(conflict.startedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })}` : "Start date not recorded"}
          </p>
          <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-ink-faint" data-testid="conflict-freshness">
            <FreshnessStamp label="Last event" iso={detail.freshness.lastEventAt} staleAfterHours={24 * 7} none="no published events" />
            <FreshnessStamp label="Last source fetch" iso={detail.freshness.lastSourceFetchAt} staleAfterHours={STALE_SOURCE_HOURS} none="never" />
            <span data-testid="conflict-report-counts">
              Unique published reports: {intel.reportCounts["24H"]} (24h) · {intel.reportCounts["7D"]} (7d) · {intel.reportCounts["30D"]} (30d)
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FollowButton entityType="conflict" entityKey={conflict.slug} label={conflict.shortName ?? conflict.name} />
          <Link href={intel.mapHref} className="inline-flex items-center gap-1 rounded-full border border-border-strong px-3 py-1.5 text-xs font-medium text-accent hover:bg-white/5" data-testid="header-open-world">
            <MapIcon className="h-3.5 w-3.5" aria-hidden /> Open in World Map
          </Link>
          <CountrySelector />
        </div>
      </div>
      {conflict.summary && <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-dim">{conflict.summary}</p>}

      {/* Three separate scores; never collapsed into one */}
      <Section title="Severity · Impact · Confidence" testId="section-scores" aside={<span className="text-[11px] text-ink-faint">three separate measures; report volume feeds none of them</span>}>
        <div className="grid gap-3 md:grid-cols-3">
          <ScoreCard
            label="Severity"
            value={sev.value}
            sub={`${sev.label ?? ""} · intensity ${conflict.intensity} / 100 · `}
            extra={
              <span className="inline-flex items-center gap-0.5">
                <TrendIcon className="h-3 w-3" />
                {Math.abs(conflict.intensityChange24h)} 24h
              </span>
            }
            reasons={sev.reasons}
            explanation={sev.explanation}
            testId="score-severity"
          />
          <ImpactScoreCard byCountry={intel.scores.impact.byCountry} explanation={intel.scores.impact.explanation} />
          <ScoreCard
            label="Confidence"
            value={conf.value}
            sub={`${conf.rollup.corroborated} of ${conf.rollup.events30d - conf.rollup.partyOnly} incidents (30d) have 2+ independent source groups · `}
            reasons={conf.reasons}
            explanation={conf.explanation}
            testId="score-confidence"
            emptyText="Not enough evidence to score"
          />
        </div>
      </Section>

      {/* Current situation */}
      <Section title="Current situation" testId="section-situation">
        <ul className="space-y-1 text-sm text-ink" data-testid="current-situation">
          {intel.currentSituation.map((line) => (
            <li key={line} className="flex gap-2" data-testid="situation-line">
              <span className="text-ink-faint" aria-hidden>
                –
              </span>
              {line}
            </li>
          ))}
        </ul>
      </Section>

      {/* Latest developments with evidence (incidents + conflict-wide developments) */}
      <Section title="Latest developments" testId="section-events" aside={<span className="text-xs text-ink-faint">{detail.activity.last24h} in 24h · {detail.activity.last7d} in 7d · {detail.activity.total} total</span>}>
        {intel.feed.length === 0 ? (
          <EmptyState title="No meaningful developments in this period." detail="Incidents appear here once reports are reviewed and published." testId="events-empty" />
        ) : (
          <ConflictFeed items={intel.feed} generatedAt={intel.generatedAt} />
        )}
      </Section>

      {/* Map */}
      <Section title="Map" testId="section-map">
        <ConflictMap conflict={conflict} focus={focus} datasetIds={intel.territory.datasets.map((d) => d.id)} worldHref={intel.mapHref} />
      </Section>

      {/* Actors */}
      <Section title="Actors" testId="section-actors">
        {intel.actors.length === 0 ? (
          <EmptyState title="No linked armed actors recorded" testId="actors-empty" />
        ) : (
          <ul className="grid gap-2 md:grid-cols-2">
            {intel.actors.map((a) => (
              <li key={a.id} className="rounded-xl border border-border bg-card/50 px-3 py-2" data-testid="conflict-actor">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <Link href={a.href} data-testid="actor-link" className="text-sm font-medium text-accent hover:underline">
                    {a.name}
                  </Link>
                  <span className="text-[11px] text-ink-faint" data-testid="actor-role">
                    {a.typeLabel ?? a.role}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-ink-dim" data-testid="actor-relationship">
                  {a.relationship}
                  {a.lastObservedAt ? <> · last observed <RelativeTime iso={a.lastObservedAt} /></> : " · no sourced event linked"}
                </p>
                <p className="text-[10px] text-ink-faint">
                  {a.provenance ? `Source: ${a.provenance}` : "No provenance recorded"}
                  {a.confidence != null ? ` · link confidence ${Math.round(a.confidence * 100)}%` : ""}
                  {a.commanders.length > 0 && (
                    <>
                      {" · commander: "}
                      {a.commanders.map((cm, i) => (
                        <span key={cm.id}>
                          {i > 0 && ", "}
                          <Link href={cm.href} className="hover:text-ink">
                            {cm.rank ? `${cm.rank} ` : ""}
                            {cm.name}
                          </Link>
                        </span>
                      ))}
                    </>
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Territorial control */}
      <Section title="Territorial control" testId="section-territory" aside={<span className="text-[11px] text-ink-faint">reported / de facto control, not legal sovereignty</span>}>
        {!territoryAvailable ? (
          <EmptyState title="No verified territorial dataset available." detail="Control areas come from reviewed, licensed datasets or reviewer-drawn geometry; none is published for this conflict." testId="territory-empty" />
        ) : (
          <div className="space-y-2" data-testid="territory-summary">
            {intel.territory.datasets.map((d) => (
              <div key={d.id} className="rounded-xl border border-border bg-card/50 px-3.5 py-2.5" data-testid="territory-dataset" data-kind={d.kind}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-ink">
                    {d.name}
                    <span className={cn("ml-2 rounded border px-1 py-px text-[10px] font-semibold uppercase", d.kind === "control" ? "border-stable/40 text-stable" : "border-dashed border-ink-faint text-ink-dim")} data-testid="territory-dataset-type">
                      {d.typeLabel}
                    </span>
                  </p>
                  <Link href={d.openOnMap} className="text-[11px] text-accent hover:underline" data-testid="territory-open-map">
                    Open on Map
                  </Link>
                </div>
                <p className="mt-0.5 text-[12px] text-ink-dim">
                  {d.actors.length ? `Actors: ${d.actors.join(", ")}` : "No actor recorded"} · {d.areaCount} published area version{d.areaCount === 1 ? "" : "s"}
                  {d.kind !== "control" && <span className="text-ink-faint"> · reported {d.kind}, not territorial control</span>}
                </p>
                <p className="mt-0.5 text-[11px] text-ink-faint">
                  {d.provider}
                  {d.lastUpdated ? <> · updated <RelativeTime iso={d.lastUpdated} /></> : ""}
                  {d.confidence != null ? ` · confidence ${Math.round(d.confidence * 100)}%` : ""}
                  {d.license ? ` · ${d.license}` : ""}
                  {d.attribution ? ` · ${d.attribution}` : ""}
                </p>
              </div>
            ))}
            {detail.territory.areas > 0 && (
              <p className="text-[12px] text-ink-dim">
                {detail.territory.areas} published area{detail.territory.areas === 1 ? "" : "s"} in total
                {detail.territory.lastChangeAt && (
                  <>
                    {" · latest change "}
                    <RelativeTime iso={detail.territory.lastChangeAt} />
                  </>
                )}
                {detail.territory.actors.length > 0 && (
                  <>
                    {" · controlling actors: "}
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
                  </>
                )}
              </p>
            )}
          </div>
        )}
        {detail.territorialChanges.length > 0 && (
          <ul className="mt-3 space-y-2" data-testid="territorial-changes">
            {detail.territorialChanges.map((c) => (
              <li key={c.id} className="rounded-xl border border-border bg-card/60 px-3 py-2 text-xs text-ink-dim">
                <span className="font-medium text-ink">Approved: {c.description}</span>
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

      {/* What changed */}
      <CountrySection id="what-changed" title="What changed" secondary>
        <WhatChanged windows={intel.whatChanged} />
      </CountrySection>

      {/* Fighting geography vs belligerents vs external support */}
      <Section title="Fighting geography · Belligerents · External support" testId="section-geography">
        <div className="grid gap-4 rounded-2xl border border-border bg-card/70 p-5 sm:grid-cols-3">
          <GeoList label="Fighting geography" testId="geo-fighting" items={detail.geography.fighting} empty="No fighting geography recorded" />
          <GeoList label="Belligerent states" testId="geo-participants" items={detail.geography.participants} empty="None recorded" />
          <GeoList label="External support" testId="geo-supporters" items={detail.geography.supporters} empty="None recorded" />
        </div>
        <p className="mt-2 text-xs text-ink-faint">
          {detail.geography.regions.length > 0 ? `Regions: ${detail.geography.regions.join(", ")} · ` : ""}
          Belligerence or support does not mean fighting takes place on that country&apos;s territory; only the fighting geography sets the country impact floors.
        </p>
      </Section>

      {/* Related countries (central impact model, grouped factually) */}
      <CountrySection id="related-countries" title="Countries most directly affected" secondary aside={<span className="text-[11px] text-ink-faint">central impact model · fighting geography only</span>}>
        <RelatedGroup title="Fighting inside" rows={intel.relatedCountries.fightingInside} testId="related-inside" empty="No fighting geography recorded." />
        <RelatedGroup title="Direct bordering exposure" rows={intel.relatedCountries.bordering} testId="related-bordering" empty="No land border with the fighting geography." />
        <RelatedGroup title={`Other meaningful impact (${OTHER_IMPACT_MIN}+)`} rows={intel.relatedCountries.other} testId="related-other" empty={`No other country reaches impact ${OTHER_IMPACT_MIN}.`} compact />
      </CountrySection>

      {/* Timeline of state changes */}
      <CountrySection id="timeline" title="Conflict timeline" secondary aside={<span className="text-[11px] text-ink-faint">state changes and corroborated incidents, not every report</span>}>
        {intel.timeline.length === 0 ? (
          <p className="text-sm text-ink-dim" data-testid="timeline-empty">
            No recorded state change yet.
          </p>
        ) : (
          <ol className="space-y-1.5 border-l border-border pl-3" data-testid="conflict-timeline">
            {intel.timeline.map((t, i) => (
              <li key={`${t.kind}-${t.at}-${i}`} className="text-[13px]" data-testid="timeline-entry" data-kind={t.kind}>
                <span className="mr-2 text-[11px] tabular-nums text-ink-faint">{t.at.slice(0, 10)}</span>
                <span className="mr-2 rounded border border-border px-1 text-[10px] uppercase tracking-wide text-ink-faint">{t.kind.replace(/_/g, " ")}</span>
                {t.href ? (
                  <Link href={t.href} className="text-ink hover:text-accent">
                    {t.title}
                  </Link>
                ) : (
                  <span className="text-ink">{t.title}</span>
                )}
                {t.detail && <span className="ml-2 text-[11px] text-ink-faint">{t.detail}</span>}
                {t.mapHref && (
                  <Link href={t.mapHref} className="ml-2 text-[11px] text-accent hover:underline" data-testid="timeline-map-link">
                    map at that time
                  </Link>
                )}
              </li>
            ))}
          </ol>
        )}
      </CountrySection>

      {/* Infrastructure / hazards in the fighting geography */}
      <CountrySection id="infrastructure" title="Infrastructure and hazards" secondary>
        {intel.infrastructure.length === 0 ? (
          <p className="text-sm text-ink-dim" data-testid="infrastructure-empty">
            No current infrastructure disruptions recorded.
          </p>
        ) : (
          <ul className="divide-y divide-border/60 rounded-xl border border-border bg-card/50" data-testid="infrastructure-list">
            {intel.infrastructure.map((d) => (
              <li key={d.id} className="px-3.5 py-2 text-[13px]">
                <p className="text-[11px] text-ink-faint">
                  <RelativeTime iso={d.occurredAt} /> · {d.category} · confidence {d.confidenceLabel}
                </p>
                <Link href={d.deepLink} className="font-medium text-ink hover:text-accent">
                  {d.title}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CountrySection>

      {/* Sources + coverage */}
      <Section title="Sources and coverage" testId="section-sources">
        <div className="mb-3 rounded-xl border border-border bg-card/50 p-4" data-testid="coverage-verdict">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("rounded-full border px-2.5 py-0.5 text-xs font-semibold", VERDICT_TONE[intel.sourceCoverage.state])} data-testid="coverage-verdict-state">
              {intel.sourceCoverage.state} COVERAGE
            </span>
            <span className="text-[12px] text-ink-dim">{intel.sourceCoverage.reasons.join(" ")}</span>
          </div>
          <p className="mt-2 text-[12px] text-ink-dim" data-testid="coverage-verdict-counts">
            {intel.sourceCoverage.dedicated} dedicated ({intel.sourceCoverage.freshDedicated} fresh) · {intel.sourceCoverage.global} global ({intel.sourceCoverage.freshGlobal} fresh) · {intel.sourceCoverage.official} official · {intel.sourceCoverage.independent} independent · {intel.sourceCoverage.partyAligned} party / aligned · last ingestion {intel.sourceCoverage.lastSuccessfulIngestion ? <RelativeTime iso={intel.sourceCoverage.lastSuccessfulIngestion} /> : "never"}
          </p>
          <p className="mt-1 text-[11px] text-ink-faint">The number of sources describes coverage, not confidence. Party / aligned sources never count as independent confirmation.</p>
        </div>
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

      {/* Brief: same engine as /brief */}
      <Section title="Conflict brief" testId="section-brief">
        <BriefPanel scope={{ conflict: conflict.slug }} initialWindow="24h" compact allowSave={false} />
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

function GeoList({ label, items, empty, testId }: { label: string; items: { code: string; name: string }[]; empty: string; testId: string }) {
  return (
    <div data-testid={testId}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">{label}</p>
      <p className="mt-1 text-sm text-ink">
        {items.length > 0 ? (
          items.map((c, i) => (
            <span key={c.code}>
              {i > 0 && ", "}
              <Link href={`/country/${c.code}`} className="hover:text-accent" data-testid="geo-country-link">
                {c.name}
              </Link>
            </span>
          ))
        ) : (
          <span className="text-ink-faint">{empty}</span>
        )}
      </p>
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
  explanation,
}: {
  label: string;
  value: number | null;
  sub?: string;
  extra?: React.ReactNode;
  reasons: string[];
  testId: string;
  emptyText?: string;
  accent?: boolean;
  explanation?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card/60 p-4" data-testid={testId} title={explanation}>
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
      {explanation && <p className="mt-2 text-[11px] leading-snug text-ink-faint">{explanation}</p>}
    </div>
  );
}

function RelatedGroup({ title, rows, testId, empty, compact = false }: { title: string; rows: RelatedCountry[]; testId: string; empty: string; compact?: boolean }) {
  return (
    <div className="mt-3 first:mt-0" data-testid={testId}>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
        {title} <span className="font-normal">({rows.length})</span>
      </p>
      {rows.length === 0 ? (
        <p className="text-[13px] text-ink-dim">{empty}</p>
      ) : compact ? (
        <p className="flex flex-wrap gap-1.5">
          {rows.map((r) => (
            <Link key={r.code} href={`/country/${r.code}`} title={r.reason} className="rounded-full border border-border px-2 py-0.5 text-[11px] text-ink-dim hover:text-ink" data-testid="related-country">
              {r.name} <span className={cn("font-semibold tabular-nums", SEVERITY_TEXT_CLASS[severityFromScore(r.impactScore)])}>{r.impactScore}</span>
            </Link>
          ))}
        </p>
      ) : (
        <ul className="divide-y divide-border/60 rounded-xl border border-border bg-card/50">
          {rows.map((r) => (
            <li key={r.code} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-1.5 text-[13px]" data-testid="related-country" data-code={r.code} data-impact={r.impactScore}>
              <Link href={`/country/${r.code}`} className="font-medium text-ink hover:text-accent" data-testid="geo-country-link">
                {r.name}
              </Link>
              <span className="text-[11px] text-ink-dim">
                <span className={cn("mr-2 font-semibold tabular-nums", SEVERITY_TEXT_CLASS[severityFromScore(r.impactScore)])}>impact {r.impactScore}</span>
                {r.reason}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
