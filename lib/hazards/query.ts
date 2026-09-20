import type { GlobalEvent, GlobalEventRevision } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { sourceTrust } from "@/lib/sources/trust";
import { CATEGORY_LABEL, HAZARD_LAYERS, ORIGIN_LABEL, watchKeyFor, type EventOrigin, type HazardCategory, type HazardLayer } from "./types";
import { DISPLAY_WINDOW_HOURS, HOMEPAGE_PROMINENCE, energyProminence, isStaleHazard } from "./significance";
import { HAZARD_PROVIDERS } from "./registry";
import { THERMAL_RETENTION_DAYS } from "./store";
import type { HazardCollection, HazardDetail, HazardFeatureProps, HazardLayerHealth } from "./public-types";

// The read path for the map, timeline, detail panel, homepage and search. Everything is bounded
// (viewport, per-layer caps, server-side aggregation) — the browser is never sent raw observation
// tables — and everything is reconstructable "as of" a moment from provider revisions.

export interface HazardQuery {
  /** Reconstruct the world as of this moment; omit for live. */
  at?: Date | null;
  layers?: readonly HazardLayer[];
  /** [west, south, east, north] */
  bbox?: [number, number, number, number] | null;
  zoom?: number | null;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const LAYER_CAP: Record<HazardLayer, number> = { earthquakes: 800, fires: 1500, weather: 350, volcanoes: 300, aviation: 400, maritime: 300, energy: 400, internet: 250 };
/** Above this zoom individual thermal detections are returned; below it they are aggregated to cells. */
export const THERMAL_INDIVIDUAL_ZOOM = 7;

/** Volatile fields of a row as of a moment: the row itself when live, else the latest revision at/before it. */
interface State {
  status: string | null;
  title: string;
  description: string | null;
  severityDomain: string | null;
  severityValue: number | null;
  severityLabel: string | null;
  prominence: number;
  confidenceLabel: string | null;
  confidenceValue: number | null;
  geometry: string | null;
  lat: number;
  lng: number;
  expiresAt: Date | null;
  endedAt: Date | null;
  providerUpdatedAt: Date | null;
  metadata: string | null;
  sourceUrl: string | null;
  revision: number;
}

type Snap = Omit<State, "expiresAt" | "endedAt" | "providerUpdatedAt" | "revision"> & { expiresAt: string | null; endedAt: string | null; providerUpdatedAt: string | null };

function liveState(row: GlobalEvent): State {
  return { ...row };
}

function stateAt(row: GlobalEvent, revisions: GlobalEventRevision[], at: Date): State {
  if (revisions.length === 0) return liveState(row);
  const sorted = [...revisions].sort((a, b) => a.revision - b.revision);
  // A revision is "known" from the provider's own timestamp; a later revision that carries no newer
  // provider time (a re-measured status, a withdrawal stamped earlier) is known from when it was recorded.
  const knownAt: number[] = [];
  sorted.forEach((r, i) => {
    let t = (r.providerUpdatedAt ?? r.recordedAt).getTime();
    if (i > 0 && t <= knownAt[i - 1]!) t = Math.max(r.recordedAt.getTime(), knownAt[i - 1]! + 1);
    knownAt.push(t);
  });
  let idx = -1;
  knownAt.forEach((t, i) => {
    if (t <= at.getTime()) idx = i;
  });
  const chosen = sorted[idx === -1 ? 0 : idx]!;
  const s = JSON.parse(chosen.snapshot) as Snap;
  return { ...s, status: s.status ?? null, expiresAt: s.expiresAt ? new Date(s.expiresAt) : null, endedAt: s.endedAt ? new Date(s.endedAt) : null, providerUpdatedAt: s.providerUpdatedAt ? new Date(s.providerUpdatedAt) : null, revision: chosen.revision };
}

async function revisionsFor(rows: GlobalEvent[]): Promise<Map<string, GlobalEventRevision[]>> {
  const revised = rows.filter((r) => r.revision > 1).map((r) => r.id);
  const map = new Map<string, GlobalEventRevision[]>();
  if (revised.length === 0) return map;
  for (let i = 0; i < revised.length; i += 500) {
    for (const rev of await prisma.globalEventRevision.findMany({ where: { globalEventId: { in: revised.slice(i, i + 500) } } })) {
      (map.get(rev.globalEventId) ?? map.set(rev.globalEventId, []).get(rev.globalEventId)!).push(rev);
    }
  }
  return map;
}

/** Whether a (reconstructed) event is in force at T. Expiry and withdrawal both end it. */
function isActiveAt(s: State, at: Date): boolean {
  if (s.endedAt && s.endedAt.getTime() <= at.getTime()) return false;
  if (s.expiresAt && s.expiresAt.getTime() <= at.getTime()) return false;
  return true;
}

const propsOf = (row: GlobalEvent, s: State, at: Date): HazardFeatureProps => ({
  id: row.id,
  layer: row.layer as HazardLayer,
  kind: row.category as HazardCategory,
  title: s.title,
  label: s.severityLabel,
  value: s.severityValue,
  prominence: s.prominence,
  stale: isStaleHazard(row.category, s.providerUpdatedAt ?? row.observedAt, at.getTime()),
  confidence: s.confidenceLabel,
  observedAt: row.observedAt.toISOString(),
  status: s.status,
  entityKey: row.entityKey,
  ...(row.category === "thermal_detection" ? { unconfirmed: true } : {}),
});

const bboxWhere = (bbox: HazardQuery["bbox"]) =>
  bbox
    ? // Overlap test on the stored bounding box (points have min == max). A viewport crossing the antimeridian is passed as two queries by the caller.
      { maxLat: { gte: bbox[1] }, minLat: { lte: bbox[3] }, maxLng: { gte: bbox[0] }, minLng: { lte: bbox[2] } }
    : {};

function cellSize(zoom: number): number {
  return zoom < 3 ? 4 : zoom < 5 ? 2 : zoom < 6 ? 1 : 0.5;
}

async function thermalFeatures(at: Date, hist: boolean, bbox: HazardQuery["bbox"], zoom: number, now: Date, out: GeoJSON.Feature<GeoJSON.Geometry, HazardFeatureProps>[]): Promise<boolean> {
  const from = new Date(at.getTime() - (DISPLAY_WINDOW_HOURS.thermal_detection ?? 24) * HOUR);
  const retentionEdge = new Date(now.getTime() - THERMAL_RETENTION_DAYS * DAY);

  // Past the raw-retention window only the daily grid aggregates remain: served as cells.
  if (at < retentionEdge) {
    const day = at.toISOString().slice(0, 10);
    const aggs = await prisma.globalEventAggregate.findMany({ where: { category: "thermal_detection", day, ...(bbox ? { cellLat: { gte: bbox[1] - 1, lte: bbox[3] + 1 }, cellLng: { gte: bbox[0] - 1, lte: bbox[2] + 1 } } : {}) }, take: 2000 });
    for (const a of aggs) {
      out.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [a.cellLng, a.cellLat] },
        properties: { id: `agg-${a.id}`, layer: "fires", kind: "thermal_cluster", title: "Archived thermal detections", label: `${a.count}`, value: a.maxIntensity, prominence: Math.min(100, a.maxIntensity ?? 0), stale: false, confidence: null, observedAt: `${a.day}T12:00:00.000Z`, count: a.count, maxFrp: a.maxIntensity, unconfirmed: true },
      });
    }
    return false;
  }

  const where = { category: "thermal_detection", observedAt: { gt: from, lte: at }, ...bboxWhere(bbox) };
  if (zoom >= THERMAL_INDIVIDUAL_ZOOM) {
    const rows = await prisma.globalEvent.findMany({ where, orderBy: { prominence: "desc" }, take: LAYER_CAP.fires + 1 });
    for (const r of rows.slice(0, LAYER_CAP.fires)) out.push({ type: "Feature", geometry: { type: "Point", coordinates: [r.lng, r.lat] }, properties: propsOf(r, liveState(r), at) });
    return rows.length > LAYER_CAP.fires;
  }
  const size = cellSize(zoom);
  const rows = await prisma.globalEvent.findMany({ where, select: { lat: true, lng: true, severityValue: true }, take: 40_000 });
  const cells = new Map<string, { n: number; max: number; sumLat: number; sumLng: number }>();
  for (const r of rows) {
    const key = `${Math.floor(r.lat / size)}:${Math.floor(r.lng / size)}`;
    const c = cells.get(key) ?? { n: 0, max: 0, sumLat: 0, sumLng: 0 };
    c.n += 1;
    c.max = Math.max(c.max, r.severityValue ?? 0);
    c.sumLat += r.lat;
    c.sumLng += r.lng;
    cells.set(key, c);
  }
  let i = 0;
  for (const c of cells.values()) {
    out.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [c.sumLng / c.n, c.sumLat / c.n] },
      properties: { id: `cell-${zoom}-${i++}`, layer: "fires", kind: "thermal_cluster", title: `${c.n} thermal detections`, label: `${c.n}`, value: c.max, prominence: Math.min(100, c.max), stale: false, confidence: null, observedAt: at.toISOString(), count: c.n, maxFrp: c.max, unconfirmed: true },
    });
  }
  return false;
}

