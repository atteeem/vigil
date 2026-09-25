import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { feature } from "topojson-client";
import type { Feature, MultiPolygon, Polygon, Position } from "geojson";
import { getCountryBorderPaths, getCountryLabels } from "@/lib/globe/country-borders";
import { getLandFeatures } from "@/lib/globe/land-geo";
import { countriesObject, worldTopology } from "@/lib/globe/world-topology";

// Geometry-level guarantees for the globe's border path: one authoritative
// source, shared borders drawn once, no coastline tracing, land/borders/labels
// aligned by construction. (Visual inspection is separate — see the manual
// verification notes — but these pin the causes of the malformed-border bug.)

const countries = (feature(worldTopology, countriesObject) as unknown as { features: Feature<Polygon | MultiPolygon, { name?: string }>[] }).features;
const ringsOf = (g: Polygon | MultiPolygon): Position[][] => (g.type === "Polygon" ? g.coordinates : g.coordinates.flat());
const key = (p: Position) => `${p[0]!.toFixed(4)},${p[1]!.toFixed(4)}`;
const edgeKey = (a: Position, b: Position) => [key(a), key(b)].sort().join("|");

// Country ring edges: an edge used by two countries is a shared border, by one a coastline.
const edgeUse = new Map<string, number>();
const edgeCountries = new Map<string, Set<string>>();
const vertices = new Set<string>();
for (const c of countries) {
  for (const ring of ringsOf(c.geometry)) {
    for (let i = 0; i < ring.length; i++) {
      vertices.add(key(ring[i]!));
      if (i > 0) {
        const k = edgeKey(ring[i - 1]!, ring[i]!);
        edgeUse.set(k, (edgeUse.get(k) ?? 0) + 1);
        edgeCountries.set(k, (edgeCountries.get(k) ?? new Set()).add(c.properties?.name ?? "?"));
      }
    }
  }
}

// Border paths are [lat, lng]; the geometry above is [lng, lat].
const borderEdges: string[] = [];
for (const path of getCountryBorderPaths()) {
  for (let i = 1; i < path.points.length; i++) {
    const [la0, ln0] = path.points[i - 1]!;
    const [la1, ln1] = path.points[i]!;
    borderEdges.push(edgeKey([ln0, la0], [ln1, la1]));
  }
}

test.describe("Globe border geometry (lib/globe/country-borders.ts)", () => {
  test("1. Borders exist and cover the world, with full-resolution (undecimated) lines", () => {
    const paths = getCountryBorderPaths();
    expect(paths.length).toBeGreaterThan(50);
    expect(borderEdges.length).toBeGreaterThan(2000);
  });

  test("2. No duplicate or overlapping lines: every border segment is emitted exactly once", () => {
    expect(new Set(borderEdges).size).toBe(borderEdges.length);
  });

  test("3. Only shared (interior) boundaries are drawn — coastlines are never traced by the border layer", () => {
    const coast = borderEdges.filter((e) => edgeUse.get(e) === 1);
    expect(coast).toHaveLength(0);
  });

  test("4. Every shared boundary in the source data is drawn (no border dropped)", () => {
    // Shared between two DIFFERENT countries (an edge a country shares with
    // itself is just a ring cut at the antimeridian, not a border).
    const shared = [...edgeCountries.entries()].filter(([, names]) => names.size >= 2).map(([e]) => e);
    expect(shared.length).toBeGreaterThan(2000);
    const drawn = new Set(borderEdges);
    const missing = shared.filter((e) => !drawn.has(e));
    expect(missing.length).toBe(0);
  });

  test("5. Border vertices lie exactly on the country geometry (same source as the land fill)", () => {
    for (const path of getCountryBorderPaths()) {
      for (const [lat, lng] of path.points) expect(vertices.has(key([lng, lat]))).toBe(true);
    }
  });

  test("6. The landmass fill comes from the same topology: every land vertex is a country vertex", () => {
    let total = 0;
    let onCountry = 0;
    for (const f of getLandFeatures()) {
      for (const ring of ringsOf(f.geometry)) {
        for (const p of ring) {
          total++;
          if (vertices.has(key(p))) onCountry++;
        }
      }
    }
    expect(total).toBeGreaterThan(1000);
    expect(onCountry).toBe(total);
  });

  test("7. No line streaks across the antimeridian and coordinates are valid", () => {
    for (const path of getCountryBorderPaths()) {
      for (let i = 0; i < path.points.length; i++) {
        const [lat, lng] = path.points[i]!;
        expect(Math.abs(lat)).toBeLessThanOrEqual(90);
        expect(Math.abs(lng)).toBeLessThanOrEqual(180);
        if (i > 0) expect(Math.abs(lng - path.points[i - 1]![1])).toBeLessThan(60);
      }
    }
  });

  test("8. Regional spot checks: borders exist in Europe, Africa, the Middle East, Central Asia and East Asia", () => {
    const inBox = (lat0: number, lat1: number, lng0: number, lng1: number) =>
      getCountryBorderPaths().some((p) => p.points.some(([lat, lng]) => lat >= lat0 && lat <= lat1 && lng >= lng0 && lng <= lng1));
    expect(inBox(45, 55, 5, 25)).toBe(true); // Europe
    expect(inBox(0, 15, 10, 30)).toBe(true); // Africa
    expect(inBox(28, 36, 35, 50)).toBe(true); // Middle East
    expect(inBox(38, 45, 60, 75)).toBe(true); // Central Asia
    expect(inBox(30, 45, 105, 130)).toBe(true); // East Asia
  });

  test("9. Labels are drawn from the same countries: unique names, inside their country's bounds, higher tiers are supersets", () => {
    const all = getCountryLabels(9);
    expect(new Set(all.map((l) => l.name)).size).toBe(all.length);
    const byName = new Map(countries.map((c) => [c.properties?.name, c]));
    for (const label of all) {
      const c = byName.get(label.name)!;
      const pts = ringsOf(c.geometry).flat();
      const lngs = pts.map((p) => p[0]!);
      const lats = pts.map((p) => p[1]!);
      expect(label.lng).toBeGreaterThanOrEqual(Math.min(...lngs) - 0.01);
      expect(label.lng).toBeLessThanOrEqual(Math.max(...lngs) + 0.01);
      expect(label.lat).toBeGreaterThanOrEqual(Math.min(...lats) - 0.01);
      expect(label.lat).toBeLessThanOrEqual(Math.max(...lats) + 0.01);
    }
    const t1 = new Set(getCountryLabels(1).map((l) => l.name));
    const t2 = new Set(getCountryLabels(2).map((l) => l.name));
    expect(t1.size).toBeGreaterThan(10);
    expect(t2.size).toBeGreaterThan(t1.size);
    for (const n of t1) expect(t2.has(n)).toBe(true);
    expect(t1.has("Russia")).toBe(true);
  });

  test("10. The globe component uses one neutral border style and no territorial/heat/disputed styling on it", () => {
    const src = readFileSync("components/globe/conflict-globe.tsx", "utf8");
    expect(src).toContain("pathColor={() => BORDER_COLOR}");
    expect(src).not.toMatch(/pathColor=\{[^}]*(disputed|territor|heat)/i);
    // The land fill is part of the surface texture (lib/globe/surface-texture.ts), so there is no polygon stroke to
    // double the coastline: the border layer is the only line layer.
    expect(src).not.toContain("polygonStrokeColor");
  });
});
