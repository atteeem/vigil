import { prisma } from "@/lib/db/client";
import { getBrief } from "@/lib/brief/brief";
import type { BriefDevelopment } from "@/lib/brief/types";
import { deriveConfidence } from "@/lib/brief/scoring";
import { computeImpact } from "@/lib/data/impact";
import { getPublicConflictDetail, type PublicConflictDetail } from "@/lib/public/conflict-detail";
import { conflictReportCounts } from "@/lib/public/report-counts";
import { STALE_SOURCE_HOURS } from "@/lib/public/stale";
import { entityHref } from "@/lib/public/entities";
import { COUNTRIES } from "@/lib/reference/countries";
import { getCountryRecord } from "@/lib/countries/registry";
import { listAvailableDatasets } from "@/lib/territory/datasets";
import { DATASET_TYPE_LABEL } from "@/lib/territory/dataset-types";
import { summarizeEvidence, sourceTrust, type EvidenceSummary, type TrustCategory } from "@/lib/sources/trust";
import { coverageVerdict, type CoverageVerdict } from "@/lib/sources/coverage-verdict";
import { ENTITY_TYPE_LABEL, isEntityType } from "@/lib/military/entity-types";
import { SEVERITY_LABEL } from "@/lib/utils/severity";
import { resolveConflictSlug } from "./resolve";
import { OTHER_IMPACT_MIN } from "./constants";

// The conflict intelligence layer: ONE server-side aggregation (GET /api/conflict/[id]/intelligence and the
// /conflict/[slug] page) over the existing registry, scoring engine, brief engine, state-transition ledger,
// published events and their reports, territorial-control registry, actor knowledge layer and source coverage.
// It arranges what those systems produce; the only things it derives are counts and groupings, each stated.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const NO_POINT = new Set(["country", "global", "unknown"]);

export interface ScoreView {
  value: number | null;
  label: string | null;
  reasons: string[];
  explanation: string;
}

export interface ImpactEntry {
  score: number;
  hardFloor: "own_country_war" | "bordering_war" | null;
  reason: string;
}

export interface EvidenceReportView {
  id: string;
  source: string;
  headline: string | null;
  publishedAt: string;
  trustCategory: TrustCategory;
  trustLabel: string;
  badge: string | null;
  perspective: string | null;
  /** How this report counts: independent, party claim, discovery lead, relay / repeat, official provider. */
  evidenceRole: string;
  url: string | null;
}

export interface Disagreement {
  field: string;
  label: string;
  values: { value: string; sources: string[]; partyOnly: boolean }[];
}

export interface FeedItem {
  id: string;
  kind: "event" | "development";
  occurredAt: string;
  title: string;
  category: string;
  locationScope: string;
  place: string | null;
  severity: string | null;
  significance: number | null;
  confidence: number;
  confidenceLabel: "high" | "medium" | "low";
  confidenceReasons: string[];
  /** Unique published reports (raw report ids) — the same count the map and the other pages show. */
  reportCount: number;
  sourceCount: number;
  evidence: EvidenceSummary | null;
  reports: EvidenceReportView[];
  disagreements: Disagreement[];
  isPartyClaim: boolean;
  deepLink: string;
  mapHref: string | null;
}

export interface TimelineEntry {
  at: string;
  kind: "start" | "status" | "severity_band" | "escalation" | "de_escalation" | "territory" | "geography" | "actor" | "incident" | "infrastructure";
  title: string;
  detail: string | null;
  href: string | null;
  mapHref: string | null;
}

export interface WhatChangedWindow {
  window: "6h" | "24h" | "3d" | "7d";
  items: { kind: string; title: string; detail: string | null; href: string | null }[];
  counts: { developments: number; territorialChanges: number; corroboratedIncidents: number };
}

export interface RelatedCountry {
  code: string;
  name: string;
  impactScore: number;
  reason: string;
}

export interface ConflictActorView {
  id: string;
  name: string;
  href: string;
  typeLabel: string | null;
  role: string;
  relationship: string;
  provenance: string | null;
  confidence: number | null;
  lastObservedAt: string | null;
  commanders: { id: string; name: string; rank: string | null; href: string }[];
}

export interface TerritoryDatasetRow {
  id: string;
  name: string;
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
  openOnMap: string;
}

