import type { TerritoryDTO, TerritoryFeatureProperties } from "@/lib/types/territorial-control";

/** Territorial Control Mode — converts reconstructed territory rows into
 * the single GeoJSON FeatureCollection world-map.tsx's "territory" source
 * renders (spec §10 "avoid one DOM element per polygon" — MapLibre draws
 * every feature in one GPU-composited source/layer, same reasoning as
 * lib/map/events-to-geojson.ts for markers). `properties` is flattened
 * (string/number only) since MapLibre paint/filter expressions can't
 * address nested objects. */
export function territoriesToGeoJSON(territories: TerritoryDTO[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: territories.map((t) => {
      const properties: TerritoryFeatureProperties = {
        id: t.id,
        conflictId: t.conflictId,
        conflictName: t.conflictName,
        actorId: t.actorId,
        actorName: t.actorName,
        actorColor: t.actorColor,
        status: t.status,
        confidence: t.confidence,
        sourceName: t.sourceName,
        sourceUrl: t.sourceUrl,
        validFrom: t.validFrom,
        validTo: t.validTo,
        lastUpdated: t.updatedAt,
      };
      return {
        type: "Feature",
        id: t.id,
        geometry: t.geometry,
        properties,
      };
    }),
  };
}
