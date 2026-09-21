import { gazetteerLookup } from "@/lib/geocoding/gazetteer";
import { LOCATION_PRECISIONS, type LocationPrecision } from "@/lib/types/db";

// Location precision vocabulary (exact / approximate / area_level / unknown),
// modeled on ACLED's geo_precision. The rule everywhere: a coordinate is only
// ever attached when a real gazetteer/admin source supplied one, and an
// area-level or unknown claim NEVER receives a point coordinate.

export function toLocationPrecision(value: string | null | undefined): LocationPrecision {
  return (LOCATION_PRECISIONS as readonly string[]).includes(value ?? "") ? (value as LocationPrecision) : "unknown";
}

export const PRECISION_LABEL: Record<LocationPrecision, string> = {
  exact: "Exact",
  approximate: "Approximate",
  city: "City",
  region: "Region",
  country: "Country",
  area_level: "Area-level",
  unknown: "Unknown",
};

const AREA_WORDS = new Set(["region", "state", "province", "oblast", "district", "county", "area", "township", "governorate", "division"]);

export interface ResolvedLocation {
  precision: LocationPrecision;
  lat: number | null;
  lng: number | null;
}

/** A named place with an explicit administrative-area suffix ("Sagaing
 * Region") is area-level; a name the gazetteer resolves to exactly one
 * place is approximate (a settlement centroid, not the reported spot);
 * anything else stays unknown with no coordinates. */
export function resolveLocationPrecision(name: string, areaSuffix?: string | null): ResolvedLocation {
  if (areaSuffix && AREA_WORDS.has(areaSuffix.toLowerCase())) return { precision: "area_level", lat: null, lng: null };
  const hits = gazetteerLookup(name);
  if (hits.length === 1) return { precision: "approximate", lat: hits[0]!.lat, lng: hits[0]!.lng };
  return { precision: "unknown", lat: null, lng: null };
}

/** Whether a precision supports point-in-polygon comparison against
 * territory. Only a point that is at least approximate is compared. */
export function hasComparablePoint(precision: LocationPrecision, lat: number | null, lng: number | null): boolean {
  return (precision === "exact" || precision === "approximate") && lat !== null && lng !== null;
}