/** Zoom-dependent minimum prominence: only significant disruptions at world zoom, more detail as you zoom in. */
const minProminenceFor = (zoom: number) => (zoom < 3 ? 60 : zoom < 5 ? 35 : 0);
/** Energy events without exact coordinates sit at their country marker; zoomed out they collapse to one count per country. */
const ENERGY_INDIVIDUAL_ZOOM = 5;

async function statusLayerFeatures(layer: "aviation" | "maritime" | "energy" | "internet", at: Date, hist: boolean, bbox: HazardQuery["bbox"], zoom: number, out: GeoJSON.Feature<GeoJSON.Geometry, HazardFeatureProps>[]): Promise<boolean> {
  const rows = await prisma.globalEvent.findMany({
    // Energy rows are aggregated per country when zoomed out, so their threshold applies to the aggregate.
    where: { layer, observedAt: { gte: new Date(at.getTime() - 400 * DAY), lte: at }, ...(layer === "energy" && zoom < ENERGY_INDIVIDUAL_ZOOM ? {} : { prominence: { gte: minProminenceFor(zoom) } }), ...bboxWhere(bbox) },
    orderBy: { prominence: "desc" },
    take: LAYER_CAP[layer] * 3,
  });
  const revs = hist ? await revisionsFor(rows) : new Map<string, GlobalEventRevision[]>();
  let shown = 0;
  let truncated = false;
  const energyByCountry = new Map<string, { n: number; mw: number; lat: number; lng: number; max: number }>();
  for (const r of rows) {
    const s = hist ? stateAt(r, revs.get(r.id) ?? [], at) : liveState(r);
    if (!isActiveAt(s, at)) continue;
    // A status feed nobody has refreshed says nothing about NOW (long-lived maritime notices stay, flagged).
    const stale = isStaleHazard(r.category, s.providerUpdatedAt ?? r.observedAt, at.getTime());
    if (stale && r.category !== "maritime_incident") continue;
    if (layer === "energy" && zoom < ENERGY_INDIVIDUAL_ZOOM) {
      const key = r.countryCode ?? "??";
      const c = energyByCountry.get(key) ?? { n: 0, mw: 0, lat: s.lat, lng: s.lng, max: 0 };
      c.n += 1;
      c.mw += s.severityValue ?? 0;
      c.max = Math.max(c.max, s.prominence);
      energyByCountry.set(key, c);
      continue;
    }
    if (shown >= LAYER_CAP[layer]) {
      truncated = true;
      break;
    }
    shown += 1;
    const geometry = s.geometry ? (JSON.parse(s.geometry) as GeoJSON.Geometry) : ({ type: "Point", coordinates: [s.lng, s.lat] } as GeoJSON.Geometry);
    out.push({ type: "Feature", geometry, properties: propsOf(r, s, at) });
  }
  for (const [country, c] of energyByCountry) {
    const clusterProminence = c.mw > 0 ? energyProminence(c.mw, "outage") : c.max;
    if (clusterProminence < minProminenceFor(zoom)) continue; // world zoom: only significant aggregates
    out.push({ type: "Feature", geometry: { type: "Point", coordinates: [c.lng, c.lat] }, properties: { id: `energy-${country}`, layer: "energy", kind: "energy_cluster", title: `${c.n} energy disruption${c.n === 1 ? "" : "s"}`, label: c.mw ? `${Math.round(c.mw).toLocaleString("en-US")} MW` : `${c.n}`, value: c.mw, prominence: clusterProminence, stale: false, confidence: null, observedAt: at.toISOString(), status: null, entityKey: country, count: c.n } });
  }
  return truncated;
}

