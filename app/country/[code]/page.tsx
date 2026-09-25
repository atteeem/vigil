import { notFound, redirect } from "next/navigation";
import { ContextTrail } from "@/components/discovery/context-trail";
import { RecordRecent } from "@/components/discovery/record-recent";
import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink, Map as MapIcon } from "lucide-react";
import { FollowButton } from "@/components/watch/follow-button";
import { SetBaseCountryButton } from "@/components/home/set-base-country-button";
import { ExposureCategoryCard } from "@/components/impact/exposure-category-card";
import { BriefPanel } from "@/components/brief/brief-view";
import { CountryMap, CountryWatchPanel, FreshnessChip, PartyClaimsPanel } from "@/components/country/country-client";
import { CountryDevelopments, CountrySection } from "@/components/country/country-sections";
import { RelativeTime } from "@/components/ui/relative-time";
import { getCountryIntelligence, type ActorView, type ConflictRowView, type DomainSection, type DevelopmentItem } from "@/lib/countries/intelligence";
import { getCountryRecord, resolveCountry } from "@/lib/countries/registry";
import { SEVERITY_TEXT_CLASS, severityFromScore } from "@/lib/utils/severity";
import type { ExposureDimension } from "@/lib/types";
import { formatSigned, cn } from "@/lib/utils";

// The country intelligence page: "What is happening in and around this country right now?" Everything comes from ONE
// server-side aggregation (lib/countries/intelligence.ts, also GET /api/country/[code]/intelligence) over the existing
// conflict, impact, briefing, territory, hazard, infrastructure, actor and source systems. It derives nothing itself.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const c = resolveCountry((await params).code);
  return { title: c ? `${c.name} — Vigil` : "Country — Vigil" };
}

const COVERAGE_TONE: Record<string, string> = { GOOD: "border-emerald-400/40 text-emerald-300", LIMITED: "border-yellow-400/40 text-yellow-200", STALE: "border-orange-400/40 text-orange-300" };

