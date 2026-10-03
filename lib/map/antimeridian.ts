import type { Feature, FeatureCollection, Geometry, LineString, MultiLineString, MultiPolygon, Polygon, Position } from "geojson";

// Antimeridian-safe geometry for the FLAT (Web-Mercator) map.
//
// Natural Earth's land/country topology (world-atlas) is cut at the antimeridian, but the cut is stored as a step: a
// ring (or arc) that reaches lng 180 continues at lng -180 on the other side. On a globe that is invisible; on a flat
// map GeoJSON is planar, so the step is a real 360-degree-long edge:
//   - a land ring (Eurasia across Chukotka, Fiji, Antarctica) is filled across the WHOLE world at that latitude — the
//     big malformed polygon over the North Atlantic / Iceland / UK and the grey blocks over the ocean;
//   - the coast mesh draws the same edge as a horizontal line from one side of the map to the other.
// The fix is in the data, not the paint: unwrap each ring/line into one continuous run (longitudes may leave
// [-180, 180]), close a pole-winding ring (Antarctica) through the pole, then cut the run at every antimeridian and
// move each piece back into [-180, 180]. Deterministic, no tolerance fudging, no change to where anything is.

type Pt = [number, number];

const EPS = 1e-9;

/** Makes longitudes continuous: each point is shifted by a multiple of 360 so it is within 180 of the previous one. */
function unwrap(points: readonly Position[]): Pt[] {
  const out: Pt[] = [];
  let offset = 0;
  let prev = 0;
  points.forEach((p, i) => {
    const lng = p[0]!;
    if (i > 0) {
      if (lng - prev > 180) offset -= 360;
      else if (lng - prev < -180) offset += 360;
    }
    prev = lng;
    out.push([lng + offset, p[1]!]);
  });
  return out;
}

/** The [lo, hi] slab indices k (lng range [-180 + 360k, 180 + 360k]) a run of longitudes touches. */
function slabRange(points: readonly Pt[]): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    if (p[0] < min) min = p[0];
    if (p[0] > max) max = p[0];
  }
  return [Math.floor((min + 180 + EPS) / 360), Math.ceil((max - 180 - EPS) / 360)];
}

/** Splits an (unwrapped) line at the slab boundaries; pieces are returned in slab coordinates, shifted into [-180, 180]. */
function clipLineToSlab(points: readonly Pt[], k: number): Pt[][] {
  const lo = -180 + 360 * k;
  const hi = 180 + 360 * k;
  const shift = 360 * k;
  const pieces: Pt[][] = [];
  let run: Pt[] = [];
  const flush = () => {
    if (run.length >= 2) pieces.push(run);
    run = [];
  };
  const push = (x: number, y: number) => {
    const last = run[run.length - 1];
    if (!last || last[0] !== x - shift || last[1] !== y) run.push([x - shift, y]);
  };
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1]!;
    const [x1, y1] = points[i]!;
    // Parametric clip of the segment against lo <= x <= hi.
    let t0 = 0;
    let t1 = 1;
    const dx = x1 - x0;
    if (Math.abs(dx) < EPS) {
      if (x0 < lo - EPS || x0 > hi + EPS) {
        flush();
        continue;
      }
    } else {
      const ta = (lo - x0) / dx;
      const tb = (hi - x0) / dx;
      const tEnter = Math.min(ta, tb);
      const tExit = Math.max(ta, tb);
      t0 = Math.max(0, tEnter);
      t1 = Math.min(1, tExit);
      if (t0 > t1) {
        flush();
        continue;
      }
    }
    const ax = t0 === 0 ? x0 : Math.min(hi, Math.max(lo, x0 + dx * t0));
    const ay = y0 + (y1 - y0) * t0;
    const bx = t1 === 1 ? x1 : Math.min(hi, Math.max(lo, x0 + dx * t1));
    const by = y0 + (y1 - y0) * t1;
    if (t0 > 0) flush(); // entered the slab mid-segment: a new piece starts at the boundary
    push(ax, ay);
    push(bx, by);
    if (t1 < 1) flush(); // left the slab mid-segment
  }
  flush();
  return pieces;
}

/** Cuts a line at every antimeridian it crosses (including the stored 180 -> -180 step). */
export function cutLine(line: readonly Position[]): Position[][] {
  if (line.length < 2) return [];
  const unwrapped = unwrap(line);
  const [kMin, kMax] = slabRange(unwrapped);
  const out: Position[][] = [];
  for (let k = kMin; k <= kMax; k++) out.push(...clipLineToSlab(unwrapped, k));
  return out;
}

/** Sutherland–Hodgman clip of a closed ring against a vertical half-plane. */
function clipRingHalfPlane(ring: readonly Pt[], x: number, keepGreater: boolean): Pt[] {
  const inside = (p: Pt) => (keepGreater ? p[0] >= x - EPS : p[0] <= x + EPS);
  const out: Pt[] = [];
  for (let i = 0; i < ring.length; i++) {
    const cur = ring[i]!;
    const prev = ring[(i + ring.length - 1) % ring.length]!;
    const curIn = inside(cur);
    const prevIn = inside(prev);
    if (curIn !== prevIn) {
      const t = (x - prev[0]) / (cur[0] - prev[0]);
      out.push([x, prev[1] + (cur[1] - prev[1]) * t]);
    }
    if (curIn) out.push(cur);
  }
  return out;
}