export interface ConflictIntelligence {
  detail: PublicConflictDetail;
  generatedAt: string;
  scores: {
    severity: ScoreView;
    confidence: ScoreView & { rollup: { events30d: number; corroborated: number; singleSource: number; partyOnly: number } };
    impact: { explanation: string; byCountry: Record<string, ImpactEntry> };
  };
  currentSituation: string[];
  lastMeaningfulUpdate: string | null;
  feed: FeedItem[];
  reportCounts: { "24H": number; "7D": number; "30D": number };
  geography: PublicConflictDetail["geography"];
  territory: { datasets: TerritoryDatasetRow[] };
  actors: ConflictActorView[];
  belligerentStates: { code: string; name: string }[];
  externalSupporters: { code: string; name: string }[];
  relatedCountries: { fightingInside: RelatedCountry[]; bordering: RelatedCountry[]; other: RelatedCountry[] };
  infrastructure: FeedItem[];
  timeline: TimelineEntry[];
  whatChanged: WhatChangedWindow[];
  sourceCoverage: CoverageVerdict & { health: string | null };
  brief: { headline: string };
  mapHref: string;
  meta: { computeMs: number };
}

const FACT_LABEL: Record<string, string> = { casualtiesKilled: "Reported killed", casualtiesInjured: "Reported injured", locationName: "Location" };

function roleOf(trust: TrustCategory, relay: boolean, official: boolean): string {
  if (relay) return "relay / repeat (not counted)";
  if (official) return "official provider";
  if (trust === "party_claim") return "party claim (not independent)";
  if (trust === "discovery") return "discovery lead (not evidence)";
  return "independent report";
}

const worldFocus = (lat: number, lng: number, zoom: number, extra: Record<string, string> = {}) => `/world?${new URLSearchParams({ focus: `${lat.toFixed(3)},${lng.toFixed(3)},${zoom}`, ...extra }).toString()}`;