export default async function CountryPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const rec = resolveCountry(code);
  if (!rec) notFound();
  // FIN / Finland / Suomi all land on the canonical /country/FI.
  if (getCountryRecord(rec.code) && code !== rec.code) redirect(`/country/${rec.code}`);
  const data = await getCountryIntelligence(rec.code);
  if (!data) notFound();
  const { country: c, overview, exposure } = data;
  const severity = severityFromScore(overview.exposureScore);
  const actorCount = data.actors.stateForces.length + data.actors.nonStateArmed.length + data.actors.international.length + data.actors.other.length;

  return (
    <main className="mx-auto w-full max-w-[1080px] overflow-x-hidden px-4 pb-28 pt-24 sm:px-6 sm:pt-28" data-testid="country-page" data-country={c.code}>
      {/* Header: identity, exposure, last update, actions */}
      <ContextTrail className="mb-2" items={[{ label: "Live Map", href: data.mapHref }, ...data.domesticConflictRows.slice(0, 2).map((r) => ({ label: r.name, href: `/conflict/${r.slug}` })), ...data.borderingConflicts.slice(0, 1).map((r) => ({ label: `${r.name} (bordering)`, href: `/conflict/${r.slug}` }))]} />
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 border-b border-border pb-4" data-testid="country-header">
        <div className="flex min-w-0 items-start gap-3">
          <span className="text-4xl leading-none" aria-hidden>
            {c.flag}
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-ink sm:text-[28px]" data-testid="country-name">
              {c.name}
            </h1>
            <RecordRecent type="country" entityKey={c.code} title={c.name} kind="Country" href={`/country/${c.code}`} />
            <p className="text-[13px] text-ink-faint" data-testid="country-identity">
              {c.region} · {c.subregion} · Capital {c.capital} · {c.code} / {c.alpha3}
            </p>
            {c.neighbours.length > 0 && (
              <p className="mt-0.5 text-[11px] text-ink-faint" data-testid="country-neighbours">
                Land borders:{" "}
                {c.neighbours.map((n, i) => (
                  <span key={n.code}>
                    {i > 0 && ", "}
                    <Link href={`/country/${n.code}`} className="hover:text-ink">
                      {n.name}
                    </Link>
                  </span>
                ))}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-2 text-right" data-testid="header-exposure">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-faint">Current exposure</p>
            <p className="flex items-baseline justify-end gap-1.5">
              <span className={cn("text-2xl font-semibold tabular-nums", SEVERITY_TEXT_CLASS[severity])} data-testid="overview-exposure">
                {overview.exposureScore}
              </span>
              <span className={cn("text-xs font-semibold", SEVERITY_TEXT_CLASS[severity])}>{overview.exposureLabel}</span>
            </p>
            <p className="text-[10px] text-ink-faint" data-testid="last-meaningful-update">
              Last meaningful update: {data.lastMeaningfulUpdate ? <RelativeTime iso={data.lastMeaningfulUpdate} /> : "none in 7 days"}
            </p>
          </div>
          <FollowButton entityType="country" entityKey={c.code} label={c.name} />
          <Link href={`/brief/country/${c.code}`} className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-ink-dim hover:text-ink" data-testid="country-brief-link">
            Country brief
          </Link>
          <Link href={data.mapHref} className="inline-flex items-center gap-1 rounded-full border border-border-strong px-3 py-1.5 text-xs font-medium text-accent hover:bg-white/5" data-testid="header-open-world">
            <MapIcon className="h-3.5 w-3.5" aria-hidden /> Open in World Map
          </Link>
          <SetBaseCountryButton code={c.code} />
        </div>
      </header>

      {/* Overview */}
      <section className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" data-testid="country-overview">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-ink-faint">Impact {overview.exposureScore} · why</p>
          <ul className="mt-1.5 space-y-1 text-[13px]" data-testid="exposure-drivers">
            {data.exposureDrivers.map((d) => (
              <li key={d.text} className="flex gap-2" data-testid="exposure-driver" data-kind={d.kind}>
                <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", d.kind === "score" ? "bg-accent" : "bg-ink-faint")} aria-hidden />
                <span className="text-ink-dim">
                  {d.conflictSlug ? (
                    <Link href={`/conflict/${d.conflictSlug}`} className="hover:text-ink">
                      {d.text}
                    </Link>
                  ) : (
                    d.text
                  )}
                  {d.kind === "context" && <span className="ml-1 text-[11px] text-ink-faint">(context, not a score input)</span>}
                </span>
              </li>
            ))}
            {data.exposureDrivers.length === 0 && <li className="text-ink-dim">No monitored conflict or recorded disruption currently raises exposure.</li>}
          </ul>
          <p className="mt-2 text-[11px] text-ink-faint">
            {formatSigned(exposure.change24h)} today · {exposure.note}
          </p>
        </div>
        <div className="grid min-w-0 grid-cols-3 gap-2 self-start text-center">
          <Stat label="Domestic conflicts" value={overview.activeDomesticConflicts} testId="stat-domestic" />
          <Stat label="Bordering conflicts" value={data.borderingConflicts.length} testId="stat-bordering" />
          <Stat label="Disruptions (7d)" value={overview.significantDisruptions} testId="stat-disruptions" />
        </div>
      </section>
      <p className="mt-3 text-sm font-medium text-ink" data-testid="overview-status">
        {overview.statusLine}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5" data-testid="freshness">
        {data.freshness.map((f) => (
          <FreshnessChip key={f.key} keyName={f.key} label={f.label} at={f.at} stale={f.stale} />
        ))}
      </div>

      {/* Current situation: deterministic statements only */}
      <CountrySection id="situation" title="Current situation">
        <ul className="space-y-1 text-sm text-ink" data-testid="current-situation">
          {data.currentSituation.map((line) => (
            <li key={line} className="flex gap-2" data-testid="situation-line">
              <span className="text-ink-faint" aria-hidden>
                –
              </span>
              {line}
            </li>
          ))}
        </ul>
      </CountrySection>

      {/* Conflict exposure */}
      <CountrySection id="exposure" title="Conflict exposure" aside={<span className="text-[11px] text-ink-faint">severity, impact and confidence are separate; report volume feeds none of them</span>}>
        <ConflictGroup title="Domestic" empty={`No active conflict recorded inside ${c.name}.`} rows={data.domesticConflictRows} testId="conflicts-domestic" />
        <ConflictGroup title="Bordering" empty="No active conflict with fighting in a bordering country." rows={data.borderingConflicts} testId="conflicts-bordering" />
        <ConflictGroup title="Other high-impact" empty="No other conflict reaches impact 40 for this country." rows={data.otherRelevantConflicts} testId="conflicts-other" />
        <details className="mt-3">
          <summary className="cursor-pointer text-[11px] text-ink-faint">Impact reasoning and exposure dimensions</summary>
          <ul className="mt-2 space-y-1.5" data-testid="exposure-reasons">
            {exposure.reasoning.map((r) => (
              <li key={r.conflictSlug} className="text-[13px]" data-testid="exposure-reason" data-impact={r.impact}>
                <Link href={`/conflict/${r.conflictSlug}`} className="font-medium text-ink hover:text-accent">
                  {r.conflictName}: {r.impact}
                </Link>
                <span className="ml-2 text-[12px] text-ink-dim">{r.reasons.join(" · ")}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5" data-testid="exposure-dimensions">
            {exposure.dimensions.map((d) => (
              <div key={d.dimension} title={d.explanation}>
                <ExposureCategoryCard dimension={d.dimension as ExposureDimension} value={d.value ?? 0} change24h={0} basis={d.basis} topConflictName={exposure.leadConflict ?? undefined} />
              </div>
            ))}
          </div>
        </details>
      </CountrySection>

      {/* Latest developments */}
      <CountrySection id="developments" title="Latest developments">
        <CountryDevelopments items={data.developmentFeed} generatedAt={data.generatedAt} />
      </CountrySection>

      {/* Territorial / security */}
      <CountrySection id="territory" title="Territorial / security" secondary aside={<span className="text-[11px] text-ink-faint">reported / de facto control, not legal sovereignty</span>}>
        {data.territoryDatasets.length === 0 && !data.territory.available ? (
          <p className="text-sm text-ink-dim" data-testid="territory-none">
            No verified territorial dataset available.
          </p>
        ) : (
          <div className="space-y-2" data-testid="territory-context">
            {data.territoryDatasets.map((d) => (
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
                  {d.kind !== "control" && <span className="text-ink-faint"> · reported {d.kind}, not control</span>}
                  {d.conflictSlug && (
                    <>
                      {" · "}
                      <Link href={`/conflict/${d.conflictSlug}`} className="text-accent hover:underline" data-testid="territory-conflict-link">
                        {d.conflictName ?? "conflict"}
                      </Link>
                    </>
                  )}
                </p>
                <p className="mt-0.5 text-[11px] text-ink-faint">
                  {d.provider}
                  {d.lastUpdated ? <> · updated <RelativeTime iso={d.lastUpdated} /></> : ""}
                  {d.confidence != null ? ` · confidence ${Math.round(d.confidence * 100)}%` : ""}
                  {d.license ? ` · ${d.license}` : ""}
                  {d.sourceUrl && (
                    <>
                      {" · "}
                      <a href={d.sourceUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-0.5 text-accent hover:underline">
                        source <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    </>
                  )}
                </p>
              </div>
            ))}
            {data.territory.conflicts.map((t) =>
              t.changes.length > 0 || t.conflictingClaims.length > 0 ? (
                <div key={t.slug} className="rounded-xl border border-border bg-card/50 px-3.5 py-2.5" data-testid="territory-conflict">
                  <p className="text-sm font-medium text-ink">{t.name}: recent approved changes</p>
                  <ul className="mt-1 text-[12px] text-ink-dim">
                    {t.changes.map((ch) => (
                      <li key={ch.id}>• Approved: {ch.description}</li>
                    ))}
                  </ul>
                  {t.conflictingClaims.map((g) => (
                    <p key={g.location} className="mt-1 text-[12px] text-orange-300" data-testid="territory-conflicting">
                      Conflicting claims over {g.location}: {g.claims.map((cl) => cl.actor?.name ?? "a party").join(" vs ")}
                    </p>
                  ))}
                </div>
              ) : null,
            )}
          </div>
        )}
      </CountrySection>

      {/* Actors */}
      <CountrySection id="actors" title="Relevant actors" secondary>
        {actorCount === 0 ? (
          <p className="text-sm text-ink-dim" data-testid="actors-none">
            No actor in the knowledge layer is linked to {c.name} or its domestic conflicts.
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2" data-testid="actors">
            <ActorGroup title="State forces" list={data.actors.stateForces} testId="actors-state" />
            <ActorGroup title="Non-state armed actors" list={data.actors.nonStateArmed} testId="actors-nonstate" />
            <ActorGroup title="International / external actors" list={data.actors.international} testId="actors-international" />
            <ActorGroup title="Other operating actors" list={data.actors.other} testId="actors-other" />
          </div>
        )}
      </CountrySection>

      <DomainBlock id="transport" title="Transport / aviation" section={data.transport} note="Airport, airspace, port and chokepoint status at a strategic level. No aircraft or vessel tracking." />
      <DomainBlock id="energy" title="Energy" section={data.energy} note="Operator-published unavailability and disruptions. No synthetic energy-risk score." />
      <DomainBlock id="internet" title="Internet" section={data.internet} note="Observed connectivity anomalies from network measurements. An observed anomaly does not establish an intentional shutdown or its cause." />
      <DomainBlock id="hazards" title="Natural hazards" section={data.hazards} note="Provider alerts (USGS, GDACS, EONET, NWS). A FIRMS thermal detection is a satellite heat signal, not a confirmed wildfire unless corroborated." />

      {/* Source coverage */}
      <CountrySection id="coverage" title="Source coverage" secondary>
        <div className="rounded-xl border border-border bg-card/50 p-4" data-testid="coverage">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("rounded-full border px-2.5 py-0.5 text-xs font-semibold", COVERAGE_TONE[data.sourceCoverage.state])} data-testid="coverage-state">
              {data.sourceCoverage.state} COVERAGE
            </span>
            <span className="text-[12px] text-ink-dim">{data.sourceCoverage.reasons.join(" ")}</span>
          </div>
          <dl className="mt-3 grid grid-cols-3 gap-2 text-center sm:grid-cols-6" data-testid="coverage-counts">
            <CoverageStat label="Dedicated" value={data.sourceCoverage.dedicated} sub={`${data.sourceCoverage.freshDedicated} fresh`} />
            <CoverageStat label="Global" value={data.sourceCoverage.global} sub={`${data.sourceCoverage.freshGlobal} fresh`} />
            <CoverageStat label="Official" value={data.sourceCoverage.official} />
            <CoverageStat label="Independent" value={data.sourceCoverage.independent} />
            <CoverageStat label="Party / aligned" value={data.sourceCoverage.partyAligned} />
            <div className="rounded-lg border border-border/60 px-1 py-1.5">
              <dd className="text-[12px] font-medium text-ink">{data.sourceCoverage.lastSuccessfulIngestion ? <RelativeTime iso={data.sourceCoverage.lastSuccessfulIngestion} /> : "never"}</dd>
              <dt className="text-[10px] uppercase tracking-wide text-ink-faint">Last ingestion</dt>
            </div>
          </dl>
          <p className="mt-2 text-[11px] text-ink-faint">The number of sources describes coverage, not truth. Party / aligned sources never count as independent confirmation.</p>
          <div className="mt-3 border-t border-border/60 pt-3">
            <PartyClaimsPanel independentReports={data.claims.independentReports} hidden={data.claims.partyClaimsHidden} claims={data.claims.partyClaims} />
          </div>
          {data.coverage.staleFeeds.length > 0 && (
            <p className="mt-2 text-[12px] text-yellow-200" data-testid="stale-feeds">
              Stale feeds: {data.coverage.staleFeeds.map((f) => f.name).join(", ")}
            </p>
          )}
          {data.coverage.gaps.length > 0 && (
            <ul className="mt-2 text-[12px] text-ink-dim" data-testid="coverage-gaps">
              {data.coverage.gaps.map((g) => (
                <li key={g.slug}>
                  • <Link href={`/conflict/${g.slug}`} className="hover:text-accent">{g.conflict}</Link>: coverage {g.health.replace(/_/g, " ")}
                  {g.reasons[0] ? ` — ${g.reasons[0]}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CountrySection>

      {/* Country brief (same engine as /brief) */}
      <CountrySection
        id="brief"
        title="Country brief"
        secondary
        aside={
          <Link href={`/brief/country/${c.code}`} className="text-xs text-accent hover:underline" data-testid="full-country-brief">
            View full country brief
          </Link>
        }
      >
        <BriefPanel scope={{ country: c.code }} initialWindow="24h" windows={["6h", "24h", "3d", "7d"]} compact allowSave={false} />
      </CountrySection>

      {/* Map: the /world map implementation, framed on the country */}
      <CountrySection id="map" title="Country map" secondary>
        <CountryMap code={c.code} name={c.name} lat={c.lat} lng={c.lng} zoom={getCountryRecord(c.code)?.zoom ?? 5} neighbourCodes={c.neighbours.map((n) => n.code)} />
      </CountrySection>

      {/* Watch */}
      <CountrySection id="watch" title="Watch and alerts" secondary>
        <div className="mb-3">
          <FollowButton entityType="country" entityKey={c.code} label={c.name} />
        </div>
        <CountryWatchPanel code={c.code} name={c.name} />
      </CountrySection>
    </main>
  );
}

function ConflictGroup({ title, rows, empty, testId }: { title: string; rows: ConflictRowView[]; empty: string; testId: string }) {
  return (
    <div className="mt-3 first:mt-0" data-testid={testId}>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
        {title} <span className="font-normal">({rows.length})</span>
      </p>
      {rows.length === 0 ? (
        <p className="text-[13px] text-ink-dim">{empty}</p>
      ) : (
        <>
        {/* Phones: one stacked row per conflict, every score labelled */}
        <ul className="divide-y divide-border/60 rounded-xl border border-border sm:hidden" data-testid={`${testId}-mobile`}>
          {rows.map((r) => (
            <li key={r.slug} className="px-3 py-2.5" data-testid="conflict-row-mobile" data-slug={r.slug}>
              <div className="flex items-baseline justify-between gap-2">
                <Link href={`/conflict/${r.slug}`} className="text-sm font-medium text-ink hover:text-accent" data-testid={title === "Domestic" ? "domestic-conflict" : undefined}>
                  {r.name}
                </Link>
                <span className={cn("text-sm font-semibold tabular-nums", SEVERITY_TEXT_CLASS[severityFromScore(r.impactScore)])}>impact {r.impactScore}</span>
              </div>
              <p className="mt-0.5 text-[11px] text-ink-faint">
                <span className="capitalize">{r.status}</span>
                {r.fullScaleWar ? " · full-scale war" : ""} · severity {r.severityScore ?? "—"} · confidence {r.confidenceScore ?? "—"} · {r.reportCount7d} reports 7d
              </p>
              <p className="mt-0.5 text-[12px] text-ink-dim">{r.impactReason}</p>
              {r.latestDevelopment && (
                <Link href={r.latestDevelopment.deepLink} className="mt-0.5 block text-[11px] text-ink-faint hover:text-ink">
                  Latest: {r.latestDevelopment.title} · <RelativeTime iso={r.latestDevelopment.occurredAt} />
                </Link>
              )}
            </li>
          ))}
        </ul>
        <div className="hidden overflow-x-auto rounded-xl border border-border sm:block">
          <table className="w-full min-w-[640px] text-left text-[12px]">
            <thead className="bg-card/60 text-[10px] uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="px-3 py-1.5 font-medium">Conflict</th>
                <th className="px-2 py-1.5 font-medium">Status</th>
                <th className="px-2 py-1.5 text-right font-medium">Severity</th>
                <th className="px-2 py-1.5 text-right font-medium">Impact</th>
                <th className="px-2 py-1.5 text-right font-medium">Confidence</th>
                <th className="px-2 py-1.5 text-right font-medium">Reports 7d</th>
                <th className="px-3 py-1.5 font-medium">Why / latest</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {rows.map((r) => (
                <tr key={r.slug} data-testid="conflict-row" data-slug={r.slug} data-impact={r.impactScore}>
                  <td className="px-3 py-2 align-top">
                    <Link href={`/conflict/${r.slug}`} className="font-medium text-ink hover:text-accent" data-testid={title === "Domestic" ? "domestic-conflict" : undefined}>
                      {r.name}
                    </Link>
                    {r.fullScaleWar && <span className="ml-1.5 text-[10px] uppercase text-orange-300">full-scale war</span>}
                  </td>
                  <td className="px-2 py-2 align-top capitalize text-ink-dim">{r.status}</td>
                  <td className="px-2 py-2 text-right align-top tabular-nums text-ink" title={r.severityLabel}>
                    {r.severityScore ?? "—"}
                  </td>
                  <td className={cn("px-2 py-2 text-right align-top font-semibold tabular-nums", SEVERITY_TEXT_CLASS[severityFromScore(r.impactScore)])} data-testid="conflict-impact">
                    {r.impactScore}
                  </td>
                  <td className="px-2 py-2 text-right align-top tabular-nums text-ink-dim">{r.confidenceScore ?? "—"}</td>
                  <td className="px-2 py-2 text-right align-top tabular-nums text-ink-dim" data-testid="conflict-reports">
                    {r.reportCount7d}
                  </td>
                  <td className="px-3 py-2 align-top text-ink-dim">
                    <span className="block">{r.impactReason}</span>
                    {r.latestDevelopment && (
                      <Link href={r.latestDevelopment.deepLink} className="mt-0.5 block text-[11px] text-ink-faint hover:text-ink">
                        Latest: {r.latestDevelopment.title} · <RelativeTime iso={r.latestDevelopment.occurredAt} />
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
    </div>
  );
}

function DomainBlock({ id, title, section, note }: { id: string; title: string; section: DomainSection; note: string }) {
  const cov = section.coverage;
  return (
    <CountrySection id={id} title={title} secondary aside={<span className={cn("text-[11px]", cov.state === "covered" ? "text-ink-faint" : "text-yellow-200")} data-testid={`${id}-coverage`} data-state={cov.state}>{cov.state === "covered" ? "monitored" : cov.state === "stale" ? "provider data stale" : "insufficient current data"}</span>}>
      <p className="mb-2 text-[11px] text-ink-faint">{note}</p>
      {section.items.length > 0 ? (
        <DomainList items={section.items} testId={`${id}-list`} />
      ) : (
        <p className="text-[13px] text-ink-dim" data-testid={`${id}-empty`}>
          {cov.state === "covered" ? "No significant disruption recorded in the last 7 days." : cov.note}
        </p>
      )}
      {section.items.length > 0 && cov.state !== "covered" && <p className="mt-2 text-[11px] text-yellow-200">{cov.note}</p>}
    </CountrySection>
  );
}

function DomainList({ items, testId }: { items: DevelopmentItem[]; testId: string }) {
  return (
    <ul className="divide-y divide-border/60 rounded-xl border border-border bg-card/50" data-testid={testId}>
      {items.map((d) => (
        <li key={d.id} className="px-3.5 py-2" data-testid="domain-item">
          <p className="text-[11px] text-ink-faint">
            <RelativeTime iso={d.occurredAt} /> · {d.category} · confidence {d.confidenceLabel}
            {d.sources[0] ? ` · ${d.sources[0].name}` : ""}
          </p>
          <Link href={d.deepLink} className="text-[13px] font-medium text-ink hover:text-accent">
            {d.title}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ActorGroup({ title, list, testId }: { title: string; list: ActorView[]; testId: string }) {
  if (list.length === 0) return null;
  return (
    <div data-testid={testId}>
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-faint">{title}</p>
      <ul className="divide-y divide-border/60 rounded-xl border border-border bg-card/50">
        {list.map((a) => (
          <li key={a.id} className="px-3 py-2" data-testid="actor-row">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <Link href={a.href} className="text-[13px] font-medium text-ink hover:text-accent">
                {a.name}
              </Link>
              {a.typeLabel && <span className="text-[11px] text-ink-faint">{a.typeLabel}</span>}
              {a.country && <span className="text-[11px] text-ink-faint">{a.country}</span>}
            </div>
            <p className="mt-0.5 text-[11px] text-ink-faint">
              {a.relationships.length > 0 ? `${a.relationships.join("; ")} · ` : a.conflicts.length > 0 ? `Linked to ${a.conflicts.join(", ")} · ` : ""}
              {a.recentEvents30d > 0 ? `${a.recentEvents30d} sourced event${a.recentEvents30d === 1 ? "" : "s"} in 30 days` : "no sourced event in 30 days"}
              {a.lastObservedAt ? <> · last observed <RelativeTime iso={a.lastObservedAt} /></> : ""}
            </p>
            {(a.provenance || a.confidence != null) && (
              <p className="text-[10px] text-ink-faint">
                {a.provenance ? `Source: ${a.provenance}` : ""}
                {a.confidence != null ? `${a.provenance ? " · " : ""}link confidence ${Math.round(a.confidence * 100)}%` : ""}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Stat({ label, value, testId }: { label: string; value: number; testId: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface/50 px-1.5 py-1.5" data-testid={testId}>
      <p className="text-lg font-semibold tabular-nums text-ink">{value}</p>
      <p className="text-[10px] uppercase leading-tight tracking-wide text-ink-faint">{label}</p>
    </div>
  );
}

function CoverageStat({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="rounded-lg border border-border/60 px-1 py-1.5">
      <dd className="text-lg font-semibold tabular-nums text-ink">{value}</dd>
      <dt className="text-[10px] uppercase tracking-wide text-ink-faint">{label}</dt>
      {sub && <p className="text-[10px] text-ink-faint">{sub}</p>}
    </div>
  );
}

