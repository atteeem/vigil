// Live Global Data Layers: the shared vocabulary for structured, non-news events.

/** Where an event comes from. A satellite detection or an earthquake reading is never a news report. */
export const EVENT_ORIGINS = ["conflict_news", "official_alert", "sensor", "scientific_observation", "humanitarian", "infrastructure", "other"] as const;
export type EventOrigin = (typeof EVENT_ORIGINS)[number];

export const ORIGIN_LABEL: Record<EventOrigin, string> = {
  conflict_news: "News / conflict report",
  official_alert: "Official alert",
  sensor: "Sensor / satellite detection",
  scientific_observation: "Scientific observation",
  humanitarian: "Humanitarian monitor",
  infrastructure: "Infrastructure",
  other: "Other",
};

/** Map layers, one toggle each. */
export const HAZARD_LAYERS = ["earthquakes", "fires", "weather", "volcanoes"] as const;
export type HazardLayer = (typeof HAZARD_LAYERS)[number];

export const HAZARD_LAYER_LABEL: Record<HazardLayer, string> = {
  earthquakes: "Earthquakes",
  fires: "Fires",
  weather: "Weather",
  volcanoes: "Volcanoes",
};

export const HAZARD_CATEGORIES = ["earthquake", "thermal_detection", "confirmed_wildfire", "volcano", "weather_alert", "cyclone", "flood"] as const;
export type HazardCategory = (typeof HAZARD_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<HazardCategory, string> = {
  earthquake: "Earthquake",
  thermal_detection: "Thermal anomaly",
  confirmed_wildfire: "Wildfire",
  volcano: "Volcano",
  weather_alert: "Weather alert",
  cyclone: "Tropical cyclone",
  flood: "Flood",
};

/** Named severity scales; deliberately separate from the conflict severity scale. */
export const SEVERITY_DOMAINS = ["earthquake_magnitude", "fire_radiative_power_mw", "cap_severity", "volcano_alert_level", "gdacs_alert_level", "wildfire_area_acres"] as const;
export type SeverityDomain = (typeof SEVERITY_DOMAINS)[number];

export type LocationPrecision = "exact" | "approximate" | "area_level" | "unknown";

/** What a provider adapter hands to the store: one observation, normalised, not yet persisted. */
export interface NormalizedGlobalEvent {
  origin: EventOrigin;
  category: HazardCategory;
  layer: HazardLayer;
  subtype?: string | null;
  provider: string;
  providerEventId: string;
  title: string;
  description?: string | null;
  severityDomain?: SeverityDomain | null;
  severityValue?: number | null;
  severityLabel?: string | null;
  prominence: number;
  confidenceLabel?: string | null;
  confidenceValue?: number | null;
  /** GeoJSON geometry for area events; omitted for points. */
  geometry?: GeoJSON.Geometry | null;
  lat: number;
  lng: number;
  bbox?: [number, number, number, number] | null; // [minLng, minLat, maxLng, maxLat]
  locationPrecision?: LocationPrecision;
  observedAt: Date;
  providerUpdatedAt?: Date | null;
  effectiveAt?: Date | null;
  expiresAt?: Date | null;
  endedAt?: Date | null;
  sourceUrl?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface ProviderResult {
  events: NormalizedGlobalEvent[];
  /** True when `events` is the provider's COMPLETE current set: active events absent from it were withdrawn. */
  snapshot: boolean;
  /** Every provider event id present in the feed (defaults to `events`); protects entries the adapter skipped this poll from being treated as withdrawn. */
  seenProviderIds?: string[];
  /** Provider event ids the feed says are replaced by newer messages (CAP "references"). */
  supersedes?: string[];
  /** Provider-specific note for the ingestion log (e.g. "3 zones unresolved"). */
  note?: string;
}

export interface ProviderContext {
  /** URL to fetch: the source's feedUrl, else the provider default. */
  url: string;
  now: Date;
  fetchText: (url: string, init?: { headers?: Record<string, string> }) => Promise<string>;
}

export interface HazardProvider {
  key: string;
  label: string;
  defaultUrl: string;
  /** Sensible cadence: the provider's own update rhythm, never more often. */
  pollIntervalMinutes: number;
  layer: HazardLayer;
  fetch(ctx: ProviderContext): Promise<ProviderResult>;
}
