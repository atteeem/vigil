import { differenceGeometry, fromPolygons, planarArea, polygonsOf, ringSelfIntersects, unionGeometry, type PolygonRings, type Position, type Ring } from "./geometry";

// Editing tools layered on lib/territory/geometry.ts: bounded edit history (undo / redo), hole cutting,
// merging, Douglas-Peucker simplification and vertex/edge snapping. All pure, all unit-testable without a
// map. They only ever change the DRAFT geometry held by the editor; publishing still goes through the
// territorial-control supersession flow, so territorial history and versioning are untouched.
//
// Ideas (not code) adapted from maplibre-gl-geo-editor (MIT: HistoryManager, SimplifyFeature) and L7Draw
// (MIT: adsorb.ts snapping) — see docs/OPEN_SOURCE_AUDIT.md. Implemented natively so Vigil keeps ONE editor.

// ---- edit history -----------------------------------------------------------------------------------

export const HISTORY_LIMIT = 50;

/** Snapshot history with a bounded depth. Immutable: every method returns a new History. */
export interface History<T> {
  readonly past: readonly T[];
  readonly present: T;
  readonly future: readonly T[];
}

export const createHistory = <T,>(present: T): History<T> => ({ past: [], present, future: [] });
export const canUndo = <T,>(h: History<T>) => h.past.length > 0;
export const canRedo = <T,>(h: History<T>) => h.future.length > 0;

/** Records a new state. A no-op change (same reference) is ignored; a new edit clears the redo stack. */
export function pushHistory<T>(h: History<T>, next: T, limit = HISTORY_LIMIT): History<T> {
  if (Object.is(next, h.present)) return h;
  const past = [...h.past, h.present];
  return { past: past.length > limit ? past.slice(past.length - limit) : past, present: next, future: [] };
}

export function undo<T>(h: History<T>): History<T> {
  if (!canUndo(h)) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1]!, future: [h.present, ...h.future] };
}

export function redo<T>(h: History<T>): History<T> {
  if (!canRedo(h)) return h;
  return { past: [...h.past, h.present], present: h.future[0]!, future: h.future.slice(1) };
}

// ---- holes and merging -----------------------------------------------------------------------------------

/** Cuts a hole into polygon `index` by subtracting a drawn ring. A ring fully inside makes an interior hole
 * (donut); one that crosses the edge notches the outline. Returns null when nothing would change (the ring
 * does not overlap the polygon) or the ring is degenerate/self-intersecting. */
export function cutHole(polys: PolygonRings[], index: number, ring: Ring): PolygonRings[] | null {
  const target = polys[index];
  if (!target || ring.length < 4 || ringSelfIntersects(ring)) return null;
  const base = fromPolygons([target]);
  const hole = fromPolygons([[ring]]);
  if (!base || !hole) return null;
  const diff = differenceGeometry(base, hole);
  if (!diff || planarArea(diff) >= planarArea(base) - 1e-12) return null; // no overlap: nothing cut
  return [...polys.slice(0, index), ...polygonsOf(diff), ...polys.slice(index + 1)];
}

/** Merges every polygon in the draft into as few polygons as possible (overlapping/touching ones fuse; holes are kept). */
export function mergePolygons(polys: PolygonRings[]): PolygonRings[] {
  if (polys.length < 2) return polys;
  let acc = fromPolygons([polys[0]!]);
  for (const p of polys.slice(1)) {
    const g = fromPolygons([p]);
    if (!g) continue;
    acc = acc ? unionGeometry(acc, g) : g;
  }
  return acc ? polygonsOf(acc) : polys;
}

// ---- simplify (Douglas-Peucker) --------------------------------------------------------------------------

function pointSegmentDistance(p: Position, a: Position, b: Position): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Douglas-Peucker on an open polyline (iterative: no recursion limit on long borders). */
export function simplifyLine(points: Position[], tolerance: number): Position[] {
  if (points.length <= 2) return points;
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let worst = -1;
    let dist = 0;
    for (let i = s + 1; i < e; i++) {
      const d = pointSegmentDistance(points[i]!, points[s]!, points[e]!);
      if (d > dist) {
        dist = d;
        worst = i;
      }
    }
    if (worst !== -1 && dist > tolerance) {
      keep[worst] = true;
      stack.push([s, worst], [worst, e]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

export interface SimplifyResult {
  polygons: PolygonRings[];
  verticesBefore: number;
  verticesAfter: number;
  /** Rings left unchanged because simplifying them would have broken them (fewer than 3 vertices or a self-intersection). */
  keptRings: number;
}

const vertexTotal = (polys: PolygonRings[]) => polys.reduce((n, p) => n + p.reduce((m, r) => m + Math.max(0, r.length - 1), 0), 0);

/** Simplifies every ring. A ring whose simplified form is invalid (under a triangle, or self-intersecting) is
 * kept exactly as it was, so the operation can never produce an invalid draft. `tolerance` is in degrees. */
export function simplifyPolygons(polys: PolygonRings[], tolerance: number): SimplifyResult {
  let kept = 0;
  const out = polys.map((poly) =>
    poly.map((ring) => {
      if (ring.length <= 4) return ring;
      const open = ring.slice(0, -1);
      // The ring is treated as a closed polyline; its first/closing vertex is always kept.
      const closed: Ring = simplifyLine([...open, open[0]!], tolerance);
      if (closed.length < 4 || ringSelfIntersects(closed)) {
        kept++;
        return ring;
      }
      return closed;
    }),
  );
  return { polygons: out, verticesBefore: vertexTotal(polys), verticesAfter: vertexTotal(out), keptRings: kept };
}

// ---- snapping ----------------------------------------------------------------------------------------------

export interface SnapResult {
  point: Position;
  /** What it snapped to: an existing vertex, the nearest point on an edge, or nothing. */
  kind: "vertex" | "edge" | null;
}

/** Snaps `p` to the nearest existing vertex within `tolerance` (degrees), else to the nearest point on an
 * edge within `tolerance`, else leaves it. Vertices win over edges so shared corners stay shared. */
export function snapPoint(p: Position, polys: readonly PolygonRings[], tolerance: number, skip?: (polygon: number, ring: number, vertex: number) => boolean): SnapResult {
  let bestV: { d: number; pt: Position } | null = null;
  let bestE: { d: number; pt: Position } | null = null;
  polys.forEach((poly, pi) =>
    poly.forEach((ring, ri) => {
      for (let vi = 0; vi < ring.length - 1; vi++) {
        if (skip?.(pi, ri, vi)) continue;
        const a = ring[vi]!;
        const b = ring[vi + 1]!;
        const dv = Math.hypot(p[0] - a[0], p[1] - a[1]);
        if (dv <= tolerance && (!bestV || dv < bestV.d)) bestV = { d: dv, pt: [a[0], a[1]] };
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const len2 = dx * dx + dy * dy;
        if (len2 === 0) continue;
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
        const q: Position = [a[0] + t * dx, a[1] + t * dy];
        const de = Math.hypot(p[0] - q[0], p[1] - q[1]);
        if (de <= tolerance && (!bestE || de < bestE.d)) bestE = { d: de, pt: q };
      }
    }),
  );
  if (bestV) return { point: (bestV as { pt: Position }).pt, kind: "vertex" };
  if (bestE) return { point: (bestE as { pt: Position }).pt, kind: "edge" };
  return { point: p, kind: null };
}
