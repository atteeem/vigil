import { feature, mesh } from "topojson-client";
import type { Feature, MultiPolygon, Polygon, Position } from "geojson";
import { countriesObject, worldTopology } from "@/lib/globe/world-topology";

/**
 * Country BORDER LINES and labels for the globe, derived from the single
 * authoritative topology in lib/globe/world-topology.ts.
 *
 * Borders are topojson's `mesh` of the INTERIOR boundaries only
 * (`a !== b`: an arc shared by two countries). Consequences, all deliberate:
 *  - each shared border is emitted exactly ONCE (no doubled lines from both
 *    neighbours tracing it);
 *  - coastlines are NOT traced at all — the landmass fill's own edge is the
 *    coastline, so there is no second, misaligned coast outline;
 *  - full source resolution, no stride decimation (the old 34-points-per-ring
 *    decimation cut corners and pulled lines off the coast), and every ring
 *    of every country is used, not just its largest;
 *  - one uniform style: there is no per-country metadata to inherit
 *    "disputed"/other styling from. This dataset carries no disputed-boundary
 *    attribute, so disputed lines are intentionally not drawn until a
 *    dedicated, explicitly sourced disputed layer exists.
 */

export interface GlobePath {
  /** [lat, lng] pairs, the order three-globe's pathPoints accessor expects. */
  points: [number, number][];
}

let cachedPaths: GlobePath[] | null = null;

export function getCountryBorderPaths(): GlobePath[] {
  if (cachedPaths) return cachedPaths;
  const interior = mesh(worldTopology, countriesObject, (a, b) => a !== b);
  const paths: GlobePath[] = [];
  for (const line of interior.coordinates) {
    // Split where a line jumps across the antimeridian so it never streaks
    // across the whole globe.
    let current: [number, number][] = [];
    let prevLng: number | null = null;
    for (const pos of line) {
      const lng = pos[0];
      const lat = pos[1];
      if (typeof lng !== "number" || typeof lat !== "number") continue;
      if (prevLng !== null && Math.abs(lng - prevLng) > 180) {
        if (current.length > 1) paths.push({ points: current });
        current = [];
      }
      current.push([lat, lng]);
      prevLng = lng;
    }
    if (current.length > 1) paths.push({ points: current });
  }
  cachedPaths = paths;
  return cachedPaths;
}

function polygonsOf(geometry: Polygon | MultiPolygon): Position[][][] {
  return geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
}

function ringCentroid(input: Position[]): { lat: number; lng: number; area: number } | null {
  // A ring that crosses the antimeridian (Russia's Chukotka, Fiji) has
  // longitudes jumping between about -180 and +180; a shoelace centroid over
  // those raw values lands on the wrong side of the globe. Unwrap onto a
  // continuous range for the maths, then wrap the result back.
  const lngs = input.map((p) => p[0]).filter((v): v is number => typeof v === "number");
  const crosses = lngs.length > 0 && Math.max(...lngs) - Math.min(...lngs) > 180;
  const ring = crosses ? input.map((p): Position => [typeof p[0] === "number" && p[0] < 0 ? p[0] + 360 : (p[0] as number), p[1] as number]) : input;
  const result = ringCentroidRaw(ring);
  if (result && result.lng > 180) result.lng -= 360;
  return result;
}

function ringCentroidRaw(ring: Position[]): { lat: number; lng: number; area: number } | null {
  // Shoelace-formula centroid, in lng/lat space (good enough at this scale
  // for label placement — not a geodesic centroid).
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const p0 = ring[i];
    const p1 = ring[i + 1];
    if (!p0 || !p1) continue;
    const x0 = p0[0];
    const y0 = p0[1];
    const x1 = p1[0];
    const y1 = p1[1];
    if (
      typeof x0 !== "number" ||
      typeof y0 !== "number" ||
      typeof x1 !== "number" ||
      typeof y1 !== "number"
    )
      continue;
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  area *= 0.5;
  if (Math.abs(area) < 1e-9) {
    const first = ring[0];
    if (!first) return null;
    const lng = first[0];
    const lat = first[1];
    if (typeof lng !== "number" || typeof lat !== "number") return null;
    return { lat, lng, area: 0 };
  }
  cx /= 6 * area;
  cy /= 6 * area;
  return { lat: cy, lng: cx, area: Math.abs(area) };
}

export interface CountryLabel {
  name: string;
  lat: number;
  lng: number;
}

interface RankedCountryLabel extends CountryLabel {
  rank: number;
}

let cachedLabels: RankedCountryLabel[] | null = null;

// Natural Earth's 110m countries here carry no label-rank attribute, so the
// prominence tier comes from land area (largest ring): the biggest countries
// are always labelled, small ones only when zoomed in / on desktop.
const TIER_1_COUNT = 24;
const TIER_2_COUNT = 60;
const TIER_3_COUNT = 110;

/** One label per country, at the centroid of its largest ring, from the same geometry the borders and fill use. */
export function getCountryLabels(maxLabelRank: number): CountryLabel[] {
  if (!cachedLabels) {
    const collection = feature(worldTopology, countriesObject) as unknown as {
      features: Feature<Polygon | MultiPolygon, { name?: string }>[];
    };
    const measured = collection.features
      .map((f) => {
        let best: { lat: number; lng: number; area: number } | null = null;
        for (const rings of polygonsOf(f.geometry)) {
          const outer = rings[0];
          if (!outer) continue;
          const c = ringCentroid(outer);
          if (c && (!best || c.area > best.area)) best = c;
        }
        return best && f.properties?.name ? { name: f.properties.name, ...best } : null;
      })
      .filter((x): x is { name: string; lat: number; lng: number; area: number } => x !== null)
      .sort((a, b) => b.area - a.area);
    cachedLabels = measured.map((m, i) => ({
      name: m.name,
      lat: m.lat,
      lng: m.lng,
      rank: i < TIER_1_COUNT ? 1 : i < TIER_2_COUNT ? 2 : i < TIER_3_COUNT ? 3 : 4,
    }));
  }
  return cachedLabels.filter((l) => l.rank <= maxLabelRank);
}
