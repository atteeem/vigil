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
  };
}

async function actorsFor(rec: CountryRecord, domesticIds: string[], now: Date) {
  const since30 = new Date(now.getTime() - 30 * 24 * HOUR);
  const units = await prisma.militaryUnit.findMany({
    where: { OR: [{ country: rec.code }, { country: rec.name }, ...(domesticIds.length ? [{ primaryConflictId: { in: domesticIds } }, { conflictLinks: { some: { conflictId: { in: domesticIds } } } }] : [])] },
    select: { id: true, name: true, entityType: true, country: true, lastUpdatedAt: true, primaryConflict: { select: { name: true, shortName: true } }, conflictLinks: { select: { conflict: { select: { name: true, shortName: true } } } } },
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
    const view: ActorView = { id: u.id, name: u.name, href: entityHref("unit", u.id, u.entityType), typeLabel: type ? ENTITY_TYPE_LABEL[type] : null, country: u.country, conflicts, recentEvents30d: st?.n30 ?? 0, lastObservedAt: iso(st?.last) };
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
