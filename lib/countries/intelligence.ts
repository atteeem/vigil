import { prisma } from "@/lib/db/client";
import { getBrief } from "@/lib/brief/brief";
import type { BriefDevelopment } from "@/lib/brief/types";
import { computeCountryExposure, computeImpact, DIMENSION_LABEL } from "@/lib/data/impact";
import { getCoverageRow } from "@/lib/db/repositories/coverage";
import { scoreConflict } from "@/lib/db/repositories/scoring";
import { listConflictingClaims, type ConflictingClaims } from "@/lib/public/claims";
import { listPublicConflicts } from "@/lib/public/conflicts";
import { entityHref } from "@/lib/public/entities";
import { getPublicTerritorySummary, listPublicTerritorialChanges, type PublicTerritorialChange, type PublicTerritorySummary } from "@/lib/public/territory";
import { STALE_SOURCE_HOURS } from "@/lib/public/stale";
import { severityFromScore, SEVERITY_LABEL } from "@/lib/utils/severity";
import { ENTITY_TYPE_LABEL, isEntityType } from "@/lib/military/entity-types";
import { sourceTrust, type TrustCategory } from "@/lib/sources/trust";
import { distanceKm } from "@/lib/utils/geo";
import { getCountryByCode } from "@/lib/reference/countries";
import { getCountryRecord, neighboursOf, type CountryRecord } from "./registry";
import type { Conflict } from "@/lib/types";
import { conflictReportCounts } from "@/lib/public/report-counts";
import { listAvailableDatasets } from "@/lib/territory/datasets";
import { DATASET_TYPE_LABEL, type PublicTerritorialDataset } from "@/lib/territory/dataset-types";
import { coverageVerdict, type CoverageVerdict } from "@/lib/sources/coverage-verdict";
import { ALL_DOMAIN_PLATFORMS, domainCoverage, type CoverageDomain, type DomainCoverage } from "./data-coverage";

// The country intelligence layer: ONE server-side aggregation over the existing systems (public
// conflicts + central impact scoring, the briefing engine, structured events, territorial control,
// the actor knowledge layer, source coverage). It computes nothing of its own beyond arranging what
// those systems already produce, and it is shaped per-section so the same data can later feed a
// country comparison (see `getCountrySummary`).

const HOUR = 3_600_000;
export const NEARBY_IMPACT_MIN = 40;

export interface CountryIdentity {
  code: string;
  alpha3: string;
  name: string;
  aliases: string[];
  region: string;
  subregion: string;
  capital: string;
  flag: string;
  lat: number;
  lng: number;
  landlocked: boolean;
  neighbours: { code: string; name: string }[];
}

export const identityOf = (c: CountryRecord): CountryIdentity => ({ code: c.code, alpha3: c.alpha3, name: c.name, aliases: c.aliases, region: c.region, subregion: c.subregion, capital: c.capital, flag: c.flag, lat: c.lat, lng: c.lng, landlocked: c.landlocked, neighbours: neighboursOf(c.code).map((n) => ({ code: n.code, name: n.name })) });

export interface ExposureReason {
  conflictSlug: string;
  conflictName: string;
  impact: number;
  hardFloor: "own_country_war" | "bordering_war" | null;
  /** Human reasons straight from the scoring engine plus geography facts. */
  reasons: string[];
  distanceKm: number | null;
}

export interface ExposureDimensionView {
  dimension: string;
  label: string;
  value: number | null;
  basis: "computed" | "estimated" | "insufficient";
  explanation: string;
}

export interface DomesticConflictView {
  slug: string;
  name: string;
  status: string;
  severity: string;
  severityLabel: string;
  confidence: number | null;
  fullScaleWar: boolean;
  lastEventAt: string | null;
  territorialData: boolean;
  latestDevelopment: { title: string; occurredAt: string } | null;
  sourceHealth: string | null;
  latestSourceAt: string | null;
}

export interface NearbyConflictView extends ExposureReason {
  status: string;
  severityLabel: string;
  why: string[];
}

export interface ActorView {
  id: string;
  name: string;
  href: string;
  typeLabel: string | null;
  country: string | null;
  conflicts: string[];
  recentEvents30d: number;
  lastObservedAt: string | null;
  /** Recorded relationships only (ConflictParticipant role, primary conflict), never inferred. */
  relationships: string[];
  /** Provenance of the actor record / its conflict link. */
  provenance: string | null;
  confidence: number | null;
}

export interface CoverageView {
  sourcesCovering: number;
  byTrust: Record<"strong" | "perspective" | "party_claim" | "other", number>;
  lastFetchAt: string | null;
  specialistLocalSources: number;
  staleFeeds: { name: string; lastSuccessfulIngestion: string | null }[];
  gaps: { conflict: string; slug: string; health: string; reasons: string[] }[];
}

export interface FreshnessItem {
  key: string;
  label: string;
  at: string | null;
  /** hours since `at`; null when unknown */
  ageHours: number | null;
  stale: boolean;
}

/** One conflict row in Conflict Exposure. Severity, impact and confidence are separate scores; report volume feeds none of them. */
export interface ConflictRowView {
  slug: string;
  name: string;
  status: string;
  fullScaleWar: boolean;
  fightingCountries: string[];
  /** Conflict severity (0-100) from the central scoring engine; independent of this country. */
  severityScore: number | null;
  severityLabel: string;
  /** Impact on THIS country (0-100) from the central impact model. */
  impactScore: number;
  /** Evidence confidence (0-100) of the conflict's records. */
  confidenceScore: number | null;
  impactReason: string;
  latestDevelopment: { title: string; occurredAt: string; deepLink: string } | null;
  /** Unique published reports in the last 7 days (canonical aggregate, /api/report-counts). Never feeds a score. */
  reportCount7d: number;
}