export async function queryHazards(q: HazardQuery = {}, now: Date = new Date()): Promise<HazardCollection> {
  const at = q.at ?? now;
  const hist = !!q.at;
  const layers = (q.layers?.length ? q.layers : HAZARD_LAYERS).filter((l): l is HazardLayer => (HAZARD_LAYERS as readonly string[]).includes(l));
  const zoom = q.zoom ?? 2;
  const features: GeoJSON.Feature<GeoJSON.Geometry, HazardFeatureProps>[] = [];
  const counts: Record<HazardLayer, number> = { earthquakes: 0, fires: 0, weather: 0, volcanoes: 0, aviation: 0, maritime: 0, energy: 0, internet: 0 };
  const truncated: HazardLayer[] = [];
  const add = (layer: HazardLayer, f: GeoJSON.Feature<GeoJSON.Geometry, HazardFeatureProps>) => {
    features.push(f);
    counts[layer] += 1;
  };

  if (layers.includes("earthquakes")) {
    const from = new Date(at.getTime() - (DISPLAY_WINDOW_HOURS.earthquake ?? 72) * HOUR);
    const rows = await prisma.globalEvent.findMany({ where: { category: "earthquake", observedAt: { gt: from, lte: at }, ...bboxWhere(q.bbox) }, orderBy: { prominence: "desc" }, take: LAYER_CAP.earthquakes + 1 });
    if (rows.length > LAYER_CAP.earthquakes) truncated.push("earthquakes");
    const revs = hist ? await revisionsFor(rows) : new Map<string, GlobalEventRevision[]>();
    for (const r of rows.slice(0, LAYER_CAP.earthquakes)) {
      const s = hist ? stateAt(r, revs.get(r.id) ?? [], at) : liveState(r);
      add("earthquakes", { type: "Feature", geometry: { type: "Point", coordinates: [s.lng, s.lat] }, properties: propsOf(r, s, at) });
    }
  }

  if (layers.includes("fires")) {
    const before = features.length;
    if (await thermalFeatures(at, hist, q.bbox, zoom, now, features)) truncated.push("fires");
    counts.fires += features.length - before;
    // Reported wildfire incidents: a separate, higher-confidence category from raw detections.
    const rows = await prisma.globalEvent.findMany({ where: { category: "confirmed_wildfire", observedAt: { lte: at }, ...bboxWhere(q.bbox) }, orderBy: { prominence: "desc" }, take: 400 });
    const revs = hist ? await revisionsFor(rows) : new Map<string, GlobalEventRevision[]>();
    for (const r of rows) {
      const s = hist ? stateAt(r, revs.get(r.id) ?? [], at) : liveState(r);
      if (!isActiveAt(s, at) || isStaleHazard(r.category, s.providerUpdatedAt ?? r.observedAt, at.getTime())) continue;
      add("fires", { type: "Feature", geometry: { type: "Point", coordinates: [s.lng, s.lat] }, properties: propsOf(r, s, at) });
    }
  }

  if (layers.includes("weather")) {
    // Country-scale alerts only when zoomed far out, so the world view is not carpeted.
    const minProminence = zoom < 3 ? 60 : zoom < 5 ? 35 : 0;
    const lookback = hist ? new Date(at.getTime() - 30 * DAY) : new Date(at.getTime() - 30 * DAY);
    const rows = await prisma.globalEvent.findMany({ where: { layer: "weather", observedAt: { gte: lookback, lte: at }, prominence: { gte: minProminence }, ...bboxWhere(q.bbox) }, orderBy: { prominence: "desc" }, take: LAYER_CAP.weather * 3 });
    const revs = hist ? await revisionsFor(rows) : new Map<string, GlobalEventRevision[]>();
    let shown = 0;
    for (const r of rows) {
      const s = hist ? stateAt(r, revs.get(r.id) ?? [], at) : liveState(r);
      if (!isActiveAt(s, at) || isStaleHazard(r.category, s.providerUpdatedAt ?? r.observedAt, at.getTime())) continue;
      if (shown >= LAYER_CAP.weather) {
        truncated.push("weather");
        break;
      }
      shown += 1;
      const geometry = s.geometry ? (JSON.parse(s.geometry) as GeoJSON.Geometry) : ({ type: "Point", coordinates: [s.lng, s.lat] } as GeoJSON.Geometry);
      add("weather", { type: "Feature", geometry, properties: propsOf(r, s, at) });
    }
  }

  if (layers.includes("volcanoes")) {
    const rows = await prisma.globalEvent.findMany({ where: { category: "volcano", observedAt: { lte: at }, ...bboxWhere(q.bbox) }, orderBy: { prominence: "desc" }, take: LAYER_CAP.volcanoes });
    const revs = hist ? await revisionsFor(rows) : new Map<string, GlobalEventRevision[]>();
    for (const r of rows) {
      const s = hist ? stateAt(r, revs.get(r.id) ?? [], at) : liveState(r);
      if (!isActiveAt(s, at)) continue;
      // Stale records are still returned, flagged: the UI must not present them as current activity.
      add("volcanoes", { type: "Feature", geometry: { type: "Point", coordinates: [s.lng, s.lat] }, properties: propsOf(r, s, at) });
    }
  }

  // v2 status layers: aviation, maritime, energy, internet share one bounded, zoom-dependent path.
  for (const layer of ["aviation", "maritime", "energy", "internet"] as const) {
    if (!layers.includes(layer)) continue;
    const before = features.length;
    if (await statusLayerFeatures(layer, at, hist, q.bbox, zoom, features)) truncated.push(layer);
    counts[layer] += features.length - before;
  }

  return { type: "FeatureCollection", features, meta: { at: q.at ? q.at.toISOString() : null, generatedAt: now.toISOString(), counts, truncated, health: await layerHealth(now) } };
}

