import { prisma } from "@/lib/db/client";
import type { HazardProvider, NormalizedGlobalEvent, ProviderContext, ProviderResult } from "../types";
import { CAP_SEVERITY_VALUE, capProminence } from "../significance";

// US National Weather Service alerts API (CAP-derived GeoJSON). Public domain, keyless; NWS asks for
// an identifying User-Agent and publishes no fixed rate limit (limits are "generous but not
// unlimited"; 429/Retry-After is honoured by the poller). The active feed regenerates within
// seconds; a 10 minute cadence is ample. Each alert has a stable CAP id, an `expires` time and (when
// replaced) `references` to the alerts it supersedes. Coverage is United States only — global
// cyclone/flood alerts come from GDACS.
// https://www.weather.gov/documentation/services-web-api
export const NWS_ALERTS_URL = "https://api.weather.gov/alerts/active?status=actual&message_type=alert";
export const NWS_HEADERS = { "User-Agent": "Vigil/1.0 (public intelligence map; atte.e.moilanen@gmail.com)", Accept: "application/geo+json" };

/** Minor/Unknown alerts are routine advisories; only Moderate and above reach the map. */
const MIN_SEVERITY = "Moderate";
/** Zone geometry lookups per poll, so a busy alert day cannot hammer the API. */
const ZONE_FETCH_BUDGET = 20;
const MAX_ZONES_PER_ALERT = 12;

interface CapProps {
  id: string;
  areaDesc?: string;
  affectedZones?: string[];
  references?: { identifier?: string; "@id"?: string }[];
  sent?: string;
  effective?: string;
  onset?: string;
  expires?: string;
  ends?: string | null;
  status?: string;
  messageType?: string;
  severity: string;
  certainty?: string;
  urgency?: string;
  event: string;
  senderName?: string;
  headline?: string | null;
  description?: string | null;
  instruction?: string | null;
  response?: string | null;
  "@id"?: string;
}
interface CapFeature {
  id?: string;
  geometry: GeoJSON.Geometry | null;
  properties: CapProps;
}

const round = (n: number) => Math.round(n * 100) / 100;
function roundCoords(c: unknown): unknown {
  return Array.isArray(c) ? (typeof c[0] === "number" ? (c as number[]).map(round) : c.map(roundCoords)) : c;
}

function polygonsOf(g: GeoJSON.Geometry | null): number[][][][] {
  if (!g) return [];
  if (g.type === "Polygon") return [g.coordinates as number[][][]];
  if (g.type === "MultiPolygon") return g.coordinates as number[][][][];
  return [];
}

function boundsOf(polys: number[][][][]): { bbox: [number, number, number, number]; lat: number; lng: number } | null {
  let minLng = 180, minLat = 90, maxLng = -180, maxLat = -90;
  let any = false;
  for (const poly of polys) for (const ring of poly) for (const [lng, lat] of ring) {
    any = true;
    minLng = Math.min(minLng, lng!);
    maxLng = Math.max(maxLng, lng!);
    minLat = Math.min(minLat, lat!);
    maxLat = Math.max(maxLat, lat!);
  }
  return any ? { bbox: [minLng, minLat, maxLng, maxLat], lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 } : null;
}

export function normalizeCapAlert(f: CapFeature, geometry: GeoJSON.Geometry | null): NormalizedGlobalEvent | null {
  const p = f.properties;
  const polys = polygonsOf(geometry);
  const b = boundsOf(polys);
  if (!p?.id || !b) return null;
  const sent = p.sent ? new Date(p.sent) : new Date(p.effective ?? Date.now());
  const effective = p.effective ? new Date(p.effective) : p.onset ? new Date(p.onset) : sent;
  const expiresRaw = p.expires ?? p.ends;
  const shown = polys.length === 1 ? ({ type: "Polygon", coordinates: roundCoords(polys[0]) } as GeoJSON.Polygon) : ({ type: "MultiPolygon", coordinates: roundCoords(polys) } as GeoJSON.MultiPolygon);
  return {
    origin: "official_alert",
    category: "weather_alert",
    layer: "weather",
    subtype: p.event,
    provider: "nws_alerts",
    providerEventId: p.id,
    title: p.event,
    description: [p.headline, p.description].filter(Boolean).join("\n\n").slice(0, 2000) || null,
    severityDomain: "cap_severity",
    severityValue: CAP_SEVERITY_VALUE[p.severity] ?? null,
    severityLabel: p.severity,
    prominence: capProminence(p.severity, p.certainty),
    confidenceLabel: p.certainty ?? null,
    geometry: shown,
    lat: b.lat,
    lng: b.lng,
    bbox: b.bbox,
    locationPrecision: "area_level",
    observedAt: sent,
    providerUpdatedAt: sent,
    effectiveAt: effective,
    expiresAt: expiresRaw ? new Date(expiresRaw) : null,
    sourceUrl: p["@id"] ?? `https://api.weather.gov/alerts/${encodeURIComponent(p.id)}`,
    metadata: {
      issuingAuthority: p.senderName ?? null,
      alertType: p.event,
      severity: p.severity,
      certainty: p.certainty ?? null,
      urgency: p.urgency ?? null,
      response: p.response ?? null,
      areaDesc: p.areaDesc ?? null,
      messageType: p.messageType ?? null,
      instruction: p.instruction ? p.instruction.slice(0, 800) : null,
      references: (p.references ?? []).map((r) => r.identifier).filter(Boolean),
      standard: "CAP",
    },
  };
}