export async function getConflictIntelligence(ref: string, now: Date = new Date()): Promise<ConflictIntelligence | null> {
  const started = Date.now();
  const slug = await resolveConflictSlug(ref);
  if (!slug) return null;
  const detail = await getPublicConflictDetail(slug, now);
  if (!detail) return null;
  const c = detail.conflict;
  const fighting = c.fightingCountryCodes;
  const primary = getCountryRecord(fighting[0] ?? "");
  const focusLat = c.locationKnown && c.lat != null ? c.lat : (primary?.lat ?? 0);
  const focusLng = c.locationKnown && c.lng != null ? c.lng : (primary?.lng ?? 0);
  const focusZoom = primary?.zoom ?? 5;

  const since30 = new Date(now.getTime() - 30 * DAY);
  const [events, briefs, globalBrief, counts24, counts7, counts30, transitions, allDatasets, firstByCountry, majorRows] = await Promise.all([
    prisma.event.findMany({
      where: { conflictId: c.id, published: true, occurredAt: { gte: since30, lte: new Date(now.getTime() + DAY) } },
      select: {
        id: true, slug: true, title: true, eventType: true, occurredAt: true, severity: true, verificationStatus: true, latitude: true, longitude: true, locationScope: true, locationName: true, city: true, adminRegion: true, countryCode: true, casualtiesKilled: true,
        sources: { select: { rawIngestionItemId: true, relationship: true, createdAt: true, rawIngestionItem: { select: { id: true, originalTitle: true, originalUrl: true, publishedAt: true, receivedAt: true, source: { select: { id: true, name: true, sourceRole: true, independenceClass: true, claimPolicy: true, perspective: true } }, extractedFacts: { where: { field: { in: Object.keys(FACT_LABEL) } }, select: { field: true, value: true } } } } } },
      },
      orderBy: { occurredAt: "desc" },
      take: 250,
    }),
    Promise.all((["6h", "24h", "3d", "7d"] as const).map((w) => getBrief({ conflict: slug, window: w, includePartyClaims: true }, now))),
    getBrief({ window: "7d" }, now),
    conflictReportCounts({ window: "24H" }),
    conflictReportCounts({ window: "7D" }),
    conflictReportCounts({ window: "30D" }),
    prisma.stateTransition.findMany({ where: { kind: "conflict", key: c.id }, orderBy: { at: "desc" }, take: 40 }),
    listAvailableDatasets(),
    prisma.event.groupBy({ by: ["countryCode"], where: { conflictId: c.id, published: true, countryCode: { not: null } }, _min: { occurredAt: true } }),
    prisma.event.findMany({
      where: { conflictId: c.id, published: true, severity: { in: ["severe", "extreme"] }, occurredAt: { gte: new Date(now.getTime() - 365 * DAY) } },
      select: { id: true, slug: true, title: true, occurredAt: true, latitude: true, longitude: true, locationScope: true, sources: { select: { relationship: true, rawIngestionItem: { select: { originalUrl: true, source: { select: { id: true, sourceRole: true, independenceClass: true, claimPolicy: true, perspective: true } } } } } } },
      orderBy: { occurredAt: "desc" },
      take: 200,
    }),
  ]);
  const [brief6, brief24, brief3d, brief7] = briefs as [typeof briefs[number], typeof briefs[number], typeof briefs[number], typeof briefs[number]];

  // ---- evidence per event (the existing corroboration model: outlets and articles are independence groups) ----
  const eventItems: FeedItem[] = events.map((e) => {
    const reportsRaw = e.sources.map((s) => {
      const src = s.rawIngestionItem.source;
      const trust = sourceTrust(src);
      const relay = s.relationship === "relay";
      const official = trust.authorityScope != null;
      return { s, src, trust, relay, official };
    });
    const summary = summarizeEvidence(reportsRaw.map((r) => ({ sourceId: r.src.id, url: r.s.rawIngestionItem.originalUrl, trust: r.trust, relay: r.relay })));
    // Where reports give different figures / places, show the disagreement; nothing is reconciled.
    const byField = new Map<string, Map<string, { sources: Set<string>; party: boolean }>>();
    for (const r of reportsRaw) {
      for (const f of r.s.rawIngestionItem.extractedFacts) {
        const m = byField.get(f.field) ?? byField.set(f.field, new Map()).get(f.field)!;
        const v = m.get(f.value) ?? m.set(f.value, { sources: new Set(), party: true }).get(f.value)!;
        v.sources.add(r.src.name);
        if (r.trust.category !== "party_claim") v.party = false;
      }
    }
    const disagreements: Disagreement[] = [...byField].filter(([, m]) => m.size > 1).map(([field, m]) => ({ field, label: FACT_LABEL[field] ?? field, values: [...m].map(([value, v]) => ({ value, sources: [...v.sources], partyOnly: v.party })) }));
    const newest = Math.max(...e.sources.map((s) => (s.rawIngestionItem.publishedAt ?? s.rawIngestionItem.receivedAt).getTime()), 0);
    const conf = deriveConfidence({ evidence: summary, verificationStatus: e.verificationStatus, conflictingClaims: disagreements.length > 0, freshnessHours: newest ? (now.getTime() - newest) / HOUR : null });
    const scope = e.locationScope ?? (e.latitude != null ? "point" : e.countryCode ? "country" : "unknown");
    const point = e.latitude != null && e.longitude != null && !NO_POINT.has(scope);
    const country = getCountryRecord(e.countryCode ?? "");
    const reports: EvidenceReportView[] = reportsRaw.map((r) => ({ id: r.s.rawIngestionItem.id, source: r.src.name, headline: r.s.rawIngestionItem.originalTitle, publishedAt: (r.s.rawIngestionItem.publishedAt ?? r.s.rawIngestionItem.receivedAt).toISOString(), trustCategory: r.trust.category, trustLabel: r.trust.label, badge: r.trust.badge, perspective: r.trust.perspective, evidenceRole: roleOf(r.trust.category, r.relay, r.official), url: r.s.rawIngestionItem.originalUrl?.trim() ? r.s.rawIngestionItem.originalUrl : null }));
    return {
      id: `event:${e.id}`,
      kind: "event" as const,
      occurredAt: e.occurredAt.toISOString(),
      title: e.title,
      category: e.eventType.replace(/_/g, " "),
      locationScope: scope,
      place: e.city ?? e.adminRegion ?? e.locationName ?? country?.name ?? null,
      severity: e.severity,
      significance: null,
      confidence: conf.score,
      confidenceLabel: conf.score >= 0.7 ? "high" : conf.score >= 0.45 ? "medium" : "low",
      confidenceReasons: conf.reasons,
      reportCount: new Set(e.sources.map((s) => s.rawIngestionItemId)).size,
      sourceCount: new Set(e.sources.map((s) => s.rawIngestionItem.source.id)).size,
      evidence: summary,
      reports,
      disagreements,
      isPartyClaim: summary.independentSources === 0 && summary.partyClaims + summary.discoveryLeads > 0,
      deepLink: `/event/${e.slug}`,
      // A country / region-level report focuses the country or the region's centroid; never an invented exact point.
      mapHref: point ? worldFocus(e.latitude!, e.longitude!, scope === "point" ? 9 : 7, { event: e.id, at: e.occurredAt.toISOString() }) : country ? worldFocus(country.lat, country.lng, country.zoom, { country: country.code }) : null,
    };
  });
  // Significance from the brief where it covered the event.
  const sigById = new Map(brief7.developments.map((d) => [d.id.replace(/^(event|party):/, ""), d.significance]));
  for (const it of eventItems) it.significance = sigById.get(it.id.slice(6)) ?? null;

  const devItem = (d: BriefDevelopment): FeedItem => ({
    id: d.id,
    kind: "development",
    occurredAt: d.occurredAt,
    title: d.title,
    category: d.developmentType.replace(/_/g, " "),
    locationScope: d.locationScope ?? (d.domain === "conflict" || d.domain === "actor" || d.domain === "territory" ? "conflict" : d.geography.lat != null ? "point" : d.countryCode ? "country" : "unknown"),
    place: d.geography.place,
    severity: d.currentState && ["minimal", "low", "guarded", "elevated", "high", "severe", "extreme"].includes(d.currentState) ? d.currentState : null,
    significance: d.significance,
    confidence: d.confidence,
    confidenceLabel: d.confidenceLabel,
    confidenceReasons: d.confidenceReasons,
    reportCount: d.reportCount ?? 0,
    sourceCount: d.sources.length,
    evidence: null,
    reports: [],
    disagreements: [],
    isPartyClaim: d.isPartyClaim,
    deepLink: d.deepLink,
    mapHref: d.mapTarget?.lat != null && d.mapTarget.lng != null ? worldFocus(d.mapTarget.lat, d.mapTarget.lng, d.mapTarget.zoom ?? 6, { ...(d.mapTarget.layers.length ? { layers: d.mapTarget.layers.join(",") } : {}), ...(d.mapTarget.territory ? { territory: "1", conflict: slug } : {}) }) : null,
  });
  // Conflict-wide developments (escalation, status, actors, territory) from the brief; incidents come from the events above.
  const conflictDevs = brief7.developments.filter((d) => !d.id.startsWith("event:") && !d.id.startsWith("party:") && d.domain !== "infrastructure" && d.domain !== "hazard");
  const feed = [...eventItems, ...conflictDevs.map(devItem)].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

  // ---- infrastructure / hazards in the fighting geography (the brief's own developments) ----
  const infrastructure = globalBrief.developments.filter((d) => (d.domain === "infrastructure" || d.domain === "hazard") && d.countryCode && fighting.includes(d.countryCode)).slice(0, 10).map(devItem);

  // ---- scores: three separate values ----
  const sev = detail.scores?.severity ?? null;
  const confScore = detail.scores?.confidence ?? null;
  const factual = eventItems.filter((e) => !e.isPartyClaim);
  const rollup = { events30d: eventItems.length, corroborated: factual.filter((e) => (e.evidence?.independentSources ?? 0) >= 2).length, singleSource: factual.filter((e) => (e.evidence?.independentSources ?? 0) === 1).length, partyOnly: eventItems.length - factual.length };
  const byCountry: Record<string, ImpactEntry> = {};
  for (const country of COUNTRIES) {
    const im = computeImpact(country, c);
    const reason = im.hardFloor === "own_country_war" ? "Full-scale war inside the country (hard rule: 100)" : im.hardFloor === "bordering_war" ? "Full-scale war in a directly bordering country (hard rule: at least 75)" : (im.overallDrivers.map((o) => o.description).find(Boolean)?.split("; ")[0] ?? "Limited geographic or economic exposure");
    byCountry[country.code] = { score: im.score, hardFloor: im.hardFloor, reason };
  }

  // ---- related countries, grouped factually (fighting geography only feeds the floors) ----
  const name = (code: string) => getCountryRecord(code)?.name ?? code;
  const fightingInside = fighting.map((code) => ({ code, name: name(code), impactScore: byCountry[code]?.score ?? 0, reason: fightingReason(byCountry[code]) }));
  const borderSet = new Set(fighting.flatMap((f) => getCountryRecord(f)?.borders ?? []).filter((b) => !fighting.includes(b)));
  const bordering = [...borderSet].map((code) => ({ code, name: name(code), impactScore: byCountry[code]?.score ?? 0, reason: byCountry[code]?.hardFloor === "bordering_war" ? "Full-scale war in a directly bordering country (hard rule: at least 75)" : `Borders ${fighting.filter((f) => getCountryRecord(f)?.borders.includes(code)).map(name).join(", ")}` })).sort((a, b) => b.impactScore - a.impactScore);
  const shown = new Set([...fighting, ...borderSet]);
  // Every country at or above the stated threshold, not a top-N cut (many countries share the model's sub-floor cap).
  const other = Object.entries(byCountry).filter(([code, e]) => !shown.has(code) && e.score >= OTHER_IMPACT_MIN).map(([code, e]) => ({ code, name: name(code), impactScore: e.score, reason: e.reason })).sort((a, b) => b.impactScore - a.impactScore || a.name.localeCompare(b.name));

  // ---- territory: published datasets of this conflict (control vs influence vs presence kept apart) ----
  const datasets: TerritoryDatasetRow[] = allDatasets.filter((d) => d.conflictId === c.id).map((d) => ({ id: d.id, name: d.name, typeLabel: DATASET_TYPE_LABEL[d.datasetType], kind: d.kind, provider: d.provider, license: d.license, attribution: d.attribution, sourceUrl: d.sourceUrl, lastUpdated: d.lastUpdated, confidence: d.confidence, actors: d.actors, areaCount: d.areaCount, hasHistory: d.hasHistory, openOnMap: worldFocus(focusLat, focusLng, focusZoom, { territory: "1", conflict: slug }) }));

  // ---- actors (recorded links only) ----
  const actors = await actorsFor(c.id);

  // ---- timeline: state changes, not every report ----
  const timeline: TimelineEntry[] = [];
  if (c.startedAt) timeline.push({ at: new Date(c.startedAt).toISOString(), kind: "start", title: `${c.shortName ?? c.name} began (registry start date)`, detail: null, href: null, mapHref: null });
  for (const t of transitions) {
    if (t.alertType === "conflict_status") timeline.push({ at: t.at.toISOString(), kind: "status", title: `Status ${t.fromState ?? "?"} → ${t.toState}`, detail: "Conflict registry status change", href: null, mapHref: worldFocus(focusLat, focusLng, focusZoom, { conflict: slug, at: t.at.toISOString() }) });
    else if (t.alertType === "conflict_escalation") timeline.push({ at: t.at.toISOString(), kind: "severity_band", title: `Severity band ${t.fromState ?? "?"} → ${t.toState}`, detail: t.fromValue != null && t.toValue != null ? `Severity score ${Math.round(t.fromValue)} → ${Math.round(t.toValue)}` : null, href: null, mapHref: worldFocus(focusLat, focusLng, focusZoom, { conflict: slug, at: t.at.toISOString() }) });
  }
  for (const d of brief7.developments.filter((d) => d.developmentType === "escalation" || d.developmentType === "de_escalation" || d.developmentType === "actor_involvement")) {
    timeline.push({ at: d.occurredAt, kind: d.developmentType === "actor_involvement" ? "actor" : d.developmentType === "escalation" ? "escalation" : "de_escalation", title: d.title, detail: d.summary.slice(0, 180), href: d.deepLink, mapHref: null });
  }
  for (const ch of detail.territorialChanges) timeline.push({ at: ch.observedAt ?? ch.reviewedAt ?? now.toISOString(), kind: "territory", title: `Approved territorial change: ${ch.description}`, detail: ch.claimedActor ? `Claimed actor: ${ch.claimedActor.name}` : null, href: null, mapHref: worldFocus(focusLat, focusLng, focusZoom, { territory: "1", conflict: slug, at: ch.observedAt ?? ch.reviewedAt ?? now.toISOString() }) });
  // New fighting geography, derived from recorded incidents: the first published event in each country.
  for (const g of firstByCountry) {
    if (!g.countryCode || !g._min.occurredAt) continue;
    const rec = getCountryRecord(g.countryCode);
    timeline.push({ at: g._min.occurredAt.toISOString(), kind: "geography", title: `First recorded incident in ${rec?.name ?? g.countryCode}`, detail: fighting.includes(g.countryCode) ? "Within the registry's fighting geography" : "Outside the registry's recorded fighting geography", href: `/country/${g.countryCode}`, mapHref: rec ? worldFocus(rec.lat, rec.lng, rec.zoom, { country: rec.code, at: g._min.occurredAt.toISOString() }) : null });
  }
  // Important corroborated incidents: severe / extreme events with at least two independent source groups.
  for (const e of majorRows) {
    const s = summarizeEvidence(e.sources.map((x) => ({ sourceId: x.rawIngestionItem.source.id, url: x.rawIngestionItem.originalUrl, trust: sourceTrust(x.rawIngestionItem.source), relay: x.relationship === "relay" })));
    if (s.independentSources < 2) continue;
    const point = e.latitude != null && e.longitude != null && !NO_POINT.has(e.locationScope ?? "point");
    timeline.push({ at: e.occurredAt.toISOString(), kind: "incident", title: e.title, detail: `${s.independentSources} independent source groups`, href: `/event/${e.slug}`, mapHref: point ? worldFocus(e.latitude!, e.longitude!, 8, { event: e.id, at: e.occurredAt.toISOString() }) : null });
    if (timeline.filter((x) => x.kind === "incident").length >= 12) break;
  }
  for (const d of infrastructure.filter((d) => (d.significance ?? 0) >= 60).slice(0, 5)) timeline.push({ at: d.occurredAt, kind: "infrastructure", title: d.title, detail: null, href: d.deepLink, mapHref: d.mapHref });
  timeline.sort((a, b) => b.at.localeCompare(a.at));

  // ---- what changed, per window (brief engine + ledger + recorded incidents; never article volume) ----
  const windowMs = { "6h": 6 * HOUR, "24h": DAY, "3d": 3 * DAY, "7d": 7 * DAY } as const;
  const briefFor = { "6h": brief6, "24h": brief24, "3d": brief3d, "7d": brief7 } as const;
  const whatChanged: WhatChangedWindow[] = (["6h", "24h", "3d", "7d"] as const).map((w) => {
    const from = now.getTime() - windowMs[w];
    const inW = (at: string) => new Date(at).getTime() >= from;
    const items: WhatChangedWindow["items"] = [];
    for (const g of firstByCountry) if (g.countryCode && g._min.occurredAt && g._min.occurredAt.getTime() >= from) items.push({ kind: "new fighting geography", title: `First recorded incident in ${name(g.countryCode)}`, detail: "No earlier published incident of this conflict there", href: `/country/${g.countryCode}` });
    for (const t of transitions.filter((t) => t.at.getTime() >= from)) items.push({ kind: t.alertType === "conflict_status" ? "status change" : "severity-band change", title: `${t.alertType === "conflict_status" ? "Status" : "Severity band"} ${t.fromState ?? "?"} → ${t.toState}`, detail: null, href: null });
    const b = briefFor[w];
    for (const d of b.developments.filter((d) => ["escalation", "de_escalation", "actor_involvement", "territory_changed", "conflict_status"].includes(d.developmentType) && !d.isPartyClaim)) items.push({ kind: d.developmentType === "territory_changed" ? "territorial change" : d.developmentType === "actor_involvement" ? "new actor" : d.developmentType.replace(/_/g, "-"), title: d.title, detail: d.reasons[0] ?? null, href: d.deepLink });
    const corroborated = eventItems.filter((e) => inW(e.occurredAt) && !e.isPartyClaim && (e.evidence?.independentSources ?? 0) >= 2 && ["high", "severe", "extreme"].includes(e.severity ?? ""));
    for (const e of corroborated.slice(0, 5)) items.push({ kind: "corroborated incident", title: e.title, detail: `${e.evidence!.independentSources} independent source groups · severity ${e.severity}`, href: e.deepLink });
    for (const d of infrastructure.filter((d) => inW(d.occurredAt)).slice(0, 4)) items.push({ kind: d.category, title: d.title, detail: null, href: d.deepLink });
    return { window: w, items, counts: { developments: b.counts.developments, territorialChanges: b.counts.territorialChanges, corroboratedIncidents: corroborated.length } };
  });

  // ---- source coverage verdict (shared rules) ----
  const linked = await prisma.sourceConflictLink.findMany({ where: { conflictId: c.id }, select: { sourceId: true } });
  const linkedIds = new Set(linked.map((l) => l.sourceId));
  const coverageIds = new Set((detail.coverage?.sources ?? []).map((s) => s.id));
  const pool = await prisma.source.findMany({ where: { enabled: true, type: { not: "structured" } }, select: { id: true, country: true, sourceRole: true, independenceClass: true, claimPolicy: true, perspective: true, lastSuccessfulIngestion: true } });
  const dedicated = (s: (typeof pool)[number]) => linkedIds.has(s.id) || (!!s.country && fighting.includes(s.country.toUpperCase())) || (coverageIds.has(s.id) && !!s.country);
  const relevant = pool.filter((s) => dedicated(s) || !s.country).map((s) => ({ ...s, dedicated: dedicated(s) }));
  const verdict = coverageVerdict(c.shortName ?? c.name, relevant, { now, staleHours: STALE_SOURCE_HOURS, gaps: detail.coverage && detail.coverage.health !== "healthy" && detail.coverage.health !== "inactive" ? 1 : 0 });

  // ---- current situation (facts only) ----
  const situation: string[] = [];
  const within = (at: string, ms: number) => now.getTime() - new Date(at).getTime() <= ms;
  const active = ["active", "reduced"].includes(c.status);
  const recent7 = eventItems.filter((e) => within(e.occurredAt, 7 * DAY) && !e.isPartyClaim);
  const countryOfEvent = new Map(events.map((x) => [`event:${x.id}`, x.countryCode]));
  const eventCountries = [...new Set(recent7.map((e) => countryOfEvent.get(e.id)).filter((x): x is string => !!x))];
  if (!active) situation.push(`Registry status: ${detail.statusLabel.toLowerCase()}.`);
  else if (recent7.length) situation.push(`Fighting reported in the past 7 days in ${eventCountries.length ? eventCountries.map(name).join(", ") : "an unspecified location"} (${recent7.length} published incident${recent7.length === 1 ? "" : "s"}).`);
  else situation.push(`Registry status ${detail.statusLabel.toLowerCase()}; no published incident in the past 7 days.`);
  if (c.fullScaleWar) situation.push(`Classified as a full-scale war in ${fighting.map(name).join(", ")}.`);
  const terr7 = detail.territorialChanges.filter((ch) => within(ch.observedAt ?? ch.reviewedAt ?? "1970-01-01", 7 * DAY));
  if (terr7.length) situation.push(`${terr7.length} approved territorial change${terr7.length === 1 ? "" : "s"} in the past 7 days.`);
  if (datasets.length) situation.push(`Reported territorial data: ${datasets.map((d) => `${d.name} (${d.typeLabel.toLowerCase()})`).join("; ")}.`);
  const m24 = brief24.developments.filter((d) => !d.isPartyClaim).length;
  situation.push(m24 ? `${m24} meaningful development${m24 === 1 ? "" : "s"} in the past 24 h.` : "No meaningful development in the past 24 h.");
  const esc = brief7.escalation.find((e) => e.conflictSlug === slug);
  if (esc && esc.trend !== "stable") situation.push(`Trend over 7 days: ${esc.trend} (from recorded incidents and state changes, not reporting volume).`);
  if (confScore) situation.push(`Evidence confidence ${confScore.confidenceScore}/100: ${rollup.corroborated} of ${rollup.events30d - rollup.partyOnly} incidents in 30 days have two or more independent source groups.`);
  const lastTimes = [...eventItems.map((e) => e.occurredAt), ...detail.territorialChanges.map((ch) => ch.observedAt ?? ch.reviewedAt ?? "")].filter(Boolean).sort();
  const lastMeaningfulUpdate = lastTimes.at(-1) ?? null;
  if (lastMeaningfulUpdate) situation.push(`Last meaningful update: ${new Date(lastMeaningfulUpdate).toISOString().slice(0, 16).replace("T", " ")} UTC.`);

  return {
    detail,
    generatedAt: now.toISOString(),
    scores: {
      severity: { value: sev?.severityScore ?? null, label: SEVERITY_LABEL[c.severity] ?? c.severity, reasons: sev?.reasons ?? [], explanation: "Severity is the intensity of the conflict itself (registry classification, intensity, trend, recorded incidents). It does not depend on any country or on how much it is reported." },
      confidence: { value: confScore?.confidenceScore ?? null, label: null, reasons: confScore?.reasons ?? [], explanation: "Confidence is the quality of the evidence behind Vigil's picture: independent source groups and corroboration. Party claims and repeats never raise it. It says nothing about severity.", rollup },
      impact: { explanation: "Impact is how much this conflict reaches a given country (central impact model). Fighting inside the country = 100 for a full-scale war; fighting in a directly bordering country = at least 75. Participants and supporters get no floor.", byCountry },
    },
    currentSituation: situation,
    lastMeaningfulUpdate,
    feed,
    reportCounts: { "24H": counts24.conflicts[c.id] ?? 0, "7D": counts7.conflicts[c.id] ?? 0, "30D": counts30.conflicts[c.id] ?? 0 },
    geography: detail.geography,
    territory: { datasets },
    actors,
    belligerentStates: detail.geography.participants,
    externalSupporters: detail.geography.supporters,
    relatedCountries: { fightingInside, bordering, other },
    infrastructure,
    timeline: timeline.slice(0, 40),
    whatChanged,
    sourceCoverage: { ...verdict, health: detail.coverage?.health ?? null },
    brief: { headline: brief24.headline },
    mapHref: worldFocus(focusLat, focusLng, focusZoom, { conflict: slug, ...(datasets.length ? { territory: "1" } : {}) }),
    meta: { computeMs: Date.now() - started },
  };
}

