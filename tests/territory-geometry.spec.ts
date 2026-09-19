import { test, expect } from "@playwright/test";
import {
  differenceGeometry,
  edgeMidpoint,
  fromPolygons,
  insertVertex,
  intersectGeometry,
  moveVertex,
  planarArea,
  polygonFromPoints,
  polygonsOf,
  removeVertex,
  sameArea,
  splitGeometry,
  validateTerritorialGeometry,
  type PolygonRings,
} from "@/lib/territory/geometry";
import type { TerritorialGeometry } from "@/lib/types/territorial-control";

// Pure geometry: validation, split (boolean) operations and the vertex edits
// the visual editor is built from.

const square = (x0: number, y0: number, x1: number, y1: number): TerritorialGeometry => ({
  type: "Polygon",
  coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]],
});

test.describe("validateTerritorialGeometry", () => {
  test("accepts valid Polygon, MultiPolygon and a polygon with a hole", () => {
    expect(validateTerritorialGeometry(square(0, 0, 10, 10))).toEqual({ valid: true, errors: [] });
    expect(validateTerritorialGeometry({ type: "MultiPolygon", coordinates: [square(0, 0, 1, 1).coordinates, square(5, 5, 6, 6).coordinates] }).valid).toBe(true);
    const withHole: TerritorialGeometry = {
      type: "Polygon",
      coordinates: [
        [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
        [[2, 2], [4, 2], [4, 4], [2, 4], [2, 2]],
      ],
    };
    expect(validateTerritorialGeometry(withHole).valid).toBe(true);
  });

  test("rejects non-geometry, wrong type, and empty coordinates with clear messages", () => {
    expect(validateTerritorialGeometry(null).errors[0]).toMatch(/missing/i);
    expect(validateTerritorialGeometry({ type: "Point", coordinates: [1, 1] }).errors[0]).toMatch(/Polygon or MultiPolygon/);
    expect(validateTerritorialGeometry({ type: "Polygon", coordinates: [] }).errors[0]).toMatch(/no coordinates/i);
    expect(validateTerritorialGeometry({ type: "Polygon", coordinates: [[]] }).errors[0]).toMatch(/empty/i);
  });

  test("rejects an unclosed ring, too few points, a collapsed ring and a zero-area ring", () => {
    expect(validateTerritorialGeometry({ type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]] }).errors[0]).toMatch(/not closed/);
    expect(validateTerritorialGeometry({ type: "Polygon", coordinates: [[[0, 0], [1, 1], [0, 0]]] }).errors[0]).toMatch(/at least 3/);
    expect(validateTerritorialGeometry({ type: "Polygon", coordinates: [[[0, 0], [1, 1], [1, 1], [0, 0]]] }).errors[0]).toMatch(/at least 3 distinct/);
    expect(validateTerritorialGeometry({ type: "Polygon", coordinates: [[[0, 0], [1, 1], [2, 2], [0, 0]]] }).errors[0]).toMatch(/zero area/);
  });

  test("rejects out-of-range longitude/latitude and non-finite numbers", () => {
    expect(validateTerritorialGeometry(square(0, 0, 181, 10)).errors[0]).toMatch(/longitude 181/);
    expect(validateTerritorialGeometry(square(0, 0, 10, 91)).errors[0]).toMatch(/latitude 91/);
    expect(validateTerritorialGeometry({ type: "Polygon", coordinates: [[[0, 0], [NaN, 0], [1, 1], [0, 0]]] }).errors[0]).toMatch(/finite/);
  });

  test("rejects a self-intersecting (bow-tie) ring, and names which polygon in a MultiPolygon", () => {
    const bowtie = [[0, 0], [10, 10], [10, 0], [0, 10], [0, 0]];
    expect(validateTerritorialGeometry({ type: "Polygon", coordinates: [bowtie] }).errors[0]).toMatch(/crosses itself/);
    const multi = { type: "MultiPolygon", coordinates: [square(0, 0, 1, 1).coordinates, [bowtie]] };
    const result = validateTerritorialGeometry(multi);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/Polygon 2 outer ring/);
  });
});

