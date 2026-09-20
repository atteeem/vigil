import type { HazardProvider, NormalizedGlobalEvent, ProviderContext, ProviderResult } from "../types";
import { volcanoProminence } from "../significance";

// NASA EONET v3 (Earth Observatory Natural Event Tracker): curated natural events, each citing its
// own upstream source. NASA open data, keyless. Two categories are used:
//   wildfires -> confirmed_wildfire  (incident reports from agency systems such as IRWIN/InciWeb —
//                                     a reported incident, distinct from a raw satellite detection)
//   volcanoes -> volcano activity    (Smithsonian Global Volcanism Program / USGS weekly reports)
// https://eonet.gsfc.nasa.gov/docs/v3
export const EONET_WILDFIRES_URL = "https://eonet.gsfc.nasa.gov/api/v3/events?category=wildfires&status=open&limit=300";
export const EONET_VOLCANOES_URL = "https://eonet.gsfc.nasa.gov/api/v3/events?category=volcanoes&status=open&limit=300";

interface EonetGeometry {
  date: string;
  type: string;
  coordinates: number[] | number[][][];
  magnitudeValue?: number | null;
  magnitudeUnit?: string | null;
}
interface EonetEvent {
  id: string;
  title: string;
  description?: string | null;
  link?: string;
  closed?: string | null;
  categories?: { id: string }[];
  sources?: { id: string; url: string }[];
  geometry?: EonetGeometry[];
}

function centroidOf(g: EonetGeometry): { lat: number; lng: number; polygon: GeoJSON.Polygon | null; bbox: [number, number, number, number] } | null {
  if (g.type === "Point") {
    const [lng, lat] = g.coordinates as number[];
    if (typeof lat !== "number" || typeof lng !== "number") return null;
    return { lat, lng, polygon: null, bbox: [lng, lat, lng, lat] };
  }
  if (g.type === "Polygon") {
    const ring = (g.coordinates as number[][][])[0] ?? [];
    if (ring.length === 0) return null;
    const lngs = ring.map((c) => c[0]!);
    const lats = ring.map((c) => c[1]!);
    const bbox: [number, number, number, number] = [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
    return { lat: (bbox[1] + bbox[3]) / 2, lng: (bbox[0] + bbox[2]) / 2, polygon: { type: "Polygon", coordinates: g.coordinates as number[][][] }, bbox };
  }
  return null;
}

export function parseEonet(json: unknown, categoryId: "wildfires" | "volcanoes"): NormalizedGlobalEvent[] {
  const events = ((json as { events?: EonetEvent[] })?.events ?? []) as EonetEvent[];
  const out: NormalizedGlobalEvent[] = [];
  for (const e of events) {
    if (!(e.categories ?? []).some((c) => c.id === categoryId)) continue;
    const geoms = (e.geometry ?? []).filter((g) => !Number.isNaN(new Date(g.date).getTime())).sort((a, b) => a.date.localeCompare(b.date));
    const latest = geoms[geoms.length - 1];
    const earliest = geoms[0];
    const where = latest ? centroidOf(latest) : null;
    if (!e.id || !latest || !earliest || !where) continue;
    const upstream = e.sources?.[0];
    const closed = e.closed ? new Date(e.closed) : null;
    const base = {
      entityKey: categoryId === "volcanoes" ? e.id : null,
      provider: categoryId === "wildfires" ? "eonet_wildfires" : "eonet_volcanoes",
      providerEventId: e.id,
      lat: where.lat,
      lng: where.lng,
      bbox: where.bbox,
      geometry: where.polygon,
      observedAt: new Date(earliest.date),
      providerUpdatedAt: new Date(latest.date),
      endedAt: closed,
      sourceUrl: upstream?.url ?? e.link ?? null,
      description: e.description ?? null,
    };
    if (categoryId === "wildfires") {
      const acres = latest.magnitudeUnit === "acres" ? (latest.magnitudeValue ?? null) : null;
      out.push({
        ...base,
        origin: "official_alert",
        category: "confirmed_wildfire",
        layer: "fires",
        subtype: "incident_report",
        title: e.title,
        severityDomain: acres != null ? "wildfire_area_acres" : null,
        severityValue: acres,
        severityLabel: acres != null ? `${Math.round(acres).toLocaleString("en-US")} acres` : null,
        prominence: acres != null ? Math.min(100, Math.round(Math.log10(Math.max(acres, 1)) * 22)) : 30,
        locationPrecision: where.polygon ? "area_level" : "exact",
        metadata: { upstreamSource: upstream?.id ?? null, magnitudeValue: latest.magnitudeValue ?? null, magnitudeUnit: latest.magnitudeUnit ?? null, eonetUrl: e.link ?? null, observationCount: geoms.length },
      });
    } else {
      out.push({
        ...base,
        origin: "scientific_observation",
        category: "volcano",
        layer: "volcanoes",
        subtype: "activity_report",
        title: e.title,
        severityDomain: null,
        severityValue: null,
        severityLabel: null,
        prominence: volcanoProminence(null),
        locationPrecision: "exact",
        metadata: { upstreamSource: upstream?.id ?? null, eonetUrl: e.link ?? null, lastReportDate: latest.date },
      });
    }
  }
  return out;
}

function make(key: "eonet_wildfires" | "eonet_volcanoes", categoryId: "wildfires" | "volcanoes", label: string, url: string, layer: "fires" | "volcanoes", minutes: number): HazardProvider {
  return {
    key,
    label,
    defaultUrl: url,
    pollIntervalMinutes: minutes,
    layer,
    async fetch(ctx: ProviderContext): Promise<ProviderResult> {
      const json = JSON.parse(await ctx.fetchText(ctx.url));
      const events = parseEonet(json, categoryId);
      // A response below the requested limit is the COMPLETE open set: events no longer open were closed.
      const complete = ((json as { events?: unknown[] }).events ?? []).length < 300;
      return { events, snapshot: complete };
    },
  };
}

export const eonetWildfires = make("eonet_wildfires", "wildfires", "NASA EONET wildfire incidents", EONET_WILDFIRES_URL, "fires", 60);
export const eonetVolcanoes = make("eonet_volcanoes", "volcanoes", "NASA EONET volcano activity reports", EONET_VOLCANOES_URL, "volcanoes", 360);
