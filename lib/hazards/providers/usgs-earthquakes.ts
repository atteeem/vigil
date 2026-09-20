import type { HazardProvider, NormalizedGlobalEvent, ProviderResult } from "../types";
import { earthquakeProminence } from "../significance";

// USGS Earthquake Hazards Program GeoJSON summary feeds. Public domain (US Government work);
// keyless; feeds regenerate about every minute; each event has a stable `id` and an `updated`
// timestamp that moves when the solution is revised (automatic -> reviewed, magnitude update).
// https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php
export const USGS_EARTHQUAKE_URL = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson";

interface UsgsFeature {
  id: string;
  geometry: { type: string; coordinates: number[] };
  properties: {
    mag: number | null;
    place: string | null;
    time: number;
    updated: number;
    url: string | null;
    tsunami?: number | null;
    sig?: number | null;
    alert?: string | null;
    status?: string | null;
    felt?: number | null;
    cdi?: number | null;
    mmi?: number | null;
    magType?: string | null;
    net?: string | null;
    type?: string | null;
  };
}

export function parseUsgsEarthquakes(json: unknown): NormalizedGlobalEvent[] {
  const features = ((json as { features?: UsgsFeature[] })?.features ?? []) as UsgsFeature[];
  const out: NormalizedGlobalEvent[] = [];
  for (const f of features) {
    const p = f.properties;
    const [lng, lat, depth] = f.geometry?.coordinates ?? [];
    if (!f.id || p?.mag == null || typeof lat !== "number" || typeof lng !== "number") continue;
    if (p.type && p.type !== "earthquake") continue; // quarry blasts, explosions etc. are not earthquakes
    const reviewed = p.status === "reviewed";
    out.push({
      origin: "scientific_observation",
      category: "earthquake",
      layer: "earthquakes",
      provider: "usgs_earthquakes",
      providerEventId: f.id,
      title: `M${p.mag.toFixed(1)} Earthquake`,
      description: p.place ?? null,
      severityDomain: "earthquake_magnitude",
      severityValue: p.mag,
      severityLabel: `M${p.mag.toFixed(1)}`,
      prominence: earthquakeProminence(p.mag, p.sig),
      confidenceLabel: reviewed ? "Reviewed solution" : p.status === "automatic" ? "Automatic solution" : null,
      lat,
      lng,
      locationPrecision: "exact",
      observedAt: new Date(p.time),
      providerUpdatedAt: new Date(p.updated),
      sourceUrl: p.url ?? `https://earthquake.usgs.gov/earthquakes/eventpage/${f.id}`,
      metadata: {
        place: p.place,
        depthKm: typeof depth === "number" ? depth : null,
        tsunami: p.tsunami === 1,
        significance: p.sig ?? null,
        pagerAlert: p.alert ?? null,
        status: p.status ?? null,
        magnitudeType: p.magType ?? null,
        network: p.net ?? null,
        feltReports: p.felt ?? null,
        mmi: p.mmi ?? null,
      },
    });
  }
  return out;
}

export const usgsEarthquakes: HazardProvider = {
  key: "usgs_earthquakes",
  label: "USGS Earthquake Hazards Program",
  defaultUrl: USGS_EARTHQUAKE_URL,
  pollIntervalMinutes: 5,
  layer: "earthquakes",
  async fetch(ctx): Promise<ProviderResult> {
    const text = await ctx.fetchText(ctx.url);
    return { events: parseUsgsEarthquakes(JSON.parse(text)), snapshot: false };
  },
};
