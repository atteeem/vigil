import { distanceKm } from "@/lib/utils/geo";

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

// Real-world direct land-border pairs (ISO 3166-1 alpha-2), covering every
// country this app currently tracks (lib/data/mock-countries.ts, seeded
// Prisma conflicts) plus their actual neighbors, so distance/adjacency
// reasoning is genuinely correct, not app-internal-only. Island nations
// with no land borders (Taiwan, Japan, UK aside from Ireland, ...) simply
// have few or no entries here — `isDirectlyBordering` correctly returns
// false for them, which is accurate, not a gap.
const WORLD_LAND_BORDERS: readonly (readonly [string, string])[] = [
  ["FI", "NO"], ["FI", "SE"], ["FI", "RU"],
  ["UA", "RU"], ["UA", "BY"], ["UA", "PL"], ["UA", "SK"], ["UA", "HU"], ["UA", "RO"], ["UA", "MD"],
  ["RU", "NO"], ["RU", "EE"], ["RU", "LV"], ["RU", "LT"], ["RU", "PL"], ["RU", "BY"], ["RU", "GE"], ["RU", "AZ"], ["RU", "KZ"], ["RU", "MN"], ["RU", "CN"], ["RU", "KP"],
  ["PL", "DE"], ["PL", "CZ"], ["PL", "SK"], ["PL", "LT"],
  ["DE", "DK"], ["DE", "CZ"], ["DE", "AT"], ["DE", "CH"], ["DE", "FR"], ["DE", "LU"], ["DE", "BE"], ["DE", "NL"],
  ["GB", "IE"],
  ["US", "CA"], ["US", "MX"],
  ["IL", "LB"], ["IL", "SY"], ["IL", "JO"], ["IL", "EG"], ["IL", "PS"],
  ["PS", "EG"], ["PS", "JO"],
  ["LB", "SY"],
  ["SY", "TR"], ["SY", "IQ"], ["SY", "JO"],
  ["IR", "TR"], ["IR", "IQ"], ["IR", "AF"], ["IR", "PK"], ["IR", "TM"], ["IR", "AZ"], ["IR", "AM"],
  ["SA", "JO"], ["SA", "IQ"], ["SA", "KW"], ["SA", "QA"], ["SA", "AE"], ["SA", "OM"], ["SA", "YE"],
  ["YE", "OM"],
  ["SD", "EG"], ["SD", "LY"], ["SD", "TD"], ["SD", "CF"], ["SD", "SS"], ["SD", "ET"], ["SD", "ER"],
  ["CD", "CG"], ["CD", "CF"], ["CD", "SS"], ["CD", "UG"], ["CD", "RW"], ["CD", "BI"], ["CD", "ZM"], ["CD", "AO"],
  ["SO", "ET"], ["SO", "KE"], ["SO", "DJ"],
  ["ML", "DZ"], ["ML", "NE"], ["ML", "BF"], ["ML", "CI"], ["ML", "GN"], ["ML", "SN"], ["ML", "MR"],
  ["NG", "BJ"], ["NG", "NE"], ["NG", "TD"], ["NG", "CM"],
  ["EG", "LY"],
  ["MM", "IN"], ["MM", "BD"], ["MM", "CN"], ["MM", "LA"], ["MM", "TH"],
  ["IN", "PK"], ["IN", "CN"], ["IN", "NP"], ["IN", "BT"], ["IN", "BD"],
  ["PK", "AF"], ["PK", "CN"],
  ["KR", "KP"],
  ["KP", "CN"],
  ["CN", "MN"], ["CN", "AF"], ["CN", "TJ"], ["CN", "KG"], ["CN", "KZ"], ["CN", "NP"], ["CN", "BT"], ["CN", "LA"], ["CN", "VN"],
  ["TR", "GR"], ["TR", "BG"], ["TR", "GE"], ["TR", "AM"], ["TR", "AZ"], ["TR", "IQ"],
];

export const DEFAULT_ADJACENCY: AdjacencyMap = buildAdjacency(WORLD_LAND_BORDERS);

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