/** Per-layer provider health from the Source rows (the same fields the news sources use). */
export async function layerHealth(now: Date = new Date()): Promise<HazardLayerHealth[]> {
  const sources = await prisma.source.findMany({ where: { type: "structured" } });
  return HAZARD_LAYERS.map((layer) => {
    const own = sources.filter((s) => s.platform && HAZARD_PROVIDERS[s.platform]?.layer === layer);
    const enabled = own.filter((s) => s.enabled);
    const last = enabled.map((s) => s.lastSuccessfulIngestion).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    const interval = Math.max(...enabled.map((s) => s.pollIntervalMinutes), 5);
    return {
      layer,
      providers: own.map((s) => s.name),
      enabled: enabled.length > 0,
      lastSuccessAt: last?.toISOString() ?? null,
      lastError: enabled.find((s) => s.lastError)?.lastError ?? null,
      stale: enabled.length > 0 && (!last || now.getTime() - last.getTime() > interval * 3 * 60_000),
    };
  });
}

export async function getHazardDetail(id: string, at: Date | null = null, now: Date = new Date()): Promise<HazardDetail | null> {
  const row = await prisma.globalEvent.findUnique({ where: { id }, include: { source: true, revisions: true, claims: { orderBy: { observedAt: "desc" } }, links: { where: { status: "confirmed" } } } });
  if (!row) return null;
  const when = at ?? now;
  if (row.observedAt.getTime() > when.getTime()) return null; // not yet observed at that moment
  const s = at ? stateAt(row, row.revisions, at) : liveState(row);
  const provider = HAZARD_PROVIDERS[row.provider];
  const stale = isStaleHazard(row.category, s.providerUpdatedAt ?? row.observedAt, when.getTime());
  const ended = s.endedAt && s.endedAt <= when;
  const expired = s.expiresAt && s.expiresAt <= when;
  const trust = row.source ? sourceTrust(row.source) : null;
  const conflictIds = row.links.map((l) => l.conflictId).filter((x): x is string => !!x);
  const conflicts = conflictIds.length ? await prisma.conflict.findMany({ where: { id: { in: conflictIds } }, select: { id: true, slug: true, name: true } }) : [];
  const claimsAsOf = row.claims.filter((c) => c.observedAt.getTime() <= when.getTime());
  return {
    id: row.id,
    origin: row.origin,
    originLabel: ORIGIN_LABEL[row.origin as EventOrigin] ?? row.origin,
    category: row.category as HazardCategory,
    categoryLabel: CATEGORY_LABEL[row.category as HazardCategory] ?? row.category,
    layer: row.layer as HazardLayer,
    subtype: row.subtype,
    title: s.title,
    description: s.description,
    provider: row.provider,
    providerLabel: provider?.label ?? row.provider,
    providerEventId: row.providerEventId,
    severity: { domain: s.severityDomain, value: s.severityValue, label: s.severityLabel },
    prominence: s.prominence,
    confidence: { label: s.confidenceLabel, value: s.confidenceValue },
    lat: s.lat,
    lng: s.lng,
    geometry: s.geometry ? (JSON.parse(s.geometry) as GeoJSON.Geometry) : null,
    locationPrecision: row.locationPrecision,
    observedAt: row.observedAt.toISOString(),
    providerUpdatedAt: s.providerUpdatedAt?.toISOString() ?? null,
    effectiveAt: row.effectiveAt?.toISOString() ?? null,
    expiresAt: s.expiresAt?.toISOString() ?? null,
    endedAt: s.endedAt?.toISOString() ?? null,
    status: ended ? "withdrawn" : expired ? "expired" : stale ? "stale" : "active",
    domainStatus: s.status,
    entityKey: row.entityKey,
    countryCode: row.countryCode,
    watchKey: watchKeyFor(row.category, row.entityKey),
    relatedConflicts: row.links.map((l) => ({ conflictId: l.conflictId, eventId: l.eventId, slug: conflicts.find((c) => c.id === l.conflictId)?.slug ?? null, name: conflicts.find((c) => c.id === l.conflictId)?.name ?? null, basis: l.basis, note: l.note })),
    claims: claimsAsOf.map((c) => ({ id: c.id, claimant: c.claimant, claimType: c.claimType, text: c.text, sourceName: c.sourceName, sourceUrl: c.sourceUrl, verification: c.verification, observedAt: c.observedAt.toISOString() })),
    stale,
    sourceUrl: s.sourceUrl,
    metadata: s.metadata ? (JSON.parse(s.metadata) as Record<string, unknown>) : {},
    revision: s.revision,
    revisionCount: row.revision,
    trust: trust ? { label: trust.label, scope: trust.authorityScope } : null,
    asOf: at ? at.toISOString() : null,
  };
}

