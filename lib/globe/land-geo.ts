import { feature } from "topojson-client";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import { landObject, worldTopology } from "@/lib/globe/world-topology";

let cached: Feature<Polygon | MultiPolygon>[] | null = null;

/**
 * Landmass geometry for the globe's polygon fill — from the SAME topology
 * as the border lines and labels (lib/globe/world-topology.ts), so the fill's
 * edge (the coastline) is exactly where the borders meet the sea.
 */
export function getLandFeatures(): Feature<Polygon | MultiPolygon>[] {
  if (cached) return cached;
  const collection = feature(worldTopology, landObject);
  cached = collection.features as Feature<Polygon | MultiPolygon>[];
  return cached;
}
