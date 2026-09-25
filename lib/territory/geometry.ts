import polygonClipping, { type Geom, type MultiPolygon as ClipMultiPolygon } from "polygon-clipping";
import type { TerritorialGeometry } from "@/lib/types/territorial-control";

// Territorial geometry: validation, boolean operations (split) and the pure
// vertex-editing operations the visual editor is built on. Everything here is
// a pure function of its input so it can be unit-tested without a map.
//
// Coordinates are GeoJSON [lng, lat]. Strategic control areas only — nothing
// here models live troop positions, and nothing generates geometry from text.

export type Position = [number, number];
export type Ring = Position[];
/** One polygon: outer ring first, then holes. */
export type PolygonRings = Ring[];

// ---- validation -------------------------------------------------------------

export interface GeometryValidation {
  valid: boolean;
  errors: string[];
}

const EPS = 1e-12;

function isPosition(p: unknown): p is Position {
  return Array.isArray(p) && p.length >= 2 && typeof p[0] === "number" && typeof p[1] === "number";
}

function ringSignedArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) sum += ring[i]![0] * ring[i + 1]![1] - ring[i + 1]![0] * ring[i]![1];
  return sum / 2;
}

function orient(a: Position, b: Position, c: Position): number {
  const v = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  return Math.abs(v) < EPS ? 0 : v > 0 ? 1 : -1;
}

function onSegment(a: Position, b: Position, p: Position): boolean {
  return Math.min(a[0], b[0]) - EPS <= p[0] && p[0] <= Math.max(a[0], b[0]) + EPS && Math.min(a[1], b[1]) - EPS <= p[1] && p[1] <= Math.max(a[1], b[1]) + EPS;
}

/** True when segments ab and cd intersect (touching counts). */
function segmentsIntersect(a: Position, b: Position, c: Position, d: Position): boolean {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(a, b, c)) return true;
  if (o2 === 0 && onSegment(a, b, d)) return true;
  if (o3 === 0 && onSegment(c, d, a)) return true;
  if (o4 === 0 && onSegment(c, d, b)) return true;
  return false;
}

/** A ring self-intersects when two non-adjacent edges cross or touch. */
export function ringSelfIntersects(ring: Ring): boolean {
  const n = ring.length - 1; // closed ring: last == first
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (adjacent) continue;
      if (segmentsIntersect(ring[i]!, ring[i + 1]!, ring[j]!, ring[j + 1]!)) return true;
    }
  }
  return false;
}

function validateRing(ring: unknown, label: string, errors: string[]): void {
  if (!Array.isArray(ring) || ring.length === 0) {
    errors.push(`${label}: ring is empty.`);
    return;
  }
  if (ring.length < 4) {
    errors.push(`${label}: a ring needs at least 3 distinct points (4 coordinates including the closing point).`);
    return;
  }
  for (const p of ring) {
    if (!isPosition(p)) {
      errors.push(`${label}: every coordinate must be a [longitude, latitude] pair of numbers.`);
      return;
    }
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) {
      errors.push(`${label}: coordinates must be finite numbers.`);
      return;
    }
    if (p[0] < -180 || p[0] > 180) {
      errors.push(`${label}: longitude ${p[0]} is outside -180..180.`);
      return;
    }
    if (p[1] < -90 || p[1] > 90) {
      errors.push(`${label}: latitude ${p[1]} is outside -90..90.`);
      return;
    }
  }
  const first = ring[0] as Position;
  const last = ring[ring.length - 1] as Position;
  if (first[0] !== last[0] || first[1] !== last[1]) {
    errors.push(`${label}: the ring is not closed (the last point must equal the first).`);
    return;
  }
  // A ring that steps across the antimeridian (e.g. 179 -> -179) is, to every planar renderer (MapLibre, the editor),
  // a line across the whole world: its fill becomes a world-spanning band. Such an area must be stored as two parts
  // split at +/-180 (a MultiPolygon), never as one ring that wraps.
  for (let i = 1; i < ring.length; i++) {
    if (Math.abs((ring[i] as Position)[0] - (ring[i - 1] as Position)[0]) > 180) {
      errors.push(`${label}: the ring crosses the antimeridian (longitude ${(ring[i - 1] as Position)[0]} to ${(ring[i] as Position)[0]}); split it at 180 into a MultiPolygon.`);
      return;
    }
  }
  const distinct = new Set((ring as Ring).slice(0, -1).map((p) => `${p[0]},${p[1]}`));
  if (distinct.size < 3) {
    errors.push(`${label}: a ring needs at least 3 distinct points.`);
    return;
  }
  // Crossing first: a bow-tie's two lobes cancel to zero signed area, and
  // "crosses itself" is the more useful message.
  if (ringSelfIntersects(ring as Ring)) {
    errors.push(`${label}: the ring crosses itself (self-intersection).`);
    return;
  }
  if (Math.abs(ringSignedArea(ring as Ring)) < EPS) {
    errors.push(`${label}: the ring has zero area (all points are in a line).`);
  }
}

