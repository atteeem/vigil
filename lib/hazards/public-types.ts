import type { HazardCategory, HazardLayer } from "./types";

/** Properties carried on every map feature: compact on purpose (the browser never gets raw rows). */
export interface HazardFeatureProps {
  id: string;
  layer: HazardLayer;
  /** Category, or "thermal_cluster" for a server-side aggregate of many detections. */
  kind: HazardCategory | "thermal_cluster";
  title: string;
  /** Domain-specific severity text ("M6.4", "Severe", "WATCH", "38 MW"). */
  label: string | null;
  /** Domain-specific numeric severity (magnitude, CAP level 0-4, alert level...). */
  value: number | null;
  prominence: number;
  /** A record the provider has not touched for long enough that it must not read as current. */
  stale: boolean;
  /** Provider-supplied confidence text, verbatim. */
  confidence: string | null;
  observedAt: string;
  /** Thermal aggregates only. */
  count?: number;
  maxFrp?: number | null;
  /** True when the detection is a satellite anomaly rather than a confirmed event. */
  unconfirmed?: boolean;
}

export interface HazardLayerHealth {
  layer: HazardLayer;
  /** Provider display names feeding this layer. */
  providers: string[];
  enabled: boolean;
  lastSuccessAt: string | null;
  lastError: string | null;
  /** No successful update within three poll intervals. */
  stale: boolean;
}

export interface HazardCollectionMeta {
  at: string | null;
  generatedAt: string;
  counts: Record<HazardLayer, number>;
  /** A layer hit the response cap: zoom in for the rest. */
  truncated: HazardLayer[];
  health: HazardLayerHealth[];
}

export type HazardCollection = GeoJSON.FeatureCollection<GeoJSON.Geometry, HazardFeatureProps> & { meta: HazardCollectionMeta };

export interface HazardDetail {
  id: string;
  origin: string;
  originLabel: string;
  category: HazardCategory;
  categoryLabel: string;
  layer: HazardLayer;
  subtype: string | null;
  title: string;
  description: string | null;
  provider: string;
  providerLabel: string;
  providerEventId: string;
  severity: { domain: string | null; value: number | null; label: string | null };
  prominence: number;
  confidence: { label: string | null; value: number | null };
  lat: number;
  lng: number;
  geometry: GeoJSON.Geometry | null;
  locationPrecision: string;
  observedAt: string;
  providerUpdatedAt: string | null;
  effectiveAt: string | null;
  expiresAt: string | null;
  endedAt: string | null;
  /** active | expired | withdrawn — as of the viewed moment. */
  status: "active" | "expired" | "withdrawn" | "stale";
  stale: boolean;
  sourceUrl: string | null;
  metadata: Record<string, unknown>;
  revision: number;
  revisionCount: number;
  trust: { label: string; scope: string | null } | null;
  /** The moment this view is reconstructed for (null = now). */
  asOf: string | null;
}