export interface ExposureDriver {
  text: string;
  /** score: an input of the impact score. context: a current, recorded condition that does not change the score. */
  kind: "score" | "context";
  conflictSlug?: string;
}

export interface DevelopmentItem {
  id: string;
  occurredAt: string;
  title: string;
  category: string;
  domain: string;
  locationScope: string;
  confidence: number;
  confidenceLabel: string;
  sources: { name: string; role: string }[];
  independentSources: number;
  reportCount: number | null;
  isPartyClaim: boolean;
  deepLink: string;
  mapHref: string | null;
  conflictName: string | null;
}

export interface TerritoryDatasetView {
  id: string;
  name: string;
  datasetType: string;
  typeLabel: string;
  kind: string;
  provider: string;
  license: string | null;
  attribution: string | null;
  sourceUrl: string | null;
  lastUpdated: string | null;
  confidence: number | null;
  actors: string[];
  areaCount: number;
  hasHistory: boolean;
  conflictName: string | null;
  openOnMap: string;
}

export interface DomainSection {
  coverage: DomainCoverage;
  items: DevelopmentItem[];
}

export type SourceCoverageView = CoverageVerdict;

export interface CountryIntelligence {
  country: CountryIdentity;
  generatedAt: string;
  overview: {
    exposureScore: number;
    exposureLabel: string;
    activeDomesticConflicts: number;
    highImpactNearbyConflicts: number;
    significantDisruptions: number;
    latestDevelopment: { title: string; occurredAt: string; type: string; deepLink: string } | null;
    /** One-line factual status. */
    statusLine: string;
  };
  exposure: { score: number; change24h: number; leadConflict: string | null; reasoning: ExposureReason[]; dimensions: ExposureDimensionView[]; note: string };
  domesticConflicts: DomesticConflictView[];
  nearbyConflicts: NearbyConflictView[];
  developments: BriefDevelopment[];
  sections: { aviation: BriefDevelopment[]; maritime: BriefDevelopment[]; energy: BriefDevelopment[]; internet: BriefDevelopment[]; hazards: BriefDevelopment[] };
  territory: { available: boolean; conflicts: { slug: string; name: string; summary: PublicTerritorySummary; changes: PublicTerritorialChange[]; conflictingClaims: ConflictingClaims[] }[] };
  actors: { stateForces: ActorView[]; nonStateArmed: ActorView[]; international: ActorView[]; other: ActorView[] };
  claims: { independentReports: number; partyClaimsHidden: number; partyClaims: BriefDevelopment[] };
  coverage: CoverageView;
  freshness: FreshnessItem[];
  brief: { window: string; headline: string; counts: Record<string, number> };
  watch: { entityType: "country"; entityKey: string; label: string };
  meta: { computeMs: number; conflictsScored: number };
  // ---- v1 country intelligence sections ----
  exposureDrivers: ExposureDriver[];
  currentSituation: string[];
  lastMeaningfulUpdate: string | null;
  borderingConflicts: ConflictRowView[];
  otherRelevantConflicts: ConflictRowView[];
  /** Domestic conflicts in the same row shape as bordering / other (domesticConflicts keeps its older detail view). */
  domesticConflictRows: ConflictRowView[];
  /** Last 7 days, newest first, party claims included but flagged (the client hides them unless the user opted in). */
  developmentFeed: DevelopmentItem[];
  territoryDatasets: TerritoryDatasetView[];
  transport: DomainSection;
  energy: DomainSection;
  internet: DomainSection;
  hazards: DomainSection;
  sourceCoverage: SourceCoverageView;
  mapHref: string;
}

const AVIATION = new Set(["airport", "airspace"]);
const MARITIME = new Set(["port", "chokepoint", "maritime"]);
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const ageOf = (at: string | null, now: Date) => (at ? Math.max(0, (now.getTime() - new Date(at).getTime()) / HOUR) : null);

/** Layers -> the structured providers that feed them (freshness is the provider's last successful fetch). */
const LAYER_PROVIDERS: { key: string; label: string; platforms: string[]; staleHours: number }[] = [
  { key: "aviation", label: "Aviation status", platforms: ["faa_nas_status", "faa_notam"], staleHours: 6 },
  { key: "maritime", label: "Maritime monitoring", platforms: ["portwatch_chokepoints", "portwatch_disruptions", "nga_warnings"], staleHours: 48 },
  { key: "energy", label: "Energy data", platforms: ["elexon_remit", "entsog_umm"], staleHours: 6 },
  { key: "internet", label: "Internet monitoring", platforms: ["ioda", "cloudflare_radar"], staleHours: 3 },
  { key: "hazards", label: "Natural hazard feeds", platforms: ["usgs_earthquakes", "usgs_volcanoes", "nws_alerts", "gdacs", "eonet_wildfires", "eonet_volcanoes"], staleHours: 3 },
];

function hardFloorText(f: ExposureReason["hardFloor"]): string | null {
  return f === "own_country_war" ? "Active full-scale war inside the country (hard rule: 100)" : f === "bordering_war" ? "Active full-scale war in a bordering country (hard rule: at least 75)" : null;
}

function reasonFor(country: CountryRecord, conflict: Conflict): ExposureReason {
  const impact = computeImpact(getCountryByCode(country.code)!, conflict);
  const d = conflict.locationKnown === false ? null : Math.round(distanceKm({ lat: country.lat, lng: country.lng }, conflict));
  const reasons = [hardFloorText(impact.hardFloor), ...impact.overallDrivers.flatMap((o) => o.description.split("; "))].filter((r): r is string => !!r);
  return { conflictSlug: conflict.slug, conflictName: conflict.shortName, impact: impact.score, hardFloor: impact.hardFloor, reasons: [...new Set(reasons)], distanceKm: d };
}