// ---------------------------------------------------------------------------------------------
// Homepage / search
// ---------------------------------------------------------------------------------------------
export interface SignificantHazard {
  id: string;
  category: HazardCategory;
  layer: HazardLayer;
  title: string;
  subtitle: string;
  label: string | null;
  observedAt: string;
  prominence: number;
  stale: boolean;
}

const V1_SIGNIFICANT = ["earthquake", "cyclone", "flood", "volcano", "confirmed_wildfire", "weather_alert"];
const V2_STATUS = ["airport_status", "airspace_event", "port_disruption", "chokepoint_status", "maritime_incident", "energy_disruption", "internet_disruption"];

// A hazard-derived potential port impact duplicates the hazard already listed (and is not a confirmed status): map and search only.
const V2_HOMEPAGE = V2_STATUS.filter((c) => c !== "port_disruption");

const STATUS_WORDS: Record<string, string> = {
  closed: "closed",
  partially_closed: "partially closed",
  disrupted: "operational disruption",
  elevated_disruption: "elevated disruption",
  major_disruption: "major disruption",
  closed_restricted: "closed / restricted",
  outage: "outage",
  reduced_capacity: "reduced capacity",
  restored: "restored",
};

/** Headline for lists and search: what it is, without overclaiming. */
export function hazardListTitle(r: { category: string; title: string; severityLabel: string | null; status: string | null }): string {
  switch (r.category) {
    case "earthquake":
      return `${r.severityLabel} Earthquake`;
    case "airport_status":
      return `${r.title} — ${STATUS_WORDS[r.status ?? ""] ?? "disrupted"}`;
    case "chokepoint_status":
      return `${r.title}: ${STATUS_WORDS[r.status ?? ""] ?? r.status ?? "status"}`;
    default:
      return r.title;
  }
}

