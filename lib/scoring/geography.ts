import { distanceKm } from "@/lib/utils/geo";
import { landBorderPairs } from "@/lib/countries/registry";

// Central Conflict Scoring Engine v1 §3 — one centralized country-geography
// service: same-country detection, direct land-border adjacency, and a
// distance fallback. Country-level location (an ISO 3166-1 alpha-2 code +
// a representative lat/lng) is enough input; nothing here requires precise
// user coordinates.
//
// The adjacency CHECK is fully generic — `isDirectlyBordering` takes the
// dataset as a parameter (defaulting to the real one below) precisely so
// it is never Finland-specific: any caller (including tests) can build and
// pass its own small adjacency fixture via `buildAdjacency` and get
// identical behavior for made-up country codes.

export interface GeoPoint {
  lat: number;
  lng: number;
}

export type AdjacencyMap = ReadonlyMap<string, ReadonlySet<string>>;

/** Builds a symmetric adjacency map from a list of (possibly one-directional)
 * pairs — every pair is stored in both directions, since "A borders B"
 * always implies "B borders A". */
export function buildAdjacency(pairs: readonly (readonly [string, string])[]): AdjacencyMap {
  const map = new Map<string, Set<string>>();
  const add = (a: string, b: string) => {
    const key = a.toUpperCase();
    const other = b.toUpperCase();
    let set = map.get(key);
    if (!set) {
      set = new Set();
      map.set(key, set);
    }
    set.add(other);
  };
  for (const [a, b] of pairs) {
    add(a, b);
    add(b, a);
  }
  return map;
}

// Direct land borders come from the canonical country registry (lib/countries/registry.ts): every country,
// not just the ones the app first tracked. Island nations simply have no entries, which is accurate.
export const DEFAULT_ADJACENCY: AdjacencyMap = buildAdjacency(landBorderPairs());

export function isSameCountry(a: string, b: string): boolean {
  return a.toUpperCase() === b.toUpperCase();
}

export function isDirectlyBordering(a: string, b: string, adjacency: AdjacencyMap = DEFAULT_ADJACENCY): boolean {
  return adjacency.get(a.toUpperCase())?.has(b.toUpperCase()) ?? false;
}

/** Distance fallback (spec "distance fallback") for when two countries are
 * neither the same nor directly bordering — reuses the app's one existing
 * haversine implementation rather than a second distance formula. */
export function countryDistanceKm(a: GeoPoint, b: GeoPoint): number {
  return distanceKm(a, b);
}
