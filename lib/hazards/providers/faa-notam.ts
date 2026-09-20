import type { HazardProvider, NormalizedGlobalEvent, ProviderResult } from "../types";
import { airspaceProminence, airportProminence } from "../significance";
import { findAirport } from "../reference";

// FAA NOTAM API (api.faa.gov / external-api.faa.gov): the FAA public NOTAM distribution, used here ONLY
// for civil operational status — airport closures and airspace restrictions/closures/warnings.
//
// ACCESS: requires a free client id + secret from the FAA API portal (sent as `client_id` /
// `client_secret` headers). NOT verified live in this build (no credentials were available): the
// adapter follows the documented response shape and is fixture-tested. The source is seeded DISABLED
// and stays idle, reporting "credentials not configured", until FAA_NOTAM_CLIENT_ID and
// FAA_NOTAM_CLIENT_SECRET are set. Rate limits are per client; the poller honours Retry-After.
//
// Deliberately absent: aircraft positions, routes, sortie patterns or any military/government aircraft
// tracking. NOTAMs describe airspace and airports, not aircraft.
export const FAA_NOTAM_URL = "https://external-api.faa.gov/notamapi/v1/notams?pageSize=200&sortBy=effectiveStartDate&sortOrder=Desc";

interface NotamCore {
  id?: string;
  number?: string;
  issued?: string;
  effectiveStart?: string;
  effectiveEnd?: string;
  icaoLocation?: string;
  location?: string;
  text?: string;
  lastUpdated?: string;
  selectionCode?: string;
}
interface NotamItem {
  properties?: { coreNOTAMData?: { notam?: NotamCore } };
  geometry?: GeoJSON.Geometry | null;
}

/** "4046N07356W005" (Q-line centre + radius in NM) -> centre and radius km. */
export function parseQLineCircle(text: string): { lat: number; lng: number; radiusKm: number } | null {
  const m = /(\d{2})(\d{2})([NS])(\d{3})(\d{2})([EW])(\d{3})/.exec(text);
  if (!m) return null;
  const lat = (Number(m[1]) + Number(m[2]) / 60) * (m[3] === "S" ? -1 : 1);
  const lng = (Number(m[4]) + Number(m[5]) / 60) * (m[6] === "W" ? -1 : 1);
  return { lat, lng, radiusKm: Number(m[7]) * 1.852 };
}

export function circlePolygon(lat: number, lng: number, radiusKm: number, steps = 24): GeoJSON.Polygon {
  const ring: number[][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    const dLat = (radiusKm / 111.32) * Math.sin(a);
    const dLng = (radiusKm / (111.32 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01))) * Math.cos(a);
    ring.push([Math.round((lng + dLng) * 1e4) / 1e4, Math.round((lat + dLat) * 1e4) / 1e4]);
  }
  return { type: "Polygon", coordinates: [ring] };
}

export function parseFaaNotams(json: unknown): NormalizedGlobalEvent[] {
  const items = ((json as { items?: NotamItem[] })?.items ?? []) as NotamItem[];
  const out: NormalizedGlobalEvent[] = [];
  for (const it of items) {
    const n = it.properties?.coreNOTAMData?.notam;
    if (!n?.id || !n.text) continue;
    const text = n.text.toUpperCase();
    const airportClosure = /\bAD AP CLSD\b|\bAP CLSD\b|AERODROME CLOSED/.test(text);
    const closure = /AIRSPACE.*CLSD|AIRSPACE CLOSED|\bAREA CLSD\b/.test(text);
    const restriction = /TEMPORARY FLIGHT RESTRICTION|\bTFR\b|QRTCA|\bRESTRICTED\b|\bPROHIBITED\b/.test(text);
    const warning = /\bWRN\b|WARNING|\bHAZARD\b/.test(text);
    if (!airportClosure && !closure && !restriction && !warning) continue; // routine NOTAMs (lighting, taxiways...) are noise
    const start = n.effectiveStart ? new Date(n.effectiveStart) : n.issued ? new Date(n.issued) : new Date();
    const end = n.effectiveEnd && !/PERM/i.test(n.effectiveEnd) ? new Date(n.effectiveEnd) : null;
    const updated = n.lastUpdated ? new Date(n.lastUpdated) : start;
    const icao = n.icaoLocation ?? n.location ?? null;
    const ap = findAirport(icao);
    const circle = parseQLineCircle(n.text) ?? null;
    const geometry = it.geometry && (it.geometry.type === "Polygon" || it.geometry.type === "MultiPolygon") ? it.geometry : circle ? circlePolygon(circle.lat, circle.lng, circle.radiusKm) : null;
    const common = { origin: "official_alert" as const, provider: "faa_notam", providerEventId: n.id, confidenceLabel: "Official NOTAM", observedAt: start, providerUpdatedAt: updated, effectiveAt: start, expiresAt: end, sourceUrl: `https://notams.aim.faa.gov/notamSearch/nsapp.html#/`, description: n.text.slice(0, 600), metadata: { notamNumber: n.number ?? null, icaoLocation: icao, authority: "US Federal Aviation Administration (NOTAM)", text: n.text.slice(0, 1200), qCode: /Q\)\s*[A-Z]{4}\/(Q[A-Z]{4})/.exec(n.text)?.[1] ?? null } };
    if (airportClosure && ap) {
      out.push({ ...common, category: "airport_status", layer: "aviation", subtype: "notam_closure", status: "closed", entityKey: ap.icao || ap.iata, countryCode: ap.country, title: ap.name, severityDomain: "airport_status", severityValue: 4, severityLabel: "closed", prominence: airportProminence("closed", ap.size, true), lat: ap.lat, lng: ap.lng, locationPrecision: "exact" });
      continue;
    }
    const centre = circle ?? (ap ? { lat: ap.lat, lng: ap.lng } : null);
    if (!centre) continue; // no location, no marker: never invented
    const type = closure ? "closure" : restriction ? "restriction" : "warning";
    out.push({
      ...common,
      category: "airspace_event",
      layer: "aviation",
      subtype: type,
      status: type,
      entityKey: icao ? `notam:${icao}` : null,
      countryCode: ap?.country ?? null,
      title: type === "closure" ? "Airspace closure" : type === "restriction" ? "Airspace restriction" : "Airspace warning",
      severityDomain: "airspace_status",
      severityValue: type === "closure" ? 3 : type === "restriction" ? 2 : 1,
      severityLabel: type,
      prominence: airspaceProminence(type),
      geometry,
      lat: centre.lat,
      lng: centre.lng,
      locationPrecision: geometry ? "area_level" : "approximate",
    });
  }
  return out;
}

export const faaNotam: HazardProvider = {
  key: "faa_notam",
  label: "FAA NOTAM API (airspace and airport notices)",
  defaultUrl: FAA_NOTAM_URL,
  pollIntervalMinutes: 15,
  layer: "aviation",
  credentials: { env: ["FAA_NOTAM_CLIENT_ID", "FAA_NOTAM_CLIENT_SECRET"], signup: "https://api.faa.gov/" },
  async fetch(ctx): Promise<ProviderResult> {
    const env = ctx.env ?? process.env;
    const text = await ctx.fetchText(ctx.url, { headers: { client_id: env.FAA_NOTAM_CLIENT_ID ?? "", client_secret: env.FAA_NOTAM_CLIENT_SECRET ?? "" } });
    // The query returns a recent window, not the complete active set: expiry ends events, absence does not.
    return { events: parseFaaNotams(JSON.parse(text)), snapshot: false };
  },
};