function whyNearby(country: CountryRecord, conflict: Conflict, r: ExposureReason): string[] {
  const why: string[] = [];
  if (r.hardFloor === "bordering_war") why.push("Direct-border active war");
  else if (conflict.fightingCountryCodes.some((c) => country.borders.includes(c))) why.push("The fighting is in a directly bordering country");
  if (r.distanceKm != null) why.push(`About ${r.distanceKm.toLocaleString("en-US")} km from ${country.name}`);
  if (conflict.region === country.region) why.push(`Same region (${country.region})`);
  const effects = conflict.primaryEffects.filter((e) => ["Energy", "Trade", "Finance", "Food & Supply"].includes(e));
  if (effects.length) why.push(`Tagged as affecting: ${effects.join(", ").toLowerCase()}`);
  const involved = conflict.participantCountryCodes.includes(country.code);
  if (involved) why.push(`${country.name} is recorded as a participant (participation alone sets no floor)`);
  return why;
}

export async function getCountryIntelligence(code: string, now: Date = new Date()): Promise<CountryIntelligence | null> {
  const started = Date.now();
  const rec = getCountryRecord(code);
  if (!rec) return null;
  const refCountry = getCountryByCode(rec.code)!;

  const [conflicts, brief7, briefClaims, brief6] = await Promise.all([
    listPublicConflicts(),
    getBrief({ country: rec.code, window: "7d" }, now),
    getBrief({ country: rec.code, window: "7d", includePartyClaims: true }, now),
    getBrief({ country: rec.code, window: "6h" }, now),
  ]);
  const live = conflicts.filter((c) => c.status !== "ended" && c.status !== "resolved");

  // ---- exposure (central impact system; nothing recomputed here) ----
  const exposure = computeCountryExposure(refCountry, live);
  const perConflict = live.map((c) => ({ c, r: reasonFor(rec, c) })).sort((a, b) => b.r.impact - a.r.impact);
  const domestic = live.filter((c) => c.fightingCountryCodes.includes(rec.code));
  const domesticIds = new Set(domestic.map((c) => c.id));
  const nearby = perConflict.filter(({ c, r }) => !domesticIds.has(c.id) && r.impact >= NEARBY_IMPACT_MIN).slice(0, 6);
  const dims: ExposureDimensionView[] = exposure.components.map((d) => ({
    dimension: d.dimension,
    label: DIMENSION_LABEL[d.dimension],
    value: d.basis === "insufficient" ? null : d.value,
    basis: d.basis,
    explanation: d.basis === "computed" ? "Computed from geography (own-country and border rules), severity, proximity and region for each monitored conflict." : d.basis === "estimated" ? "Estimated from the conflicts' tagged effects, proximity and intensity. There is no supply-chain or market data behind it." : "Insufficient data: no monitored conflict is tagged as affecting this dimension, so no number is shown.",
  }));
  const exposureReasoning = perConflict.filter(({ r }) => r.impact > 0).slice(0, 5).map(({ r }) => r);

  // ---- domestic conflicts ----
  const domesticViews: DomesticConflictView[] = await Promise.all(
    domestic.map(async (c) => {
      const [scores, cov, terr] = await Promise.all([scoreConflict(c.id), getCoverageRow(c.id, now), getPublicTerritorySummary(c.id, now)]);
      const dev = brief7.developments.filter((d) => d.conflictSlug === c.slug && !d.isPartyClaim)[0];
      return { slug: c.slug, name: c.shortName, status: c.status, severity: c.severity, severityLabel: SEVERITY_LABEL[c.severity] ?? c.severity, confidence: scores ? scores.confidence.confidenceScore : null, fullScaleWar: c.fullScaleWar, lastEventAt: c.lastEventAt, territorialData: terr.areas > 0, latestDevelopment: dev ? { title: dev.title, occurredAt: dev.occurredAt } : null, sourceHealth: cov?.health ?? null, latestSourceAt: cov?.latestSourceAt ?? null };
    }),
  );

  // ---- developments and infrastructure sections (the briefing engine's own developments) ----
  const factual = brief7.developments.filter((d) => !d.isPartyClaim);
  const byRank = [...factual].sort((a, b) => (b.impact != null ? 0.6 * b.significance + 0.4 * b.impact : b.significance) - (a.impact != null ? 0.6 * a.significance + 0.4 * a.impact : a.significance) || b.occurredAt.localeCompare(a.occurredAt) || b.confidence - a.confidence);
  const pick = (f: (d: BriefDevelopment) => boolean) => byRank.filter(f).slice(0, 6);
  const sections = {
    aviation: pick((d) => AVIATION.has(d.developmentType)),
    maritime: rec.landlocked ? [] : pick((d) => MARITIME.has(d.developmentType)),
    energy: pick((d) => d.developmentType === "energy"),
    internet: pick((d) => d.developmentType === "internet"),
    hazards: pick((d) => d.domain === "hazard"),
  };
  const disruptions = factual.filter((d) => d.domain === "infrastructure" && !d.isResolution).length;

  // ---- territory (domestic conflicts only; de facto / reported control) ----
  const territoryRows = await Promise.all(
    domestic.map(async (c) => {
      const [summary, changes, claims] = await Promise.all([getPublicTerritorySummary(c.id, now), listPublicTerritorialChanges({ conflictId: c.id, limit: 3 }), listConflictingClaims(c.id)]);
      return { slug: c.slug, name: c.shortName, summary, changes, conflictingClaims: claims };
    }),
  );
  const territory = { available: territoryRows.some((t) => t.summary.areas > 0 || t.changes.length > 0 || t.conflictingClaims.length > 0), conflicts: territoryRows.filter((t) => t.summary.areas > 0 || t.changes.length > 0 || t.conflictingClaims.length > 0) };

  // ---- actors (Military & Actor Knowledge Layer) ----
  const actors = await actorsFor(rec, [...domesticIds], now);

  // ---- source coverage ----
  const coverage = await coverageFor(rec, domestic, now);

  // ---- claims (party claims stay separate from independent reports) ----
  const claimDevs = briefClaims.developments.filter((d) => d.isPartyClaim);
  const independentReports = factual.filter((d) => d.domain === "conflict" || d.domain === "territory").reduce((s, d) => s + d.independentSourceCount, 0);

  // ---- freshness: each dataset has its own clock ----
  const freshness = await freshnessFor(rec, domestic, coverage, now);

  const latest = byRank[0] ?? null;
  const score = exposure.score;
  const statusLine = [domestic.length ? `${domestic.length} active conflict${domestic.length === 1 ? "" : "s"} in ${rec.name}` : `No active conflict recorded inside ${rec.name}`, nearby.length ? `${nearby.length} high-impact conflict${nearby.length === 1 ? "" : "s"} nearby` : null, disruptions ? `${disruptions} significant disruption${disruptions === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ");

  // ---- v1 sections ----
  const reportCounts = (await conflictReportCounts({ window: "7D" })).conflicts;
  const bordering = live.filter((c) => !domesticIds.has(c.id) && c.fightingCountryCodes.some((f) => rec.borders.includes(f)));
  const borderingIds = new Set(bordering.map((c) => c.id));
  const otherHigh = perConflict.filter(({ c, r }) => !domesticIds.has(c.id) && !borderingIds.has(c.id) && r.impact >= NEARBY_IMPACT_MIN).slice(0, 6).map(({ c }) => c);
  const reasonById = new Map(perConflict.map(({ c, r }) => [c.id, r]));
  const rowFor = async (c: Conflict): Promise<ConflictRowView> => {
    const r = reasonById.get(c.id)!;
    const scores = await scoreConflict(c.id);
    const dev = factual.filter((d) => d.conflictSlug === c.slug)[0];
    const bordersHit = c.fightingCountryCodes.filter((f) => rec.borders.includes(f));
    const reason = r.hardFloor ? hardFloorText(r.hardFloor)! : domesticIds.has(c.id) ? `Fighting recorded inside ${rec.name}` : bordersHit.length ? `Fighting in bordering ${bordersHit.map((b) => getCountryRecord(b)?.name ?? b).join(", ")}` : (r.reasons[0] ?? (r.distanceKm != null ? `About ${r.distanceKm.toLocaleString("en-US")} km away` : "Scored by the impact model"));
    return {
      slug: c.slug,
      name: c.shortName,
      status: c.status,
      fullScaleWar: c.fullScaleWar,
      fightingCountries: c.fightingCountryCodes,
      severityScore: scores ? scores.severity.severityScore : null,
      severityLabel: SEVERITY_LABEL[c.severity] ?? c.severity,
      impactScore: r.impact,
      confidenceScore: scores ? scores.confidence.confidenceScore : null,
      impactReason: reason,
      latestDevelopment: dev ? { title: dev.title, occurredAt: dev.occurredAt, deepLink: dev.deepLink } : null,
      reportCount7d: reportCounts[c.id] ?? 0,
    };
  };
  const [domesticConflictRows, borderingConflicts, otherRelevantConflicts] = await Promise.all([Promise.all(domestic.map(rowFor)), Promise.all(bordering.map(rowFor)), Promise.all(otherHigh.map(rowFor))]);
  const byImpact = (a: ConflictRowView, b: ConflictRowView) => b.impactScore - a.impactScore;
  borderingConflicts.sort(byImpact);

  const mapHref = `/world?${new URLSearchParams({ focus: `${rec.lat.toFixed(3)},${rec.lng.toFixed(3)},${rec.zoom}`, country: rec.code }).toString()}`;
  const toItem = (d: BriefDevelopment): DevelopmentItem => {
    const t = d.mapTarget;
    // Event developments carry their own scope. Conflict-wide developments (escalation, status, actors) sit on the
    // conflict's reference point, which is not a location of the development.
    const scope = d.locationScope ?? (d.domain === "conflict" || d.domain === "actor" || d.domain === "territory" ? "conflict" : d.geography.lat != null ? "point" : d.countryCode ? "country" : "unknown");
    // A country-level item has no point: its map focus is the country, never an invented position.
    const mapHrefFor = t?.lat != null && t?.lng != null ? `/world?${new URLSearchParams({ focus: `${t.lat.toFixed(3)},${t.lng.toFixed(3)},${t.zoom ?? 6}`, ...(t.layers.length ? { layers: t.layers.join(",") } : {}), ...(t.eventId ? { event: t.eventId } : {}), ...(t.hazardId ? { hazard: t.hazardId } : {}) }).toString()}` : d.countryCode ? `/world?${new URLSearchParams({ focus: `${(getCountryRecord(d.countryCode) ?? rec).lat.toFixed(3)},${(getCountryRecord(d.countryCode) ?? rec).lng.toFixed(3)},${(getCountryRecord(d.countryCode) ?? rec).zoom}`, country: d.countryCode, ...(t?.eventId ? { event: t.eventId } : {}) }).toString()}` : null;
    return { id: d.id, occurredAt: d.occurredAt, title: d.title, category: d.developmentType.replace(/_/g, " "), domain: d.domain, locationScope: scope, confidence: d.confidence, confidenceLabel: d.confidenceLabel, sources: d.sources.slice(0, 4).map((x) => ({ name: x.name, role: x.role })), independentSources: d.independentSourceCount, reportCount: d.reportCount ?? null, isPartyClaim: d.isPartyClaim, deepLink: d.deepLink, mapHref: mapHrefFor, conflictName: d.conflictName };
  };
  // Latest developments: the brief engine's meaningful developments for the country (party claims flagged) PLUS the
  // country's own published reports in the window, including country-level reports that have no map point and single
  // reports below the brief's significance threshold. A report already represented by a brief item appears once.
  const briefItems = briefClaims.developments.map(toItem);
  const inBrief = new Set(briefClaims.developments.filter((d) => d.id.startsWith("event:") || d.id.startsWith("party:")).map((d) => d.id.slice(d.id.indexOf(":") + 1)));
  const since7 = new Date(now.getTime() - 7 * 24 * HOUR);
  const ownEvents = await prisma.event.findMany({
    where: { published: true, countryCode: rec.code, occurredAt: { gte: since7, lte: now } },
    select: { id: true, slug: true, title: true, eventType: true, occurredAt: true, latitude: true, longitude: true, locationScope: true, verificationStatus: true, conflict: { select: { shortName: true, name: true } }, sources: { select: { rawIngestionItemId: true, relationship: true, rawIngestionItem: { select: { source: { select: { name: true, sourceRole: true, independenceClass: true, claimPolicy: true, perspective: true } } } } } } },
    orderBy: { occurredAt: "desc" },
    take: 80,
  });
  const reportItems: DevelopmentItem[] = ownEvents
    .filter((e) => !inBrief.has(e.id))
    .map((e) => {
      const trusts = e.sources.map((x) => sourceTrust(x.rawIngestionItem.source).category);
      const independent = trusts.filter((t) => t === "strong" || t === "perspective").length;
      const party = independent === 0 && trusts.some((t) => t === "party_claim" || t === "discovery");
      const confidence = e.verificationStatus === "confirmed" ? 0.85 : e.verificationStatus === "likely" ? 0.6 : 0.35;
      const scope = e.locationScope ?? (e.latitude != null ? "point" : "country");
      const point = e.latitude != null && e.longitude != null && !["country", "global", "unknown"].includes(scope);
      const focus = point ? `${e.latitude!.toFixed(3)},${e.longitude!.toFixed(3)},6` : `${rec.lat.toFixed(3)},${rec.lng.toFixed(3)},${rec.zoom}`;
      return {
        id: `report:${e.id}`,
        occurredAt: e.occurredAt.toISOString(),
        title: e.title,
        category: `report · ${e.eventType.replace(/_/g, " ")}`,
        domain: "conflict",
        locationScope: scope,
        confidence,
        confidenceLabel: confidence >= 0.7 ? "high" : confidence >= 0.5 ? "medium" : "low",
        sources: [...new Map(e.sources.map((x) => [x.rawIngestionItem.source.name, { name: x.rawIngestionItem.source.name, role: x.relationship }])).values()].slice(0, 4),
        independentSources: independent,
        reportCount: new Set(e.sources.map((x) => x.rawIngestionItemId)).size,
        isPartyClaim: party,
        deepLink: `/event/${e.slug}`,
        // A country-level report is focused on the country, never on an invented point.
        mapHref: `/world?${new URLSearchParams({ focus, ...(point ? { event: e.id } : { country: rec.code }) }).toString()}`,
        conflictName: e.conflict ? (e.conflict.shortName ?? e.conflict.name) : null,
      };
    });
  const developmentFeed = [...briefItems, ...reportItems].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, 80);

  // Exposure drivers: only the impact model's own inputs (hard floors, per-conflict impact) plus recorded conditions.
  const exposureDrivers: ExposureDriver[] = [];
  for (const r of exposureReasoning) {
    if (r.hardFloor === "own_country_war") exposureDrivers.push({ kind: "score", text: `Full-scale war inside ${rec.name}: ${r.conflictName} (sets impact to 100)`, conflictSlug: r.conflictSlug });
    else if (r.hardFloor === "bordering_war") exposureDrivers.push({ kind: "score", text: `Full-scale war in a directly bordering country: ${r.conflictName} (sets impact to at least 75)`, conflictSlug: r.conflictSlug });
    else if (r.impact >= 20) exposureDrivers.push({ kind: "score", text: `${r.conflictName}: impact ${r.impact}${r.reasons[0] ? ` (${r.reasons[0]})` : ""}`, conflictSlug: r.conflictSlug });
  }
  const within24 = (d: BriefDevelopment) => now.getTime() - new Date(d.occurredAt).getTime() <= 24 * HOUR;
  const activeInfra = factual.filter((d) => d.domain === "infrastructure" && !d.isResolution && within24(d));
  const infraKinds = [...new Set(activeInfra.map((d) => d.developmentType))];
  if (activeInfra.length) exposureDrivers.push({ kind: "context", text: `${activeInfra.length} infrastructure disruption${activeInfra.length === 1 ? "" : "s"} recorded in the last 24 h (${infraKinds.join(", ")})` });
  const recentHazards = factual.filter((d) => d.domain === "hazard" && within24(d));
  if (recentHazards.length) exposureDrivers.push({ kind: "context", text: `${recentHazards.length} significant natural-hazard alert${recentHazards.length === 1 ? "" : "s"} in the last 24 h` });

  // ---- territorial datasets relevant to the country (published only; control vs influence vs presence kept apart) ----
  const datasets = (await listAvailableDatasets()).filter((d: PublicTerritorialDataset) => d.countryCodes.includes(rec.code) || (d.conflictId != null && domesticIds.has(d.conflictId)));
  const territoryDatasets: TerritoryDatasetView[] = datasets.map((d) => ({
    id: d.id,
    name: d.name,
    datasetType: d.datasetType,
    typeLabel: DATASET_TYPE_LABEL[d.datasetType],
    kind: d.kind,
    provider: d.provider,
    license: d.license,
    attribution: d.attribution,
    sourceUrl: d.sourceUrl,
    lastUpdated: d.lastUpdated,
    confidence: d.confidence,
    actors: d.actors,
    areaCount: d.areaCount,
    hasHistory: d.hasHistory,
    conflictName: d.conflictName,
    openOnMap: `/world?${new URLSearchParams({ territory: "1", ...(d.conflictSlug ? { conflict: d.conflictSlug } : {}), focus: `${rec.lat.toFixed(3)},${rec.lng.toFixed(3)},${rec.zoom}`, country: rec.code }).toString()}`,
  }));

  // ---- infrastructure / hazard domains, with provider coverage stated ----
  const feeds = await prisma.source.findMany({ where: { type: "structured", platform: { in: ALL_DOMAIN_PLATFORMS }, enabled: true }, select: { platform: true, lastSuccessfulIngestion: true } });
  const domain = (key: CoverageDomain, pickFn: (d: BriefDevelopment) => boolean): DomainSection => ({ coverage: domainCoverage(key, rec, feeds, now), items: byRank.filter(pickFn).slice(0, 8).map(toItem) });
  const transport = domain("transport", (d) => AVIATION.has(d.developmentType) || (!rec.landlocked && MARITIME.has(d.developmentType)));
  const energy = domain("energy", (d) => d.developmentType === "energy");
  const internet = domain("internet", (d) => d.developmentType === "internet");
  const hazards = domain("hazards", (d) => d.domain === "hazard");

  // ---- source coverage verdict ----
  const sourceCoverage = await sourceCoverageFor(rec, domestic, now);

  // ---- current situation: facts only ----
  const currentSituation: string[] = [];
  if (domestic.length === 0) currentSituation.push(`No active armed conflict recorded inside ${rec.name}.`);
  else currentSituation.push(`Active armed conflict recorded inside ${rec.name}: ${domestic.map((c) => `${c.shortName}${c.fullScaleWar ? " (full-scale war)" : ""}`).join(", ")}.`);
  const borderWars = bordering.filter((c) => c.fullScaleWar);
  if (borderWars.length) currentSituation.push(`Full-scale war in a directly bordering country: ${borderWars.map((c) => `${c.shortName} (${c.fightingCountryCodes.filter((f) => rec.borders.includes(f)).map((f) => getCountryRecord(f)?.name ?? f).join(", ")})`).join("; ")}.`);
  else if (bordering.length) currentSituation.push(`Armed conflict in a bordering country: ${bordering.map((c) => c.shortName).join(", ")}.`);
  const meaningful24 = factual.filter(within24);
  const inCountry24 = meaningful24.filter((d) => d.countryCode === rec.code || d.watchKeys.some((k) => k.type === "country" && k.key === rec.code));
  const reports24 = ownEvents.filter((e) => now.getTime() - e.occurredAt.getTime() <= 24 * HOUR).length;
  currentSituation.push(meaningful24.length ? `${meaningful24.length} meaningful development${meaningful24.length === 1 ? "" : "s"} relevant to ${rec.name} in the past 24 h (${inCountry24.length} located in ${rec.name}).` : `No meaningful development relevant to ${rec.name} recorded in the past 24 h.`);
  if (reports24) currentSituation.push(`${reports24} published report${reports24 === 1 ? "" : "s"} located in ${rec.name} in the past 24 h.`);
  const statusChanges = factual.filter((d) => d.developmentType === "conflict_status" || d.developmentType === "escalation" || d.developmentType === "de_escalation");
  if (statusChanges.length) {
    const names = [...new Set(statusChanges.map((d) => d.conflictName).filter(Boolean))];
    currentSituation.push(`${statusChanges.length} escalation / status signal${statusChanges.length === 1 ? "" : "s"} in the past 7 days in conflicts relevant to ${rec.name}${names.length ? ` (${names.slice(0, 4).join(", ")}${names.length > 4 ? ", …" : ""})` : ""}.`);
  }
  if (territoryDatasets.length) currentSituation.push(`Reported territorial data available: ${territoryDatasets.map((d) => `${d.name} (${d.typeLabel.toLowerCase()})`).join("; ")}.`);
  const infraState = [transport, energy, internet].some((x) => x.coverage.state === "covered");
  if (activeInfra.length) currentSituation.push(`${activeInfra.length} infrastructure disruption${activeInfra.length === 1 ? "" : "s"} recorded in the past 24 h.`);
  else currentSituation.push(infraState ? `No major infrastructure disruption recorded by the connected providers in the past 24 h.` : `Infrastructure disruption data for ${rec.name} is insufficient; no disruption can be ruled out.`);
  if (recentHazards.length) currentSituation.push(`${recentHazards.length} significant natural-hazard alert${recentHazards.length === 1 ? "" : "s"} in the past 24 h.`);
  // Escalation / de-escalation assessments are stamped at the end of the brief window, not when anything happened:
  // they never count as the last update.
  const timed = [...factual.filter((d) => d.developmentType !== "escalation" && d.developmentType !== "de_escalation").map((d) => d.occurredAt), ...ownEvents.map((e) => e.occurredAt.toISOString())];
  const lastMeaningfulUpdate = timed.length ? timed.sort().at(-1)! : null;

  return {
    country: identityOf(rec),
    generatedAt: now.toISOString(),
    overview: {
      exposureScore: score,
      exposureLabel: SEVERITY_LABEL[severityFromScore(score)] ?? "",
      activeDomesticConflicts: domestic.length,
      highImpactNearbyConflicts: nearby.length,
      significantDisruptions: disruptions,
      latestDevelopment: latest ? { title: latest.title, occurredAt: latest.occurredAt, type: latest.developmentType, deepLink: latest.deepLink } : null,
      statusLine,
    },
    exposure: {
      score,
      change24h: exposure.change24h,
      leadConflict: exposureReasoning[0]?.conflictName ?? null,
      reasoning: exposureReasoning,
      dimensions: dims,
      note: "Exposure aggregates the central impact score of each monitored conflict for this country. It is not a political-risk score or a prediction.",
    },
    domesticConflicts: domesticViews,
    nearbyConflicts: nearby.map(({ c, r }) => ({ ...r, status: c.status, severityLabel: SEVERITY_LABEL[c.severity] ?? c.severity, why: whyNearby(rec, c, r) })),
    developments: byRank.slice(0, 8),
    sections,
    territory,
    actors,
    claims: { independentReports, partyClaimsHidden: claimDevs.length, partyClaims: claimDevs.slice(0, 6) },
    coverage,
    freshness,
    brief: { window: "6h", headline: brief6.headline, counts: { ...brief6.counts } },
    watch: { entityType: "country", entityKey: rec.code, label: rec.name },
    meta: { computeMs: Date.now() - started, conflictsScored: live.length },
    exposureDrivers,
    currentSituation,
    lastMeaningfulUpdate,
    borderingConflicts,
    otherRelevantConflicts,
    domesticConflictRows,
    developmentFeed,
    territoryDatasets,
    transport,
    energy,
    internet,
    hazards,
    sourceCoverage,
    mapHref,
  };
}

async function actorsFor(rec: CountryRecord, domesticIds: string[], now: Date) {
  const since30 = new Date(now.getTime() - 30 * 24 * HOUR);
  const units = await prisma.militaryUnit.findMany({
    where: { OR: [{ country: rec.code }, { country: rec.name }, ...(domesticIds.length ? [{ primaryConflictId: { in: domesticIds } }, { conflictLinks: { some: { conflictId: { in: domesticIds } } } }] : [])] },
    select: { id: true, name: true, entityType: true, country: true, lastUpdatedAt: true, sourceName: true, primaryConflict: { select: { name: true, shortName: true } }, conflictLinks: { select: { role: true, sourceName: true, confidence: true, conflict: { select: { name: true, shortName: true } } } } },
    orderBy: { lastUpdatedAt: "desc" },
    take: 80,
  });
  const ids = units.map((u) => u.id);
  const links = ids.length ? await prisma.militaryUnitEvent.findMany({ where: { unitId: { in: ids }, event: { published: true } }, select: { unitId: true, event: { select: { occurredAt: true } } }, take: 800 }) : [];
  const stats = new Map<string, { n30: number; last: Date | null }>();
  for (const l of links) {
    const s = stats.get(l.unitId) ?? stats.set(l.unitId, { n30: 0, last: null }).get(l.unitId)!;
    if (l.event.occurredAt >= since30) s.n30++;
    if (!s.last || l.event.occurredAt > s.last) s.last = l.event.occurredAt;
  }
  const isHere = (c: string | null) => !!c && (c.toUpperCase() === rec.code || c.toLowerCase() === rec.name.toLowerCase());
  const views = units.map((u) => {
    const type = u.entityType && isEntityType(u.entityType) ? u.entityType : null;
    const conflicts = [...new Set([...(u.primaryConflict ? [u.primaryConflict.shortName ?? u.primaryConflict.name] : []), ...u.conflictLinks.map((l) => l.conflict.shortName ?? l.conflict.name)])];
    const st = stats.get(u.id);
    const relationships = [...(u.primaryConflict ? [`primary conflict: ${u.primaryConflict.shortName ?? u.primaryConflict.name}`] : []), ...u.conflictLinks.map((l) => `${l.role.replace(/_/g, " ")} in ${l.conflict.shortName ?? l.conflict.name}`)];
    const linkConf = u.conflictLinks.map((l) => l.confidence).filter((x): x is number => x != null);
    const view: ActorView = { id: u.id, name: u.name, href: entityHref("unit", u.id, u.entityType), typeLabel: type ? ENTITY_TYPE_LABEL[type] : null, country: u.country, conflicts, recentEvents30d: st?.n30 ?? 0, lastObservedAt: iso(st?.last), relationships: [...new Set(relationships)], provenance: u.sourceName ?? u.conflictLinks.find((l) => l.sourceName)?.sourceName ?? null, confidence: linkConf.length ? Math.max(...linkConf) : null };
    return { view, type, here: isHere(u.country) };
  });
  const STATE = new Set(["state_military", "security_force", "military_unit"]);
  const NONSTATE = new Set(["armed_group", "militia", "political_military_group"]);
  const INTL = new Set(["coalition", "peacekeeping_force"]);
  const cap = (list: ActorView[]) => list.slice(0, 12);
  return {
    stateForces: cap(views.filter((v) => v.type && STATE.has(v.type) && v.here).map((v) => v.view)),
    nonStateArmed: cap(views.filter((v) => v.type && NONSTATE.has(v.type)).map((v) => v.view)),
    international: cap(views.filter((v) => (v.type && INTL.has(v.type)) || (!v.here && v.view.country && v.type && !NONSTATE.has(v.type))).map((v) => v.view)),
    other: cap(views.filter((v) => !(v.type && (STATE.has(v.type) && v.here)) && !(v.type && NONSTATE.has(v.type)) && !(v.type && INTL.has(v.type)) && !(!v.here && v.view.country && v.type)).map((v) => v.view)),
  };
}

async function coverageFor(rec: CountryRecord, domestic: Conflict[], now: Date): Promise<CoverageView> {
  const rows = (await Promise.all(domestic.map((c) => getCoverageRow(c.id, now)))).filter((r): r is NonNullable<typeof r> => !!r);
  const ids = new Set(rows.flatMap((r) => r.sources.map((s) => s.id)));
  const local = await prisma.source.findMany({ where: { enabled: true, OR: [{ country: rec.code }, { country: rec.name }] }, select: { id: true } });
  for (const s of local) ids.add(s.id);
  const sources = ids.size ? await prisma.source.findMany({ where: { id: { in: [...ids] }, type: { not: "structured" } }, select: { id: true, name: true, enabled: true, country: true, sourceRole: true, independenceClass: true, claimPolicy: true, perspective: true, lastSuccessfulIngestion: true } }) : [];
  const byTrust = { strong: 0, perspective: 0, party_claim: 0, other: 0 };
  for (const s of sources) {
    const cat: TrustCategory = sourceTrust(s).category;
    if (cat === "strong") byTrust.strong++;
    else if (cat === "perspective") byTrust.perspective++;
    else if (cat === "party_claim") byTrust.party_claim++;
    else byTrust.other++;
  }
  const cutoff = now.getTime() - STALE_SOURCE_HOURS * HOUR;
  const times = sources.map((s) => s.lastSuccessfulIngestion).filter((t): t is Date => !!t);
  return {
    sourcesCovering: sources.length,
    byTrust,
    lastFetchAt: times.length ? iso(new Date(Math.max(...times.map((t) => t.getTime())))) : null,
    specialistLocalSources: sources.filter((s) => ["local_media", "eyewitness_community", "specialist_research"].includes(s.sourceRole ?? "") || s.country === rec.code || s.country === rec.name).length,
    staleFeeds: sources.filter((s) => s.enabled && (!s.lastSuccessfulIngestion || s.lastSuccessfulIngestion.getTime() < cutoff)).slice(0, 8).map((s) => ({ name: s.name, lastSuccessfulIngestion: iso(s.lastSuccessfulIngestion) })),
    gaps: rows.filter((r) => r.health !== "healthy").map((r) => ({ conflict: r.conflict.shortName ?? r.conflict.name, slug: r.conflict.slug, health: r.health, reasons: r.reasons.slice(0, 3) })),
  };
}

/** Source coverage verdict for the country (lib/sources/coverage-verdict.ts): dedicated = based in the country or
 * linked to one of its domestic conflicts; global = everything else Vigil polls. */
async function sourceCoverageFor(rec: CountryRecord, domestic: Conflict[], now: Date): Promise<SourceCoverageView> {
  const domesticIds = domestic.map((c) => c.id);
  const linked = domesticIds.length ? await prisma.sourceConflictLink.findMany({ where: { conflictId: { in: domesticIds } }, select: { sourceId: true } }) : [];
  const linkedIds = new Set(linked.map((l) => l.sourceId));
  const all = await prisma.source.findMany({ where: { enabled: true, type: { not: "structured" } }, select: { id: true, country: true, sourceRole: true, independenceClass: true, claimPolicy: true, perspective: true, lastSuccessfulIngestion: true } });
  const isHere = (c: string | null) => !!c && (c.toUpperCase() === rec.code || c.toLowerCase() === rec.name.toLowerCase());
  // A source based in another country covers that country, not this one.
  const relevant = all.filter((s) => isHere(s.country) || linkedIds.has(s.id) || !s.country).map((s) => ({ ...s, dedicated: isHere(s.country) || linkedIds.has(s.id) }));
  const gaps = (await Promise.all(domestic.map((c) => getCoverageRow(c.id, now)))).filter((r) => r && r.health !== "healthy").length;
  return coverageVerdict(rec.name, relevant, { now, staleHours: STALE_SOURCE_HOURS, gaps });
}

async function freshnessFor(rec: CountryRecord, domestic: Conflict[], coverage: CoverageView, now: Date): Promise<FreshnessItem[]> {
  const item = (key: string, label: string, at: string | null, staleHours: number): FreshnessItem => {
    const age = ageOf(at, now);
    return { key, label, at, ageHours: age == null ? null : Math.round(age * 10) / 10, stale: age == null || age > staleHours };
  };
  const latestEvent = await prisma.event.aggregate({ where: { published: true, OR: [{ countryCode: rec.code }, ...(domestic.length ? [{ conflictId: { in: domestic.map((c) => c.id) } }] : [])] }, _max: { occurredAt: true } });
  const out: FreshnessItem[] = [item("conflict_events", "Latest conflict event", iso(latestEvent._max.occurredAt), 48)];
  if (domestic.length) out.push(item("conflict_sources", "Conflict source coverage", coverage.lastFetchAt, STALE_SOURCE_HOURS));
  const platforms = LAYER_PROVIDERS.flatMap((l) => l.platforms);
  const feeds = await prisma.source.findMany({ where: { type: "structured", platform: { in: platforms }, enabled: true }, select: { platform: true, lastSuccessfulIngestion: true } });
  for (const l of LAYER_PROVIDERS) {
    if (rec.landlocked && l.key === "maritime") continue;
    const ts = feeds.filter((f) => l.platforms.includes(f.platform ?? "") && f.lastSuccessfulIngestion).map((f) => f.lastSuccessfulIngestion!.getTime());
    if (ts.length === 0) continue; // no configured feed for this dataset: nothing to claim about its freshness
    out.push(item(l.key, l.label, new Date(Math.max(...ts)).toISOString(), l.staleHours));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Comparison foundation: the same aggregation, reduced to comparable numbers.
// ---------------------------------------------------------------------------------------------
export interface CountrySummary {
  code: string;
  alpha3: string;
  name: string;
  region: string;
  exposure: number;
  exposureLabel: string;
  activeDomesticConflicts: number;
  highImpactNearbyConflicts: number;
  activeDevelopments: number;
  infrastructureDisruptions: number;
  hazards: number;
  latestConflictEventAt: string | null;
  freshnessStale: number;
}

export async function getCountrySummary(code: string, now: Date = new Date()): Promise<CountrySummary | null> {
  const i = await getCountryIntelligence(code, now);
  if (!i) return null;
  return {
    code: i.country.code,
    alpha3: i.country.alpha3,
    name: i.country.name,
    region: i.country.region,
    exposure: i.overview.exposureScore,
    exposureLabel: i.overview.exposureLabel,
    activeDomesticConflicts: i.overview.activeDomesticConflicts,
    highImpactNearbyConflicts: i.overview.highImpactNearbyConflicts,
    activeDevelopments: i.developments.length,
    infrastructureDisruptions: i.overview.significantDisruptions,
    hazards: i.sections.hazards.length,
    latestConflictEventAt: i.freshness.find((f) => f.key === "conflict_events")?.at ?? null,
    freshnessStale: i.freshness.filter((f) => f.stale).length,
  };
}
