import type { HazardProvider, NormalizedGlobalEvent, ProviderResult } from "../types";
import { GDACS_LEVEL_VALUE, gdacsProminence } from "../significance";

// GDACS (Global Disaster Alert and Coordination System — EC Joint Research Centre / UN OCHA):
// a humanitarian monitor that scores tropical cyclones and floods worldwide (Green / Orange / Red)
// from national agency inputs (NOAA, JTWC, GloFAS). Public, keyless; the EVENTS4APP list holds the
// currently active events and is refreshed a few times a day. Attribution to GDACS is requested.
// https://www.gdacs.org/  (API: /gdacsapi/api/events/geteventlist/EVENTS4APP)
export const GDACS_EVENTS_URL = "https://www.gdacs.org/gdacsapi/api/events/geteventlist/EVENTS4APP";

interface GdacsFeature {
  geometry: { type: string; coordinates: number[] };
  bbox?: number[];
  properties: {
    eventtype: string;
    eventid: number;
    eventname?: string;
    name?: string;
    description?: string;
    alertlevel: string;
    iscurrent?: string;
    fromdate?: string;
    todate?: string;
    datemodified?: string;
    country?: string;
    source?: string;
    url?: { report?: string; details?: string };
    severitydata?: { severity?: number; severitytext?: string; severityunit?: string };
    alertscore?: number;
  };
}

const TYPES: Record<string, { category: "cyclone" | "flood"; label: string }> = {
  TC: { category: "cyclone", label: "Tropical cyclone" },
  FL: { category: "flood", label: "Flood" },
};

export function parseGdacs(json: unknown): NormalizedGlobalEvent[] {
  const features = ((json as { features?: GdacsFeature[] })?.features ?? []) as GdacsFeature[];
  const out: NormalizedGlobalEvent[] = [];
  for (const f of features) {
    const p = f.properties;
    const kind = TYPES[p?.eventtype];
    const [lng, lat] = f.geometry?.coordinates ?? [];
    if (!kind || typeof lat !== "number" || typeof lng !== "number" || p.iscurrent === "false") continue;
    const level = p.alertlevel;
    const parse = (v?: string) => (v ? new Date(v.endsWith("Z") ? v : `${v}Z`) : null);
    out.push({
      origin: "humanitarian",
      category: kind.category,
      layer: "weather",
      subtype: p.eventtype,
      countryCode: (p as { affectedcountries?: { iso2?: string }[] }).affectedcountries?.[0]?.iso2 ?? null,
      provider: "gdacs",
      providerEventId: `${p.eventtype}-${p.eventid}`,
      title: p.name ?? kind.label,
      description: p.severitydata?.severitytext?.trim() || p.description || null,
      severityDomain: "gdacs_alert_level",
      severityValue: GDACS_LEVEL_VALUE[level] ?? null,
      severityLabel: `${level} alert`,
      prominence: gdacsProminence(level),
      confidenceLabel: null,
      lat,
      lng,
      locationPrecision: kind.category === "cyclone" ? "approximate" : "area_level",
      observedAt: parse(p.fromdate) ?? new Date(),
      providerUpdatedAt: parse(p.datemodified),
      sourceUrl: p.url?.report ?? null,
      metadata: {
        gdacsAlertLevel: level,
        alertScore: p.alertscore ?? null,
        country: p.country || null,
        agency: p.source ?? null,
        severity: p.severitydata?.severity ?? null,
        severityText: p.severitydata?.severitytext?.trim() ?? null,
        severityUnit: p.severitydata?.severityunit ?? null,
        eventName: p.eventname || null,
        periodEnd: p.todate ?? null,
      },
    });
  }
  return out;
}

export const gdacs: HazardProvider = {
  key: "gdacs",
  label: "GDACS (cyclones and floods)",
  defaultUrl: GDACS_EVENTS_URL,
  pollIntervalMinutes: 60,
  layer: "weather",
  async fetch(ctx): Promise<ProviderResult> {
    return { events: parseGdacs(JSON.parse(await ctx.fetchText(ctx.url))), snapshot: true };
  },
};
