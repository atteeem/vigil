import { mesh } from "topojson-client";
import type { FeatureCollection, MultiLineString } from "geojson";
import { cutFeatureCollection } from "@/lib/map/antimeridian";
import { countriesObject, landObject, worldTopology } from "@/lib/globe/world-topology";

// Country borders (interior arcs, each drawn once) and coastlines for the flat
// map (heat mode and the bundled basemap), from the same Natural Earth topology as the globe's borders
// and land fill — so the lines meet the tinted land exactly.
let cached: FeatureCollection<MultiLineString, { kind: "border" | "coast" }> | null = null;

export function getHeatBorders(): FeatureCollection<MultiLineString, { kind: "border" | "coast" }> {
  if (cached) return cached;
  const borders = mesh(worldTopology, countriesObject, (a, b) => a !== b);
  const coast = mesh(worldTopology, landObject);
  // The topology stores its antimeridian cut as a 360-degree step, which a planar renderer draws as a line across the
  // whole map: cut the lines at the antimeridian for real (lib/map/antimeridian.ts).
  const cut = cutFeatureCollection<MultiLineString, { kind: "border" | "coast" }>({
    type: "FeatureCollection",
    features: [
      { type: "Feature", properties: { kind: "border" }, geometry: borders as MultiLineString },
      { type: "Feature", properties: { kind: "coast" }, geometry: coast as MultiLineString },
    ],
  });
  cached = cut as FeatureCollection<MultiLineString, { kind: "border" | "coast" }>;
  return cached;
}