async function zoneGeometry(url: string, ctx: ProviderContext, budget: { left: number }): Promise<GeoJSON.Geometry | null> {
  const cached = await prisma.hazardZone.findUnique({ where: { id: url } });
  if (cached) return JSON.parse(cached.geometry) as GeoJSON.Geometry;
  if (budget.left <= 0) return null;
  budget.left -= 1;
  try {
    const feature = JSON.parse(await ctx.fetchText(url, { headers: NWS_HEADERS })) as { geometry?: GeoJSON.Geometry | null };
    const g = feature.geometry;
    if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) return null;
    const slim = { type: g.type, coordinates: roundCoords(g.coordinates) } as GeoJSON.Geometry;
    await prisma.hazardZone.upsert({ where: { id: url }, update: { geometry: JSON.stringify(slim) }, create: { id: url, geometry: JSON.stringify(slim) } });
    return slim;
  } catch {
    return null;
  }
}

/** Alerts often reference forecast zones instead of carrying a polygon: build one from the zones. */
async function geometryFor(f: CapFeature, ctx: ProviderContext, budget: { left: number }): Promise<GeoJSON.Geometry | null> {
  if (f.geometry) return f.geometry;
  const zones = (f.properties.affectedZones ?? []).slice(0, MAX_ZONES_PER_ALERT);
  const polys: number[][][][] = [];
  for (const z of zones) {
    const g = await zoneGeometry(z, ctx, budget);
    if (!g) return null; // incomplete area: try again next poll rather than draw a partial warning
    polys.push(...polygonsOf(g));
  }
  return polys.length ? { type: "MultiPolygon", coordinates: polys } : null;
}

export const nwsAlerts: HazardProvider = {
  key: "nws_alerts",
  label: "US National Weather Service alerts",
  defaultUrl: NWS_ALERTS_URL,
  pollIntervalMinutes: 10,
  layer: "weather",
  async fetch(ctx): Promise<ProviderResult> {
    const json = JSON.parse(await ctx.fetchText(ctx.url, { headers: NWS_HEADERS })) as { features?: CapFeature[] };
    const features = json.features ?? [];
    const floor = CAP_SEVERITY_VALUE[MIN_SEVERITY]!;
    const budget = { left: ZONE_FETCH_BUDGET };
    const events: NormalizedGlobalEvent[] = [];
    const supersedes: string[] = [];
    let pending = 0;
    // Strongest first, so a spent zone budget defers the least important alerts.
    const wanted = features.filter((f) => (CAP_SEVERITY_VALUE[f.properties?.severity] ?? 0) >= floor).sort((a, b) => (CAP_SEVERITY_VALUE[b.properties.severity] ?? 0) - (CAP_SEVERITY_VALUE[a.properties.severity] ?? 0));
    for (const f of wanted) {
      const geometry = await geometryFor(f, ctx, budget);
      const ev = normalizeCapAlert(f, geometry);
      if (!ev) {
        pending += 1;
        continue;
      }
      events.push(ev);
      for (const r of f.properties.references ?? []) if (r.identifier) supersedes.push(r.identifier);
    }
    return {
      events,
      snapshot: true,
      seenProviderIds: features.map((f) => f.properties?.id).filter(Boolean),
      supersedes,
      note: pending ? `${pending} alert(s) awaiting zone geometry` : undefined,
    };
  },
};
