import type { FeatureCollection, Point } from "geojson";
import type { ConflictEvent } from "@/lib/types";
import { buildEventMarkers } from "@/lib/map/intelligence-markers";

export interface EventFeatureProps {
  id: string;
  slug: string;
  title: string;
  eventType: string;
  severity: string;
  importance: number;
  /** "exact" | "approximate" | "area_level" | "unknown" | "" (not recorded). */
  precision: string;
  /** point | city | region: how far the marker position is known. */
  scope: string;
  /** Supporting reports (uncapped) — summed by the cluster source, capped only for display. */
  reportCount: number;
}

export function eventsToGeoJSON(
  events: ConflictEvent[],
): FeatureCollection<Point, EventFeatureProps> {
  const byId = new Map(events.map((e) => [e.id, e]));
  return {
    type: "FeatureCollection",
    // Only events with a point are markers; country-level / unknown-location reports have none. The report count
    // comes from the canonical marker aggregation (unique reports), shared with the globe.
    features: buildEventMarkers(events).map((m) => {
      const e = byId.get(m.id)!;
      return {
        type: "Feature" as const,
        id: e.id,
        geometry: { type: "Point" as const, coordinates: [m.longitude, m.latitude] },
        properties: {
          id: e.id,
          slug: e.slug,
          title: e.title,
          eventType: e.eventType,
          severity: e.severity,
          importance: e.importance,
          precision: e.locationPrecision ?? "",
          scope: m.scope,
          reportCount: m.reportCount,
        },
      };
    }),
  };
}
