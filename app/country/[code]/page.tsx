import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { FollowButton } from "@/components/watch/follow-button";
import { SetBaseCountryButton } from "@/components/home/set-base-country-button";
import { ExposureCategoryCard } from "@/components/impact/exposure-category-card";
import { DevelopmentCard } from "@/components/brief/development-card";
import { BriefPanel } from "@/components/brief/brief-view";
import { CountryMap, CountryWatchPanel, FreshnessChip, PartyClaimsPanel } from "@/components/country/country-client";
import { RelativeTime } from "@/components/ui/relative-time";
import { getCountryIntelligence, type ActorView, type CountryIntelligence } from "@/lib/countries/intelligence";
import { getCountryRecord, resolveCountry } from "@/lib/countries/registry";
import { SEVERITY_TEXT_CLASS, severityFromScore } from "@/lib/utils/severity";
import type { ExposureDimension } from "@/lib/types";
import { formatSigned, cn } from "@/lib/utils";

// The country intelligence page: "What is happening in and around this country right now?" Everything comes
// from ONE server-side aggregation (lib/countries/intelligence.ts) over the existing conflict, impact,
// briefing, hazard, infrastructure, actor and source systems. Sections without data are not rendered.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const c = resolveCountry((await params).code);
  return { title: c ? `${c.name} — Vigil` : "Country — Vigil" };
}

