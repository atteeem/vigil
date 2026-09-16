import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import landTopo from "world-atlas/land-110m.json";

let cached: Feature<Polygon | MultiPolygon>[] | null = null;

/**
 * Original-source landmass geometry for the globe's hex-polygon layer.
 * Uses public-domain Natural Earth boundaries (via `world-atlas`) rendered
 * through our own stylized hex-bin renderer — not a satellite photo, and not
 * any third-party product's visual asset.
 */
export function getLandFeatures(): Feature<Polygon | MultiPolygon>[] {
  if (cached) return cached;
  const topology = landTopo as unknown as Topology;
  const object = topology.objects.land as GeometryCollection;
  const collection = feature(topology, object);
  cached = collection.features as Feature<Polygon | MultiPolygon>[];
  return cached;
}
