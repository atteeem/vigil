import { test, expect } from "@playwright/test";
import type { Feature, FeatureCollection, MultiPolygon, Polygon, Position } from "geojson";
import { cutLine, cutPolygon } from "@/lib/map/antimeridian";
import { getHeatBorders } from "@/lib/heat/borders";
import { buildBundledStyle } from "@/lib/map/vigil-style";

// The flat (Web-Mercator) basemap draws Natural Earth's land and coastline as planar GeoJSON. The source topology
// stores its antimeridian cut as a 360-degree step (lng 180 -> -180), which a planar renderer draws as a line across
// the whole map and fills as a polygon spanning the world (the "large malformed polygon over the North Atlantic" and
// the horizontal lines). These are the pure rules that keep that from coming back: lib/map/antimeridian.ts cuts the
// data, never the paint.

const ring = (pts: Position[]) => [...pts, pts[0]!];
function area(r: Position[]) {
  let a = 0;
  for (let i = 0; i < r.length - 1; i++) a += r[i]![0]! * r[i + 1]![1]! - r[i + 1]![0]! * r[i]![1]!;
  return Math.abs(a / 2);
}
const maxStep = (pts: Position[]) => pts.reduce((m, p, i) => (i ? Math.max(m, Math.abs(p[0]! - pts[i - 1]![0]!)) : m), 0);

test.describe("Antimeridian cutting (pure geometry)", () => {
  test("a polygon straddling the antimeridian becomes two polygons, same total area, nothing wider than the world", () => {
    // 20 x 10 degrees, centred on the seam, written the way the topology does: 170 -> 180 | -180 -> -170.
    const straddling = [ring([[170, 0], [180, 0], [-180, 0], [-170, 0], [-170, 10], [-180, 10], [180, 10], [170, 10]])];
    const cut = cutPolygon(straddling);
    expect(cut).toHaveLength(2);
    expect(cut.reduce((s, p) => s + area(p[0]!), 0)).toBeCloseTo(200, 6);
    for (const polygon of cut) {
      for (const [lng] of polygon[0]!) {
        expect(lng).toBeGreaterThanOrEqual(-180);
        expect(lng).toBeLessThanOrEqual(180);
      }
      expect(maxStep(polygon[0]!)).toBeLessThanOrEqual(20);
    }
  });

  test("a polygon that does not cross the seam is returned as one polygon, unchanged in area", () => {
    const cut = cutPolygon([ring([[10, 10], [30, 10], [30, 20], [10, 20]])]);
    expect(cut).toHaveLength(1);
    expect(area(cut[0]![0]!)).toBeCloseTo(200, 6);
  });

  test("a ring that winds once around the South Pole (Antarctica) is closed through the pole, not straight across", () => {
    const antarctica = ring([[-180, -80], [-90, -75], [0, -78], [90, -72], [180, -80], [-180, -80]]);
    const [polygon] = cutPolygon([antarctica]);
    expect(polygon).toBeDefined();
    const outer = polygon![0]!;
    expect(outer.some((p) => p[1] === -90)).toBe(true);
    // The cap between the coast (~-77) and the pole is inside the shape: 360 x ~13 degrees.
    expect(area(outer)).toBeGreaterThan(360 * 10);
  });

  test("a line crossing the antimeridian is split at it, each half ending exactly on the seam at the same latitude", () => {
    const parts = cutLine([[170, 60], [-170, 70]]);
    expect(parts).toHaveLength(2);
    const east = parts.find((p) => p.some((q) => q[0] === 180))!;
    const west = parts.find((p) => p.some((q) => q[0] === -180))!;
    expect(east.find((q) => q[0] === 180)![1]).toBeCloseTo(65, 6);
    expect(west.find((q) => q[0] === -180)![1]).toBeCloseTo(65, 6);
    for (const part of parts) expect(maxStep(part)).toBeLessThanOrEqual(10);
  });

  test("the stored 180 -> -180 step on its own line produces no segment at all", () => {
    expect(cutLine([[180, 10], [-180, 10]])).toHaveLength(0);
  });
});

test.describe("Bundled flat-map geometry (Natural Earth 110m)", () => {
  test("coastline and border lines have no segment that jumps across the world, and stay inside lng/lat range", () => {
    for (const f of getHeatBorders().features) {
      for (const line of f.geometry.coordinates) {
        expect(maxStep(line)).toBeLessThan(180);
        for (const [lng, lat] of line) {
          expect(lng).toBeGreaterThanOrEqual(-180);
          expect(lng).toBeLessThanOrEqual(180);
          expect(Math.abs(lat!)).toBeLessThanOrEqual(90);
        }
      }
    }
  });

  test("the bundled land fill has no edge wider than 180 degrees except the single pole edge that closes Antarctica", () => {
    const style = buildBundledStyle("http://localhost/{fontstack}/{range}.pbf");
    const land = (style.sources["vigil-land"] as { data: FeatureCollection<Polygon | MultiPolygon> }).data;
    let wide = 0;
    let rings = 0;
    for (const f of land.features as Feature<Polygon | MultiPolygon>[]) {
      const polygons = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const polygon of polygons) {
        for (const r of polygon) {
          rings++;
          for (let i = 1; i < r.length; i++) {
            const [lng, lat] = r[i]!;
            expect(lng).toBeGreaterThanOrEqual(-180);
            expect(lng).toBeLessThanOrEqual(180);
            if (Math.abs(lng! - r[i - 1]![0]!) > 180) {
              wide++;
              expect(lat).toBe(-90); // the polar closing edge, off the Mercator map
            }
          }
        }
      }
    }
    expect(rings).toBeGreaterThan(100);
    expect(wide).toBe(1);
  });
});