/** Deep validation with a clear message per problem. Never throws. */
export function validateTerritorialGeometry(value: unknown): GeometryValidation {
  const errors: string[] = [];
  if (typeof value !== "object" || value === null) return { valid: false, errors: ["Geometry is missing."] };
  const g = value as { type?: unknown; coordinates?: unknown };
  if (g.type !== "Polygon" && g.type !== "MultiPolygon") {
    return { valid: false, errors: [`Geometry type must be Polygon or MultiPolygon (got ${String(g.type)}).`] };
  }
  if (!Array.isArray(g.coordinates) || g.coordinates.length === 0) return { valid: false, errors: ["Geometry has no coordinates."] };

  const polygons: unknown[] = g.type === "Polygon" ? [g.coordinates] : (g.coordinates as unknown[]);
  polygons.forEach((poly, pi) => {
    const prefix = g.type === "MultiPolygon" ? `Polygon ${pi + 1}` : "Polygon";
    if (!Array.isArray(poly) || poly.length === 0) {
      errors.push(`${prefix}: has no rings.`);
      return;
    }
    poly.forEach((ring, ri) => validateRing(ring, ri === 0 ? `${prefix} outer ring` : `${prefix} hole ${ri}`, errors));
  });
  return { valid: errors.length === 0, errors };
}

// ---- conversion / boolean operations ---------------------------------------

export function polygonsOf(geometry: TerritorialGeometry): PolygonRings[] {
  return (geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates) as PolygonRings[];
}

export function fromPolygons(polygons: PolygonRings[]): TerritorialGeometry | null {
  const nonEmpty = polygons.filter((p) => p.length > 0 && (p[0]?.length ?? 0) >= 4);
  if (nonEmpty.length === 0) return null;
  if (nonEmpty.length === 1) return { type: "Polygon", coordinates: nonEmpty[0]! };
  return { type: "MultiPolygon", coordinates: nonEmpty };
}

function toClipGeom(g: TerritorialGeometry): Geom {
  return g.coordinates as unknown as Geom;
}

function fromClip(result: ClipMultiPolygon): TerritorialGeometry | null {
  return fromPolygons(result as unknown as PolygonRings[]);
}

/** Planar (degree-space) area — only for comparing/sanity-checking shapes, not a real area. */
export function planarArea(geometry: TerritorialGeometry | null): number {
  if (!geometry) return 0;
  let total = 0;
  for (const poly of polygonsOf(geometry)) {
    poly.forEach((ring, i) => {
      const a = Math.abs(ringSignedArea(ring));
      total += i === 0 ? a : -a;
    });
  }
  return total;
}

export function intersectGeometry(a: TerritorialGeometry, b: TerritorialGeometry): TerritorialGeometry | null {
  return fromClip(polygonClipping.intersection(toClipGeom(a), toClipGeom(b)));
}

export function differenceGeometry(a: TerritorialGeometry, b: TerritorialGeometry): TerritorialGeometry | null {
  return fromClip(polygonClipping.difference(toClipGeom(a), toClipGeom(b)));
}

export function unionGeometry(a: TerritorialGeometry, b: TerritorialGeometry): TerritorialGeometry | null {
  return fromClip(polygonClipping.union(toClipGeom(a), toClipGeom(b)));
}

export interface SplitResult {
  /** The part of `base` covered by `area` — goes to the new controller/status. */
  affected: TerritorialGeometry | null;
  /** The rest of `base` — stays with the old controller/status, geometry untouched. */
  remainder: TerritorialGeometry | null;
}

