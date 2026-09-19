import type { FeatureCollection, Point } from "geojson";
import type { ConflictEvent } from "@/lib/types";
import { reportCountOf } from "@/lib/map/report-counts";

export interface EventFeatureProps {
  id: string;
  slug: string;
  title: string;
  eventType: string;
  severity: string;
  importance: number;
  /** "exact" | "approximate" | "area_level" | "unknown" | "" (not recorded). */
  precision: string;
  /** Supporting reports (uncapped) — summed by the cluster source, capped only for display. */
  reportCount: number;
}

export function eventsToGeoJSON(
  events: ConflictEvent[],
): FeatureCollection<Point, EventFeatureProps> {
  return {
    type: "FeatureCollection",
    features: events.map((e) => ({
      type: "Feature",
      id: e.id,
      geometry: { type: "Point", coordinates: [e.lng, e.lat] },
      properties: {
        id: e.id,
        slug: e.slug,
        title: e.title,
        eventType: e.eventType,
        severity: e.severity,
        importance: e.importance,
        precision: e.locationPrecision ?? "",
        reportCount: reportCountOf(e),
      },
    })),
  };
}
