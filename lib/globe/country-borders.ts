import type { Feature, MultiPolygon, Polygon, Position } from "geojson";
import countryBordersGeo from "@/public/globe/country-borders.json";

/**
 * Political country boundaries (Natural Earth 1:110m admin-0 countries,
 * public domain), bundled as an example asset inside our own `three-globe`
 * dependency and re-served from /public — no external request, no
 * third-party map product's visual asset. Used for the globe's toggleable
 * "Borders" and "Labels" layers, independent of the continental landmass
 * fill used in Intel mode.
 */

interface CountryBorderFeature {
  name: string;
  labelRank: number;
  // Natural Earth's own TYPE field — "Disputed" (e.g. Palestine, per its
  // SOVEREIGNT vs. ADMIN split) or "Indeterminate" (e.g. Western Sahara,
  // Somaliland: no internationally settled sovereign) get a visually
  // distinct outline instead of rendering as an ordinary undisputed
  // border (spec "distinguish disputed-boundary metadata"). Everything
  // else ("Sovereign country", "Country", "Dependency") renders as normal.
  disputed: boolean;
  geometry: Polygon | MultiPolygon;
}

const DISPUTED_TYPES = new Set(["Disputed", "Indeterminate"]);

let cachedFeatures: CountryBorderFeature[] | null = null;

function getFeatures(): CountryBorderFeature[] {
  if (cachedFeatures) return cachedFeatures;
  const collection = countryBordersGeo as unknown as {
    features: Feature<Polygon | MultiPolygon, { NAME?: string; LABELRANK?: number; TYPE?: string }>[];
  };
  cachedFeatures = collection.features.map((f) => ({
    name: f.properties?.NAME ?? "",
    labelRank: f.properties?.LABELRANK ?? 6,
    disputed: DISPUTED_TYPES.has(f.properties?.TYPE ?? ""),
    geometry: f.geometry,
  }));
  return cachedFeatures;
}

export interface GlobePath {
  points: [number, number][];
  disputed: boolean;
}

function polygonsOf(geometry: Polygon | MultiPolygon): Position[][][] {
  return geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
}

// Cap points per ring: three-globe builds a real tube-geometry mesh per
// path with Frenet-frame math, so 289 rings at full Natural Earth 110m
// density (~10.6k points total) is enough to visibly stall the main thread
// when the Borders layer toggles on/off, especially on weaker GPUs. Simple
// stride decimation (always keeping the first/last point so rings stay
// closed) is visually indistinguishable at globe scale and cuts that cost
// substantially.
const MAX_POINTS_PER_RING = 22;

function decimateRing(ring: Position[]): [number, number][] {
  const points: [number, number][] = [];
  const stride = Math.max(1, Math.ceil(ring.length / MAX_POINTS_PER_RING));
  for (let i = 0; i < ring.length; i += stride) {
    const pos = ring[i];
    const lng = pos?.[0];
    const lat = pos?.[1];
    if (typeof lng === "number" && typeof lat === "number") points.push([lat, lng]);
  }
  const last = ring[ring.length - 1];
  const lastLng = last?.[0];
  const lastLat = last?.[1];
  if (typeof lastLng === "number" && typeof lastLat === "number") {
    const tail = points[points.length - 1];
    if (!tail || tail[0] !== lastLat || tail[1] !== lastLng) points.push([lastLat, lastLng]);
  }
  return points;
}

let cachedPaths: GlobePath[] | null = null;

/**
 * One outline per country — its single largest ring by point count, as a
 * proxy for "main landmass" (drops small outlying islands' separate
 * rings). three-globe renders each `pathsData` entry as its own tube mesh
 * (Frenet-frame math, no batching/merging support), so mesh COUNT, not
 * point count, is what makes toggling this layer expensive: the raw data
 * has 289 rings across 177 countries, and even after point-decimation that
 * was still slow enough to be a real "excellent mobile performance"
 * concern (see TASKS.md). Capping at one ring per country cuts mesh count
 * by ~40% and keeps every country's principal outline intact; the layer
 * still defaults off (see use-app-store.ts) so this cost is only ever
 * paid when a user opts in.
 */
export function getCountryBorderPaths(): GlobePath[] {
  if (cachedPaths) return cachedPaths;
  const paths: GlobePath[] = [];
  for (const { geometry, disputed } of getFeatures()) {
    let largest: Position[] | null = null;
    for (const rings of polygonsOf(geometry)) {
      const outer = rings[0];
      if (outer && (!largest || outer.length > largest.length)) largest = outer;
    }
    if (largest) {
      const points = decimateRing(largest);
      if (points.length > 1) paths.push({ points, disputed });
    }
  }
  cachedPaths = paths;
  return cachedPaths;
}

function ringCentroid(ring: Position[]): { lat: number; lng: number; area: number } | null {
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

/** One label point per country, placed at the centroid of its largest ring (handles multi-island countries reasonably). */
export function getCountryLabels(maxLabelRank: number): CountryLabel[] {
  if (!cachedLabels) {
    cachedLabels = getFeatures()
      .filter((f) => f.name)
      .map((f) => {
        let best: { lat: number; lng: number; area: number } | null = null;
        for (const rings of polygonsOf(f.geometry)) {
          const outer = rings[0];
          if (!outer) continue;
          const c = ringCentroid(outer);
          if (c && (!best || c.area > best.area)) best = c;
        }
        return best ? { name: f.name, lat: best.lat, lng: best.lng, rank: f.labelRank } : null;
      })
      .filter((x): x is RankedCountryLabel => x !== null);
  }
  return cachedLabels.filter((l) => l.rank <= maxLabelRank);
}