/** Splits `base` by `area`: affected = base ∩ area, remainder = base − area.
 * The two always tile `base` exactly (no gap, no overlap). Slivers below
 * `minArea` (degree², default ~a few metres) are dropped as numeric noise. */
export function splitGeometry(base: TerritorialGeometry, area: TerritorialGeometry, minArea = 1e-10): SplitResult {
  const affected = intersectGeometry(base, area);
  const remainder = differenceGeometry(base, area);
  return {
    affected: planarArea(affected) > minArea ? affected : null,
    remainder: planarArea(remainder) > minArea ? remainder : null,
  };
}

/** Whether two geometries cover the same area (ignoring vertex order/start). */
export function sameArea(a: TerritorialGeometry, b: TerritorialGeometry, tolerance = 1e-9): boolean {
  const onlyA = planarArea(differenceGeometry(a, b));
  const onlyB = planarArea(differenceGeometry(b, a));
  return onlyA <= tolerance && onlyB <= tolerance;
}

// ---- vertex editing (pure; the editor UI is a thin layer over these) --------

export interface VertexRef {
  polygon: number;
  ring: number;
  vertex: number;
}

const clonePolys = (polys: PolygonRings[]): PolygonRings[] => polys.map((p) => p.map((r) => r.map((pt) => [pt[0], pt[1]] as Position)));

function closeRing(ring: Ring): Ring {
  if (ring.length === 0) return ring;
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  return first[0] === last[0] && first[1] === last[1] ? ring : [...ring, [first[0], first[1]]];
}

/** A new polygon from freshly clicked points (needs at least 3). Closes the ring. */
export function polygonFromPoints(points: Position[]): PolygonRings | null {
  if (points.length < 3) return null;
  return [closeRing(points.map((p) => [p[0], p[1]] as Position))];
}

/** Moves one vertex. A ring's first vertex is stored twice (closing point) — both copies move. */
export function moveVertex(polys: PolygonRings[], ref: VertexRef, to: Position): PolygonRings[] {
  const out = clonePolys(polys);
  const ring = out[ref.polygon]?.[ref.ring];
  if (!ring) return out;
  const last = ring.length - 1;
  ring[ref.vertex] = [to[0], to[1]];
  if (ref.vertex === 0) ring[last] = [to[0], to[1]];
  if (ref.vertex === last) ring[0] = [to[0], to[1]];
  return out;
}

/** Inserts a vertex on the edge that STARTS at ref.vertex (between vertex and vertex + 1). */
export function insertVertex(polys: PolygonRings[], ref: VertexRef, at: Position): PolygonRings[] {
  const out = clonePolys(polys);
  const ring = out[ref.polygon]?.[ref.ring];
  if (!ring) return out;
  ring.splice(ref.vertex + 1, 0, [at[0], at[1]]);
  return out;
}

/** Removes a vertex; refuses (returns the input unchanged) when the ring would drop below a triangle. */
export function removeVertex(polys: PolygonRings[], ref: VertexRef): PolygonRings[] {
  const ring = polys[ref.polygon]?.[ref.ring];
  if (!ring || ring.length - 1 <= 3) return polys;
  const out = clonePolys(polys);
  const r = out[ref.polygon]![ref.ring]!;
  const last = r.length - 1;
  if (ref.vertex === 0 || ref.vertex === last) {
    r.shift();
    r.pop();
    r.push([r[0]![0], r[0]![1]]);
  } else {
    r.splice(ref.vertex, 1);
  }
  return out;
}

/** Removes a whole polygon (or hole, when ring > 0) from the shape. */
export function removePolygon(polys: PolygonRings[], polygon: number): PolygonRings[] {
  return polys.filter((_, i) => i !== polygon);
}

/** Midpoint of the edge starting at `vertex`. */
export function edgeMidpoint(ring: Ring, vertex: number): Position {
  const a = ring[vertex]!;
  const b = ring[vertex + 1]!;
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

export function bboxOf(geometry: TerritorialGeometry): [[number, number], [number, number]] {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const poly of polygonsOf(geometry)) {
    for (const ring of poly) {
      for (const [lng, lat] of ring) {
        minLng = Math.min(minLng, lng);
        maxLng = Math.max(maxLng, lng);
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
      }
    }
  }
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}
