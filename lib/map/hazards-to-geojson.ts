import type { HazardFeatureProps } from "@/lib/hazards/public-types";

type HazardFeature = GeoJSON.Feature<GeoJSON.Geometry, HazardFeatureProps>;

export interface HazardSourceData {
  /** Earthquakes: clustered client-side (rings sized by magnitude). */
  quakes: GeoJSON.FeatureCollection;
  /** Thermal detections and their server-side aggregates. */
  thermal: GeoJSON.FeatureCollection;
  /** Reported wildfires, volcanoes. */
  points: GeoJSON.FeatureCollection;
  /** Alert areas (polygons) and area-less alert points. */
  weather: GeoJSON.FeatureCollection;
  /** Transport and infrastructure (aviation, maritime, energy, internet): points, airspace areas, energy aggregates. */
  ops: GeoJSON.FeatureCollection;
}

const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: "FeatureCollection", features });

/** Splits the API response into the four map sources (each with its own rendering rules). */
export function hazardsToSources(features: readonly HazardFeature[]): HazardSourceData {
  const quakes: GeoJSON.Feature[] = [];
  const thermal: GeoJSON.Feature[] = [];
  const points: GeoJSON.Feature[] = [];
  const weather: GeoJSON.Feature[] = [];
  const ops: GeoJSON.Feature[] = [];
  for (const f of features) {
    switch (f.properties.layer) {
      case "earthquakes":
        quakes.push(f);
        break;
      case "weather":
        weather.push(f);
        break;
      case "volcanoes":
        points.push(f);
        break;
      case "aviation":
      case "maritime":
      case "energy":
      case "internet":
        ops.push(f);
        break;
      case "fires":
        (f.properties.kind === "confirmed_wildfire" ? points : thermal).push(f);
        break;
    }
  }
  return { quakes: fc(quakes), thermal: fc(thermal), points: fc(points), weather: fc(weather), ops: fc(ops) };
}

export const EMPTY_HAZARD_SOURCES: HazardSourceData = hazardsToSources([]);
