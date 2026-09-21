import { test, expect } from "@playwright/test";
import { canRedo, canUndo, createHistory, cutHole, HISTORY_LIMIT, mergePolygons, pushHistory, redo, simplifyLine, simplifyPolygons, snapPoint, undo } from "@/lib/territory/edit-tools";
import { fromPolygons, planarArea, validateTerritorialGeometry, type PolygonRings, type Position } from "@/lib/territory/geometry";

// Territorial editor tools (pure): edit history, holes, merge, simplify and snapping. They change only the
// draft geometry; publishing/versioning is covered by the territorial-control specs and is unchanged.

const square = (x: number, y: number, size: number): PolygonRings => [[[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]]];
const area = (polys: PolygonRings[]) => planarArea(fromPolygons(polys));
const valid = (polys: PolygonRings[]) => validateTerritorialGeometry(fromPolygons(polys)).valid;

test.describe("edit history", () => {
  test("undo / redo walk the snapshots; a new edit clears redo; no-op edits are ignored; depth is bounded", () => {
    let h = createHistory<PolygonRings[]>([square(0, 0, 1)]);
    expect(canUndo(h)).toBe(false);
    const a = [square(0, 0, 2)];
    const b = [square(0, 0, 3)];
    h = pushHistory(pushHistory(h, a), b);
    expect(h.present).toBe(b);
    expect(pushHistory(h, b)).toBe(h); // same state: nothing recorded
    h = undo(h);
    expect(h.present).toBe(a);
    expect(canRedo(h)).toBe(true);
    h = redo(h);
    expect(h.present).toBe(b);
    h = undo(undo(h));
    expect(h.present).toEqual([square(0, 0, 1)]);
    expect(undo(h)).toBe(h); // nothing left to undo
    h = pushHistory(h, [square(5, 5, 1)]);
    expect(canRedo(h)).toBe(false); // a new edit after undo discards the old future
    let long = createHistory(0);
    for (let i = 1; i <= HISTORY_LIMIT + 20; i++) long = pushHistory(long, i);
    expect(long.past.length).toBe(HISTORY_LIMIT);
    expect(long.present).toBe(HISTORY_LIMIT + 20);
  });
});

test.describe("holes and merging", () => {
  test("a ring inside a polygon becomes a hole (interior ring), reducing area exactly by the hole", () => {
    const out = cutHole([square(0, 0, 10)], 0, square(3, 3, 2)[0]!)!;
    expect(out).toHaveLength(1);
    expect(out[0]).toHaveLength(2); // outer + one hole
    expect(area(out)).toBeCloseTo(100 - 4, 6);
    expect(valid(out)).toBe(true);
  });

  test("a ring crossing the edge notches the outline; a ring elsewhere or a degenerate ring changes nothing", () => {
    const notched = cutHole([square(0, 0, 10)], 0, square(8, 8, 4)[0]!)!;
    expect(notched[0]).toHaveLength(1);
    expect(area(notched)).toBeCloseTo(100 - 4, 6);
    expect(valid(notched)).toBe(true);
    expect(cutHole([square(0, 0, 10)], 0, square(20, 20, 2)[0]!)).toBeNull();
    expect(cutHole([square(0, 0, 10)], 0, [[0, 0], [1, 1], [0, 0]])).toBeNull();
    expect(cutHole([square(0, 0, 10)], 5, square(3, 3, 2)[0]!)).toBeNull();
  });

  test("other polygons of a MultiPolygon draft are left alone when one gets a hole", () => {
    const out = cutHole([square(0, 0, 10), square(50, 50, 5)], 0, square(3, 3, 2)[0]!)!;
    expect(out).toHaveLength(2);
    expect(out[1]).toEqual(square(50, 50, 5));
  });

  test("merge fuses overlapping and touching polygons and keeps separate ones separate", () => {
    const fused = mergePolygons([square(0, 0, 4), square(3, 0, 4)]);
    expect(fused).toHaveLength(1);
    expect(area(fused)).toBeCloseTo(28, 6); // two 4x4 squares overlapping by 1x4: 16 + 16 - 4
    expect(valid(fused)).toBe(true);
    expect(mergePolygons([square(0, 0, 1), square(10, 10, 1)])).toHaveLength(2);
    const one = [square(0, 0, 1)];
    expect(mergePolygons(one)).toBe(one);
  });
});

test.describe("simplify", () => {
  const circle = (n: number, r: number): Position[] => Array.from({ length: n }, (_, i) => [r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n)] as Position);

  test("Douglas-Peucker removes near-collinear points and keeps the ends", () => {
    const line: Position[] = [[0, 0], [1, 0.001], [2, -0.001], [3, 0], [4, 5]];
    const s = simplifyLine(line, 0.01);
    expect(s[0]).toEqual([0, 0]);
    expect(s.at(-1)).toEqual([4, 5]);
    expect(s.length).toBeLessThan(line.length);
    expect(simplifyLine(line, 0)).toHaveLength(line.length);
  });

  test("a finely sampled outline loses vertices, stays valid and keeps nearly the same area; huge tolerance never breaks a ring", () => {
    const ring = [...circle(360, 5), circle(360, 5)[0]!];
    const before = area([[ring]]);
    const r = simplifyPolygons([[ring]], 0.05);
    expect(r.verticesAfter).toBeLessThan(r.verticesBefore / 4);
    expect(valid(r.polygons)).toBe(true);
    expect(Math.abs(area(r.polygons) - before) / before).toBeLessThan(0.02);
    const extreme = simplifyPolygons([[ring]], 100);
    expect(valid(extreme.polygons)).toBe(true); // either simplified to a valid shape or kept as it was
    expect(extreme.polygons[0]![0]!.length).toBeGreaterThanOrEqual(4);
    const tri: PolygonRings = [[[0, 0], [1, 0], [0, 1], [0, 0]]];
    expect(simplifyPolygons([tri], 10).polygons[0]).toEqual(tri);
  });
});

test.describe("snapping", () => {
  const polys = [square(0, 0, 10)];

  test("snaps to a vertex within tolerance, then to an edge, otherwise leaves the point", () => {
    expect(snapPoint([10.02, 0.03], polys, 0.1)).toEqual({ point: [10, 0], kind: "vertex" });
    const edge = snapPoint([5, 0.04], polys, 0.1);
    expect(edge.kind).toBe("edge");
    expect(edge.point[0]).toBeCloseTo(5, 9);
    expect(edge.point[1]).toBeCloseTo(0, 9);
    expect(snapPoint([5, 5], polys, 0.1)).toEqual({ point: [5, 5], kind: null });
  });

  test("a vertex beats a nearer-looking edge, the nearest vertex wins, and the dragged vertex itself can be skipped", () => {
    const two = [square(0, 0, 10), square(10.05, 0, 10)];
    expect(snapPoint([10.03, 0.01], two, 0.2).point).toEqual([10.05, 0]);
    const own = snapPoint([10, 10], polys, 0.1, (p, r, v) => p === 0 && r === 0 && (v === 2 || v === 3));
    expect(own.kind === "vertex" && own.point[0] === 10 && own.point[1] === 10).toBe(false);
  });
});