function ringArea(ring: readonly Pt[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!;
    const q = ring[(i + 1) % ring.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** An open run of points -> closed ring clipped to slab k and moved into [-180, 180] (empty when nothing is left). */
function clipRingToSlab(ring: readonly Pt[], k: number): Pt[] {
  const lo = -180 + 360 * k;
  const hi = 180 + 360 * k;
  let r = clipRingHalfPlane(ring, lo, true);
  if (r.length) r = clipRingHalfPlane(r, hi, false);
  if (r.length < 3 || Math.abs(ringArea(r)) < 1e-9) return [];
  const shifted = r.map((p): Pt => [Math.min(180, Math.max(-180, p[0] - 360 * k)), p[1]]);
  const first = shifted[0]!;
  shifted.push([first[0], first[1]]);
  return shifted;
}

/** Unwraps a closed ring; a ring that winds once around a pole is closed through that pole instead of straight across. */
function unwrapRing(ring: readonly Position[], closeThroughPole: boolean): Pt[] {
  const pts = ring.length > 1 && ring[0]![0] === ring[ring.length - 1]![0] && ring[0]![1] === ring[ring.length - 1]![1] ? ring.slice(0, -1) : ring;
  // Unwrap the closing step too: the ring's last point back to its first decides whether the ring winds a pole.
  const run = unwrap([...pts, pts[0]!]);
  const start = run[0]!;
  const end = run[run.length - 1]!;
  run.pop();
  if (closeThroughPole && Math.abs(end[0] - start[0]) > 180) {
    const meanLat = run.reduce((s, p) => s + p[1], 0) / run.length;
    const poleLat = meanLat < 0 ? -90 : 90;
    const last = run[run.length - 1]!;
    // Down (or up) to the pole at the run's last column, across the pole edge to the first column, then back to the
    // start: the polar cap ends up inside the ring instead of left as a hole.
    run.push([last[0], poleLat], [start[0], poleLat]);
  }
  return run;
}

/** Cuts a polygon (outer ring + holes) at every antimeridian; returns one polygon per slab it touches. */
export function cutPolygon(rings: readonly (readonly Position[])[]): Position[][][] {
  if (!rings.length) return [];
  const outer = unwrapRing(rings[0]!, true);
  const holes = rings.slice(1).map((h) => unwrapRing(h, false));
  const [kMin, kMax] = slabRange(outer);
  const result: Position[][][] = [];
  for (let k = kMin; k <= kMax; k++) {
    const o = clipRingToSlab(outer, k);
    if (!o.length) continue;
    const polygon: Position[][] = [o];
    for (const hole of holes) {
      // A hole may have been unwrapped into a different world copy than the outer ring: shift it to the outer's copy.
      const centre = hole.reduce((s, p) => s + p[0], 0) / hole.length;
      const outerCentre = outer.reduce((s, p) => s + p[0], 0) / outer.length;
      const delta = Math.round((outerCentre - centre) / 360) * 360;
      const moved = delta ? hole.map((p): Pt => [p[0] + delta, p[1]]) : hole;
      const h = clipRingToSlab(moved, k);
      if (h.length) polygon.push(h);
    }
    result.push(polygon);
  }
  return result;
}

function cutGeometry(geometry: Geometry): Geometry {
  switch (geometry.type) {
    case "Polygon": {
      const polys = cutPolygon(geometry.coordinates);
      return polys.length === 1 ? ({ type: "Polygon", coordinates: polys[0]! } as Polygon) : ({ type: "MultiPolygon", coordinates: polys } as MultiPolygon);
    }
    case "MultiPolygon":
      return { type: "MultiPolygon", coordinates: geometry.coordinates.flatMap((p) => cutPolygon(p)) } as MultiPolygon;
    case "LineString": {
      const lines = cutLine(geometry.coordinates);
      return lines.length === 1 ? ({ type: "LineString", coordinates: lines[0]! } as LineString) : ({ type: "MultiLineString", coordinates: lines } as MultiLineString);
    }
    case "MultiLineString":
      return { type: "MultiLineString", coordinates: geometry.coordinates.flatMap((l) => cutLine(l)) } as MultiLineString;
    default:
      return geometry;
  }
}

/** Antimeridian-safe copy of a feature collection for a planar (flat map) renderer. */
export function cutFeatureCollection<G extends Geometry, P>(collection: FeatureCollection<G, P>): FeatureCollection<Geometry, P> {
  return {
    type: "FeatureCollection",
    features: collection.features.map((f): Feature<Geometry, P> => ({ ...f, geometry: cutGeometry(f.geometry) })),
  };
}