function Section({ id, title, children, aside, collapsed = false }: { id: string; title: string; children: React.ReactNode; aside?: React.ReactNode; collapsed?: boolean }) {
  // Long intelligence sections collapse (native <details>): open by default for the primary ones.
  return (
    <details className="group mt-8" open={!collapsed} data-testid={`section-${id}`}>
      <summary className="flex cursor-pointer list-none items-baseline justify-between gap-3 [&::-webkit-details-marker]:hidden">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-faint">
          {title}
          <span className="ml-2 text-ink-faint/60 group-open:hidden" aria-hidden>
            ＋
          </span>
        </h2>
        {aside}
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

function ActorGroup({ title, list, testId }: { title: string; list: ActorView[]; testId: string }) {
  if (list.length === 0) return null;
  return (
    <div data-testid={testId}>
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-faint">{title}</p>
      <ul className="space-y-1.5">
        {list.map((a) => (
          <li key={a.id} className="rounded-xl border border-border bg-card/60 px-3.5 py-2.5" data-testid="actor-row">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <Link href={a.href} className="text-sm font-medium text-ink hover:text-accent">
                {a.name}
              </Link>
              {a.typeLabel && <span className="text-[11px] text-ink-faint">{a.typeLabel}</span>}
              {a.country && <span className="text-[11px] text-ink-faint">{a.country}</span>}
            </div>
            <p className="mt-0.5 text-[11px] text-ink-faint">
              {a.conflicts.length > 0 ? `${a.conflicts.join(", ")} · ` : ""}
              {a.recentEvents30d > 0 ? `${a.recentEvents30d} sourced event${a.recentEvents30d === 1 ? "" : "s"} in 30 days` : "no sourced event in 30 days"}
              {a.lastObservedAt ? <> · last observed <RelativeTime iso={a.lastObservedAt} /></> : ""}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DevList({ items, testId }: { items: CountryIntelligence["developments"]; testId: string }) {
  return (
    <div className="space-y-2" data-testid={testId}>
      {items.map((d) => (
        <DevelopmentCard key={d.id} d={d} />
      ))}
    </div>
  );
}

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
  const infraCount = data.sections.aviation.length + data.sections.maritime.length + data.sections.energy.length + data.sections.internet.length;
  const anyContext = data.territory.available;

  return (
    <main className="mx-auto max-w-[1000px] px-4 pb-28 pt-24 sm:px-6 sm:pt-32" data-testid="country-page" data-country={c.code}>
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-4xl" aria-hidden>
            {c.flag}
          </span>
          <div>
            <h1 className="text-2xl font-semibold text-ink sm:text-[30px]" data-testid="country-name">
              {c.name}
            </h1>
            <p className="text-sm text-ink-faint" data-testid="country-identity">
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
          <FollowButton entityType="country" entityKey={c.code} label={c.name} />
          <SetBaseCountryButton code={c.code} />
        </div>
      </div>

      {/* Overview: what is happening, how serious, what changed, why, how current */}
      <section className="mt-6 rounded-2xl border border-border bg-card/70 p-5 sm:p-6" data-testid="country-overview">
        <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-ink-faint">Global Exposure</p>
            <p className="mt-1 flex items-baseline gap-2">
              <span className={cn("text-5xl font-semibold tabular-nums", SEVERITY_TEXT_CLASS[severity])} data-testid="overview-exposure">
                {overview.exposureScore}
              </span>
              <span className="text-sm text-ink-dim">/ 100</span>
              <span className={cn("text-sm font-semibold", SEVERITY_TEXT_CLASS[severity])}>{overview.exposureLabel}</span>
            </p>
            <p className="text-[11px] text-ink-faint">{formatSigned(exposure.change24h)} today · not a political-risk score</p>
          </div>
          <div className="grid flex-1 grid-cols-3 gap-3 text-center sm:max-w-md">
            <Stat label="Domestic conflicts" value={overview.activeDomesticConflicts} testId="stat-domestic" />
            <Stat label="High-impact nearby" value={overview.highImpactNearbyConflicts} testId="stat-nearby" />
            <Stat label="Significant disruptions" value={overview.significantDisruptions} testId="stat-disruptions" />
          </div>
        </div>
        <p className="mt-4 text-sm font-medium text-ink" data-testid="overview-status">
          {overview.statusLine}
        </p>
        {exposure.reasoning[0] && (
          <p className="mt-1 text-[12px] text-ink-dim" data-testid="overview-why">
            Why: {exposure.reasoning[0].conflictName} — impact {exposure.reasoning[0].impact}
            {exposure.reasoning[0].reasons[0] ? ` (${exposure.reasoning[0].reasons[0]})` : ""}
          </p>
        )}
        {overview.latestDevelopment && (
          <p className="mt-2 text-[12px] text-ink-dim" data-testid="overview-latest">
            Latest material development: <Link href={overview.latestDevelopment.deepLink} className="text-ink hover:text-accent">{overview.latestDevelopment.title}</Link> · <RelativeTime iso={overview.latestDevelopment.occurredAt} />
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-1.5" data-testid="freshness">
          {data.freshness.map((f) => (
            <FreshnessChip key={f.key} keyName={f.key} label={f.label} at={f.at} stale={f.stale} />
          ))}
        </div>
      </section>

      {/* Brief (same engine as /brief) */}
      <Section
        id="brief"
        title="Brief"
        aside={
          <Link href={`/brief/country/${c.code}`} className="text-xs text-accent hover:underline" data-testid="full-country-brief">
            View full country brief
          </Link>
        }
      >
        <BriefPanel scope={{ country: c.code }} initialWindow="6h" windows={["1h", "6h", "12h", "24h", "3d", "7d"]} compact allowSave={false} />
      </Section>

      {/* Latest developments */}
      {data.developments.length > 0 && (
        <Section id="developments" title="Latest developments" aside={<span className="text-[11px] text-ink-faint">ranked by significance, impact on {c.name}, recency and confidence</span>}>
          <DevList items={data.developments} testId="developments-list" />
        </Section>
      )}

      {/* Conflict exposure and reasoning */}
      <Section id="exposure" title="Conflict exposure">
        <div className="rounded-2xl border border-border bg-card/70 p-5">
          <p className="text-sm text-ink" data-testid="exposure-headline">
            Overall exposure {exposure.score}
            {exposure.leadConflict ? ` — led by ${exposure.leadConflict}` : " — no monitored conflict currently affects this country"}
          </p>
          <ul className="mt-3 space-y-2" data-testid="exposure-reasons">
            {exposure.reasoning.map((r) => (
              <li key={r.conflictSlug} className="text-sm" data-testid="exposure-reason" data-impact={r.impact}>
                <Link href={`/conflict/${r.conflictSlug}`} className="font-medium text-ink hover:text-accent">
                  {r.conflictName}: {r.impact}
                </Link>
                <span className="ml-2 text-[12px] text-ink-dim">{r.reasons.join(" · ")}</span>
                {r.distanceKm != null && <span className="ml-2 text-[11px] text-ink-faint">~{r.distanceKm.toLocaleString("en-US")} km</span>}
              </li>
            ))}
            {exposure.reasoning.length === 0 && <li className="text-sm text-ink-dim">No monitored conflict has a non-zero impact score for this country.</li>}
          </ul>
          <p className="mt-3 text-[11px] text-ink-faint">{exposure.note}</p>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" data-testid="exposure-dimensions">
          {exposure.dimensions.map((d) => (
            <div key={d.dimension} title={d.explanation}>
              <ExposureCategoryCard dimension={d.dimension as ExposureDimension} value={d.value ?? 0} change24h={0} basis={d.basis} topConflictName={exposure.leadConflict ?? undefined} />
            </div>
          ))}
        </div>
      </Section>

      {/* Domestic conflicts */}
      {data.domesticConflicts.length > 0 && (
        <Section id="domestic" title={`Active conflicts in ${c.name}`}>
          <div className="space-y-2" data-testid="domestic-conflicts">
            {data.domesticConflicts.map((d) => (
              <Link key={d.slug} href={`/conflict/${d.slug}`} className="block rounded-xl border border-border bg-card/60 px-4 py-3 hover:border-border-strong" data-testid="domestic-conflict">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="text-sm font-medium text-ink">{d.name}</span>
                  <span className="text-[11px] uppercase tracking-wide text-ink-faint">
                    {d.status} · {d.severityLabel}
                    {d.fullScaleWar ? " · full-scale war" : ""}
                  </span>
                </div>
                <p className="mt-1 text-[12px] text-ink-dim">
                  {d.latestDevelopment ? <>Latest: {d.latestDevelopment.title} (<RelativeTime iso={d.latestDevelopment.occurredAt} />)</> : "No material development in the last 7 days"}
                </p>
                <p className="mt-0.5 text-[11px] text-ink-faint">
                  {d.confidence != null ? `Confidence ${d.confidence}` : "Confidence n/a"} · {d.territorialData ? "territorial data available" : "no territorial data"} · last event {d.lastEventAt ? <RelativeTime iso={d.lastEventAt} /> : "none recorded"} · sources {d.sourceHealth ?? "unknown"}
                  {d.latestSourceAt ? <> (<RelativeTime iso={d.latestSourceAt} />)</> : ""}
                </p>
              </Link>
            ))}
          </div>
        </Section>
      )}

      {/* Nearby / high-impact conflicts */}
      {data.nearbyConflicts.length > 0 && (
        <Section id="nearby" title="Nearby and high-impact conflicts">
          <div className="space-y-2" data-testid="nearby-conflicts">
            {data.nearbyConflicts.map((n) => (
              <Link key={n.conflictSlug} href={`/conflict/${n.conflictSlug}`} className="block rounded-xl border border-border bg-card/60 px-4 py-3 hover:border-border-strong" data-testid="nearby-conflict" data-impact={n.impact}>
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="text-sm font-medium text-ink">{n.conflictName}</span>
                  <span className="text-[11px] uppercase tracking-wide text-ink-faint">
                    impact {n.impact} · {n.status} · {n.severityLabel}
                  </span>
                </div>
                <ul className="mt-1 text-[12px] text-ink-dim">
                  {[...n.why, ...n.reasons.filter((r) => !n.why.includes(r))].slice(0, 5).map((w) => (
                    <li key={w}>• {w}</li>
                  ))}
                </ul>
              </Link>
            ))}
          </div>
        </Section>
      )}

      {/* Territorial / security context */}
      {anyContext && (
        <Section id="territory" title="Territorial and security context" collapsed>
          <p className="mb-3 text-[11px] text-ink-faint">De facto / reported territorial control. This says nothing about legal sovereignty.</p>
          <div className="space-y-4" data-testid="territory-context">
            {data.territory.conflicts.map((t) => (
              <div key={t.slug} className="rounded-xl border border-border bg-card/60 px-4 py-3" data-testid="territory-conflict">
                <p className="text-sm font-medium text-ink">
                  <Link href={`/conflict/${t.slug}`} className="hover:text-accent">
                    {t.name}
                  </Link>
                </p>
                <p className="mt-1 text-[12px] text-ink-dim">
                  {t.summary.areas > 0 ? `${t.summary.areas} area${t.summary.areas === 1 ? "" : "s"} of recorded control` : "No published territorial-control polygons"}
                  {t.summary.actors.length > 0 ? ` — ${t.summary.actors.slice(0, 4).map((a) => `${a.name} (${a.areas})`).join(", ")}` : ""}
                  {t.summary.statuses.contested ? ` · ${t.summary.statuses.contested} contested` : ""}
                </p>
                {t.changes.length > 0 && (
                  <ul className="mt-1 text-[12px] text-ink-dim">
                    {t.changes.map((ch) => (
                      <li key={ch.id}>• Approved: {ch.description}</li>
                    ))}
                  </ul>
                )}
                {t.conflictingClaims.map((g) => (
                  <p key={g.location} className="mt-1 text-[12px] text-orange-300" data-testid="territory-conflicting">
                    Conflicting claims over {g.location}: {g.claims.map((cl) => cl.actor?.name ?? "a party").join(" vs ")}
                  </p>
                ))}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Actors */}
      {(data.actors.stateForces.length + data.actors.nonStateArmed.length + data.actors.international.length + data.actors.other.length > 0) && (
        <Section id="actors" title="Actors" collapsed>
          <div className="space-y-4" data-testid="actors">
            <ActorGroup title="State forces" list={data.actors.stateForces} testId="actors-state" />
            <ActorGroup title="Non-state armed actors" list={data.actors.nonStateArmed} testId="actors-nonstate" />
            <ActorGroup title="International / external actors" list={data.actors.international} testId="actors-international" />
            <ActorGroup title="Other operating actors" list={data.actors.other} testId="actors-other" />
          </div>
        </Section>
      )}

      {/* Infrastructure and transport, only where there is something to say */}
      {(data.sections.aviation.length > 0 || data.sections.maritime.length > 0) && (
        <Section id="transport" title="Aviation and transport">
          {data.sections.aviation.length > 0 && (
            <div data-testid="section-aviation">
              <p className="mb-1.5 text-xs text-ink-dim">{data.sections.aviation.filter((d) => !d.isResolution).length} significant aviation disruption{data.sections.aviation.filter((d) => !d.isResolution).length === 1 ? "" : "s"}</p>
              <DevList items={data.sections.aviation} testId="aviation-list" />
            </div>
          )}
          {data.sections.maritime.length > 0 && (
            <div className="mt-4" data-testid="section-maritime">
              <p className="mb-1.5 text-xs text-ink-dim">Maritime</p>
              <DevList items={data.sections.maritime} testId="maritime-list" />
            </div>
          )}
        </Section>
      )}
      {data.sections.energy.length > 0 && (
        <Section id="energy" title="Energy">
          <DevList items={data.sections.energy} testId="energy-list" />
        </Section>
      )}
      {data.sections.internet.length > 0 && (
        <Section id="internet" title="Internet">
          <p className="mb-2 text-[11px] text-ink-faint">Observed connectivity anomalies from network measurements. A measurement does not establish an intentional shutdown or its cause.</p>
          <DevList items={data.sections.internet} testId="internet-list" />
        </Section>
      )}
      {data.sections.hazards.length > 0 && (
        <Section id="hazards" title="Natural hazards">
          <DevList items={data.sections.hazards} testId="hazards-list" />
        </Section>
      )}
      {infraCount + data.sections.hazards.length === 0 && (
        <p className="mt-8 text-xs text-ink-faint" data-testid="no-infrastructure-events">
          No significant aviation, maritime, energy, internet or natural-hazard events recorded for {c.name} in the last 7 days.
        </p>
      )}

      {/* Sources, claims and coverage */}
      <Section id="coverage" title="Source coverage" collapsed>
        <div className="rounded-2xl border border-border bg-card/70 p-5" data-testid="coverage">
          <PartyClaimsPanel independentReports={data.claims.independentReports} hidden={data.claims.partyClaimsHidden} claims={data.claims.partyClaims} />
          <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
            <div data-testid="coverage-strong">
              <p className="text-2xl font-semibold text-ink">{data.coverage.byTrust.strong}</p>
              <p className="text-[11px] text-ink-faint">Independent / Strong Verification</p>
            </div>
            <div data-testid="coverage-perspective">
              <p className="text-2xl font-semibold text-ink">{data.coverage.byTrust.perspective}</p>
              <p className="text-[11px] text-ink-faint">Independent / Perspective</p>
            </div>
            <div data-testid="coverage-party">
              <p className="text-2xl font-semibold text-ink">{data.coverage.byTrust.party_claim}</p>
              <p className="text-[11px] text-ink-faint">Party / Aligned</p>
            </div>
          </div>
          <p className="mt-3 text-[12px] text-ink-dim">
            {data.coverage.sourcesCovering} source{data.coverage.sourcesCovering === 1 ? "" : "s"} covering {c.name} · {data.coverage.specialistLocalSources} specialist / local · last fetch {data.coverage.lastFetchAt ? <RelativeTime iso={data.coverage.lastFetchAt} /> : "none recorded"}
          </p>
          {data.coverage.staleFeeds.length > 0 && (
            <p className="mt-1 text-[12px] text-yellow-200" data-testid="stale-feeds">
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
      </Section>

      {/* Map */}
      <Section id="map" title="Map">
        <CountryMap code={c.code} name={c.name} lat={c.lat} lng={c.lng} zoom={getCountryRecord(c.code)?.zoom ?? 5} neighbourCodes={c.neighbours.map((n) => n.code)} />
      </Section>

      {/* Watch / alerts */}
      <Section id="watch" title="Watch and alerts">
        <div className="rounded-2xl border border-border bg-card/70 p-5">
          <div className="mb-3">
            <FollowButton entityType="country" entityKey={c.code} label={c.name} />
          </div>
          <CountryWatchPanel code={c.code} name={c.name} />
        </div>
      </Section>
    </main>
  );
}

function Stat({ label, value, testId }: { label: string; value: number; testId: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface/50 px-2 py-2" data-testid={testId}>
      <p className="text-xl font-semibold tabular-nums text-ink">{value}</p>
      <p className="text-[10px] uppercase leading-tight tracking-wide text-ink-faint">{label}</p>
    </div>
  );
}