function fightingReason(e: ImpactEntry | undefined): string {
  if (!e) return "Fighting recorded inside the country";
  return e.hardFloor === "own_country_war" ? "Full-scale war inside the country (hard rule: 100)" : "Fighting recorded inside the country (not a full-scale war: no hard floor)";
}

async function actorsFor(conflictId: string): Promise<ConflictActorView[]> {
  const units = await prisma.militaryUnit.findMany({
    where: { OR: [{ primaryConflictId: conflictId }, { conflictLinks: { some: { conflictId } } }] },
    select: { id: true, name: true, entityType: true, unitType: true, branch: true, country: true, sourceName: true, primaryConflictId: true, conflictLinks: { where: { conflictId }, select: { role: true, sourceName: true, confidence: true } }, commandersCurrent: { select: { id: true, name: true, rank: true } } },
    orderBy: { name: "asc" },
    take: 60,
  });
  const ids = units.map((u) => u.id);
  const lastEvent = ids.length ? await prisma.militaryUnitEvent.findMany({ where: { unitId: { in: ids }, event: { published: true } }, select: { unitId: true, event: { select: { occurredAt: true } } }, orderBy: { event: { occurredAt: "desc" } }, take: 400 }) : [];
  const observed = new Map<string, Date>();
  for (const l of lastEvent) if (!observed.has(l.unitId)) observed.set(l.unitId, l.event.occurredAt);
  return units.map((u) => {
    const link = u.conflictLinks[0];
    const type = u.entityType && isEntityType(u.entityType) ? u.entityType : null;
    return {
      id: u.id,
      name: u.name,
      href: entityHref("unit", u.id, u.entityType),
      typeLabel: type ? ENTITY_TYPE_LABEL[type] : (u.unitType ?? u.branch ?? null),
      role: link?.role ? link.role.replace(/_/g, " ") : u.primaryConflictId === conflictId ? "primary conflict" : "linked",
      relationship: link ? `Recorded ${link.role.replace(/_/g, " ")} in this conflict` : "Primary conflict recorded on the actor",
      provenance: link?.sourceName ?? u.sourceName ?? null,
      confidence: link?.confidence ?? null,
      lastObservedAt: iso(observed.get(u.id)),
      commanders: u.commandersCurrent.map((cm) => ({ id: cm.id, name: cm.name, rank: cm.rank, href: entityHref("commander", cm.id) })),
    };
  }).sort((a, b) => (b.lastObservedAt ?? "").localeCompare(a.lastObservedAt ?? "") || a.name.localeCompare(b.name));
}
