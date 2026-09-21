import type { LocationScope } from "@/lib/types/db";

// What the review form asks for at each geographic scope. Coordinates are mandatory ONLY for an exact point; a
// country-level, global or unknown report has no map point at all. Shared by the form and by tests.

export type CoordinateRule = "required" | "optional" | "none";

export interface ScopeRule {
  country: boolean;
  adminRegion: boolean;
  city: boolean;
  coordinates: CoordinateRule;
  /** Precision the scope implies (a point lets the reviewer choose exact / approximate). */
  precision: "country" | "region" | "city" | "exact" | "unknown";
  hint: string;
}

export const SCOPE_RULES: Record<LocationScope, ScopeRule> = {
  global: { country: false, adminRegion: false, city: false, coordinates: "none", precision: "unknown", hint: "Worldwide news: no country and no map point." },
  country: { country: true, adminRegion: false, city: false, coordinates: "none", precision: "country", hint: "Country-level news: it belongs to the country, not to a place on the map, so no marker is created." },
  region: { country: true, adminRegion: true, city: false, coordinates: "optional", precision: "region", hint: "Only the region is known. If the region has a canonical centroid it is used to place the report, and it is labelled as the region, not the incident point." },
  city: { country: true, adminRegion: false, city: true, coordinates: "optional", precision: "city", hint: "Only the city is known. City coordinates are resolved automatically when the city is in the gazetteer; the marker is labelled as approximate." },
  point: { country: false, adminRegion: false, city: false, coordinates: "required", precision: "exact", hint: "An exact site or address. Latitude and longitude are required." },
  unknown: { country: false, adminRegion: false, city: false, coordinates: "none", precision: "unknown", hint: "No reliable location. The report stays publishable, with no map point." },
};

export interface LocationDraftFields {
  locationScope: LocationScope;
  countryCode: string;
  adminRegion: string;
  city: string;
  latitude: string;
  longitude: string;
}

/** The first thing missing for the chosen scope, or null when the location part of the form is complete. */
export function locationDraftError(d: LocationDraftFields): string | null {
  const rule = SCOPE_RULES[d.locationScope];
  if (rule.country && !d.countryCode.trim()) return "Choose the country for this scope.";
  if (rule.adminRegion && !d.adminRegion.trim()) return "Region scope needs the region (oblast / province / state).";
  if (rule.city && !d.city.trim()) return "City scope needs the city.";
  if (rule.coordinates === "required") {
    const lat = Number(d.latitude);
    const lng = Number(d.longitude);
    if (d.latitude.trim() === "" || d.longitude.trim() === "" || !Number.isFinite(lat) || !Number.isFinite(lng)) return "An exact point needs latitude and longitude.";
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return "Coordinates are out of range.";
  }
  return null;
}
