import { test, expect } from "@playwright/test";
import { getLandFeatures } from "@/lib/globe/land-geo";
import { validateTerritorialGeometry } from "@/lib/territory/geometry";

// Pure geometry rules behind a clean globe and map: coordinates in range, antimeridian crossings handled explicitly,
// and no polygon that a planar renderer would stretch across the whole world.

const ringsOf = () => getLandFeatures().flatMap((f) => (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates)).flat();

/** Unwraps a ring's longitudes across the seam; returns the total span and whether it winds once around a pole. */
function unwrap(ring: number[][]) {
  let offset = 0;
  let prev = ring[0]![0]!;
  let min = Infinity;
  let max = -Infinity;
  for (const [lng] of ring) {
    if (lng! - prev > 180) offset -= 360;
    else if (lng! - prev < -180) offset += 360;
    prev = lng!;
    min = Math.min(min, lng! + offset);
    max = Math.max(max, lng! + offset);
  }
  return { span: max - min, windsPole: Math.abs(offset) >= 360 - 1e-6 };
}

test.describe("Globe land geometry (Natural Earth 110m)", () => {
  test("every coordinate is in range", () => {
    for (const ring of ringsOf()) for (const [lng, lat] of ring) {
      expect(lng).toBeGreaterThanOrEqual(-180);
      expect(lng).toBeLessThanOrEqual(180);
      expect(lat).toBeGreaterThanOrEqual(-90);
      expect(lat).toBeLessThanOrEqual(90);
    }
  });

  test("no ring spans the world once unwrapped, except the one that winds around the South Pole (Antarctica)", () => {
    const winders = ringsOf().filter((r) => unwrap(r).windsPole);
    expect(winders).toHaveLength(1);
    expect(Math.max(...winders[0]!.map((p) => -p[1]!))).toBeGreaterThan(60); // southern
    for (const ring of ringsOf()) {
      const u = unwrap(ring);
      if (!u.windsPole) expect(u.span).toBeLessThan(220); // Afro-Eurasia incl. Chukotka is the widest real ring (~208 degrees)
    }
  });

  test("seam crossings happen only at +/-180 (a cut, not a stray long edge through the map)", () => {
    for (const ring of ringsOf()) {
      for (let i = 1; i < ring.length; i++) {
        const a = ring[i - 1]!;
        const b = ring[i]!;
        if (Math.abs(b[0]! - a[0]!) > 180) {
          // One end lies ON the cut, the other within a vertex step of it on the far side (topology quantization).
          expect(Math.min(Math.abs(Math.abs(a[0]!) - 180), Math.abs(Math.abs(b[0]!) - 180))).toBeLessThan(1e-6);
          expect(Math.max(Math.abs(Math.abs(a[0]!) - 180), Math.abs(Math.abs(b[0]!) - 180))).toBeLessThan(2);
        }
      }
    }
  });
});

test.describe("Territorial geometry: antimeridian and MultiPolygon rules", () => {
  test("a ring that steps across the antimeridian is rejected (it would render as a world-spanning band)", () => {
    const wrapping = { type: "Polygon", coordinates: [[[170, 60], [-170, 60], [-170, 65], [170, 65], [170, 60]]] };
    const v = validateTerritorialGeometry(wrapping);
    expect(v.valid).toBe(false);
    expect(v.errors.join(" ")).toMatch(/antimeridian/);
  });

  test("the same area split at 180 into a MultiPolygon is accepted", () => {
    const split = {
      type: "MultiPolygon",
      coordinates: [
        [[[170, 60], [180, 60], [180, 65], [170, 65], [170, 60]]],
        [[[-180, 60], [-170, 60], [-170, 65], [-180, 65], [-180, 60]]],
      ],
    };
    expect(validateTerritorialGeometry(split)).toEqual({ valid: true, errors: [] });
  });

  test("problematic MultiPolygons are rejected part by part: empty part, out-of-range part, unclosed part", () => {
    const good = [[[30, 48], [31, 48], [31, 49], [30, 49], [30, 48]]];
    expect(validateTerritorialGeometry({ type: "MultiPolygon", coordinates: [good, []] }).errors.join(" ")).toMatch(/Polygon 2: has no rings/);
    expect(validateTerritorialGeometry({ type: "MultiPolygon", coordinates: [good, [[[30, 48], [31, 95], [31, 49], [30, 48]]]] }).errors.join(" ")).toMatch(/Polygon 2.*latitude 95/);
    expect(validateTerritorialGeometry({ type: "MultiPolygon", coordinates: [good, [[[30, 48], [31, 48], [31, 49], [30, 49]]]] }).errors.join(" ")).toMatch(/Polygon 2.*not closed/);
    expect(validateTerritorialGeometry({ type: "MultiPolygon", coordinates: [good] }).valid).toBe(true);
  });
});