function listSubtitle(r: { category: string; description: string | null; metadata: string | null; provider: string; countryCode: string | null }): string {
  if (r.category === "earthquake") return r.description ?? r.provider;
  const m = JSON.parse(r.metadata ?? "{}") as { areaDesc?: string; country?: string };
  return m.areaDesc ?? m.country ?? (r.countryCode ? `${CATEGORY_LABEL[r.category as HazardCategory]} · ${r.countryCode}` : (CATEGORY_LABEL[r.category as HazardCategory] ?? r.provider));
}

/** Only genuinely notable, current events: never routine minor observations, thermal detections or party claims. */
export async function getSignificantHazards(limit = 6, now: Date = new Date()): Promise<SignificantHazard[]> {
  const rows = await prisma.globalEvent.findMany({
    where: {
      AND: [
        { prominence: { gte: HOMEPAGE_PROMINENCE }, endedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        // Natural hazards are recent by nature; a status (airport closed, chokepoint disrupted, blackout) stays newsworthy while it lasts.
        { OR: [{ category: { in: V1_SIGNIFICANT }, observedAt: { gte: new Date(now.getTime() - 7 * DAY) } }, { category: { in: V2_HOMEPAGE } }] },
      ],
    },
    orderBy: [{ prominence: "desc" }, { observedAt: "desc" }],
    take: limit * 4,
  });
  const out: SignificantHazard[] = [];
  for (const r of rows) {
    const stale = isStaleHazard(r.category, r.providerUpdatedAt ?? r.observedAt, now.getTime());
    if (stale) continue;
    if (r.category === "earthquake" && now.getTime() - r.observedAt.getTime() > 3 * DAY) continue;
    if (r.status === "normal" || r.status === "restored") continue;
    out.push({ id: r.id, category: r.category as HazardCategory, layer: r.layer as HazardLayer, title: hazardListTitle(r), subtitle: listSubtitle(r), label: r.severityLabel, observedAt: r.observedAt.toISOString(), prominence: r.prominence, stale });
    if (out.length >= limit) break;
  }
  return out;
}

/** Search hits: major earthquakes, named volcanoes, significant weather, disrupted airports, chokepoints and major current disruptions. Never thermal detections or a stream of routine observations. */
export async function searchHazards(query: string, limit = 4, now: Date = new Date()): Promise<SignificantHazard[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const magMatch = /^m?\s*(\d(?:\.\d)?)$/i.exec(q);
  const live = { endedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };
  const rows = await prisma.globalEvent.findMany({
    where: {
      OR: [
        { category: "volcano", title: { contains: q } },
        { category: "earthquake", prominence: { gte: 45 }, OR: [{ description: { contains: q } }, ...(/^(earthquake|quake)s?$/i.test(q) ? [{ prominence: { gte: 45 } }] : []), ...(magMatch ? [{ severityValue: { gte: Number(magMatch[1]), lt: Number(magMatch[1]) + 0.1 } }] : [])] },
        { category: { in: ["cyclone", "flood", "weather_alert", "confirmed_wildfire"] }, prominence: { gte: 55 }, ...live, title: { contains: q } },
        // v2: a disrupted airport by name / ICAO / IATA, every chokepoint by name, and major current disruptions.
        { category: "airport_status", prominence: { gte: 40 }, ...live, OR: [{ title: { contains: q } }, { entityKey: q.toUpperCase() }] },
        { category: "chokepoint_status", title: { contains: q } },
        { category: { in: ["port_disruption", "maritime_incident", "energy_disruption", "internet_disruption", "airspace_event"] }, prominence: { gte: 40 }, ...live, title: { contains: q } },
      ],
    },
    orderBy: [{ prominence: "desc" }, { observedAt: "desc" }],
    take: limit,
  });
  return rows.map((r) => ({ id: r.id, category: r.category as HazardCategory, layer: r.layer as HazardLayer, title: hazardListTitle(r), subtitle: r.category === "earthquake" ? (r.description ?? "USGS") : (CATEGORY_LABEL[r.category as HazardCategory] ?? r.category), label: r.severityLabel, observedAt: r.observedAt.toISOString(), prominence: r.prominence, stale: isStaleHazard(r.category, r.providerUpdatedAt ?? r.observedAt, now.getTime()) }));
}