test.describe("splitGeometry", () => {
  test("an overlapping area splits the base into affected + remainder that tile it exactly", () => {
    const base = square(0, 0, 10, 10);
    const { affected, remainder } = splitGeometry(base, square(6, -5, 15, 15));
    expect(planarArea(affected)).toBeCloseTo(40, 6);
    expect(planarArea(remainder)).toBeCloseTo(60, 6);
    expect(sameArea(affected!, square(6, 0, 10, 10))).toBe(true);
    expect(sameArea(remainder!, square(0, 0, 6, 10))).toBe(true);
    // No gap, no overlap.
    expect(planarArea(intersectGeometry(affected!, remainder!))).toBeCloseTo(0, 9);
    expect(planarArea(affected) + planarArea(remainder)).toBeCloseTo(planarArea(base), 9);
  });

  test("an area covering the whole base leaves no remainder; a disjoint area affects nothing", () => {
    expect(splitGeometry(square(0, 0, 10, 10), square(-1, -1, 11, 11)).remainder).toBeNull();
    expect(splitGeometry(square(0, 0, 10, 10), square(20, 20, 30, 30)).affected).toBeNull();
  });

  test("an area inside the base leaves a remainder with a hole; part outside the base is ignored", () => {
    const { affected, remainder } = splitGeometry(square(0, 0, 10, 10), square(4, 4, 6, 6));
    expect(planarArea(affected)).toBeCloseTo(4, 6);
    expect(planarArea(remainder)).toBeCloseTo(96, 6);
    expect(polygonsOf(remainder!)[0]!.length).toBe(2); // outer + hole
    expect(planarArea(splitGeometry(square(0, 0, 10, 10), square(8, 8, 100, 100)).affected)).toBeCloseTo(4, 6);
  });

  test("differenceGeometry that disconnects a shape yields a MultiPolygon", () => {
    const bar = square(4, -1, 6, 11);
    const rest = differenceGeometry(square(0, 0, 10, 10), bar)!;
    expect(rest.type).toBe("MultiPolygon");
    expect(planarArea(rest)).toBeCloseTo(80, 6);
  });
});

test.describe("vertex editing operations", () => {
  const tri: PolygonRings[] = [polygonFromPoints([[0, 0], [10, 0], [5, 8]])!];

  test("polygonFromPoints closes the ring and needs at least three points", () => {
    expect(tri[0]![0]).toHaveLength(4);
    expect(tri[0]![0]![0]).toEqual(tri[0]![0]![3]);
    expect(polygonFromPoints([[0, 0], [1, 1]])).toBeNull();
  });

  test("moveVertex moves a vertex, and both copies when it is the closing vertex", () => {
    const moved = moveVertex(tri, { polygon: 0, ring: 0, vertex: 1 }, [12, 1]);
    expect(moved[0]![0]![1]).toEqual([12, 1]);
    const first = moveVertex(tri, { polygon: 0, ring: 0, vertex: 0 }, [-2, -2]);
    expect(first[0]![0]![0]).toEqual([-2, -2]);
    expect(first[0]![0]![3]).toEqual([-2, -2]);
    expect(tri[0]![0]![0]).toEqual([0, 0]); // input untouched
  });

  test("insertVertex adds a point on an edge; the shape stays valid and gains a vertex", () => {
    const ring = tri[0]![0]!;
    const next = insertVertex(tri, { polygon: 0, ring: 0, vertex: 0 }, edgeMidpoint(ring, 0));
    expect(next[0]![0]).toHaveLength(5);
    expect(next[0]![0]![1]).toEqual([5, 0]);
    expect(validateTerritorialGeometry(fromPolygons(next)).valid).toBe(true);
  });

  test("removeVertex drops a vertex but refuses to collapse a triangle; removing the first vertex keeps the ring closed", () => {
    expect(removeVertex(tri, { polygon: 0, ring: 0, vertex: 1 })).toBe(tri); // unchanged
    const quad: PolygonRings[] = [polygonFromPoints([[0, 0], [10, 0], [10, 10], [0, 10]])!];
    const noFirst = removeVertex(quad, { polygon: 0, ring: 0, vertex: 0 });
    const ring = noFirst[0]![0]!;
    expect(ring).toHaveLength(4);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(validateTerritorialGeometry(fromPolygons(noFirst)).valid).toBe(true);
  });

  test("fromPolygons: none -> null, one -> Polygon, several -> MultiPolygon", () => {
    expect(fromPolygons([])).toBeNull();
    expect(fromPolygons(tri)!.type).toBe("Polygon");
    expect(fromPolygons([tri[0]!, polygonFromPoints([[20, 20], [30, 20], [25, 28]])!])!.type).toBe("MultiPolygon");
  });
});
