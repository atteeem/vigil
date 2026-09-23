import { buildEventMarkers } from "@/lib/map/intelligence-markers";
import type { ConflictEvent, Severity } from "@/lib/types";
import { maxSeverity } from "@/lib/utils/severity";
import { formatReportCount } from "@/lib/map/report-counts";

export interface EventCluster {
  lat: number;
  lng: number;
  /** Number of EVENTS grouped here. */
  count: number;
  /** SUM of the supporting reports of the grouped events (uncapped; the
   * label is what gets capped, via formatClusterCount). This is the number
   * the marker displays — never the event count. */
  reportCount: number;
  /** Worst (max-ranked) severity among the cluster's events — same
   * "max, never an average or the count" principle the heat field
   * uses (lib/heat/field.ts), so a cluster of mostly-minor
   * reports with one severe incident still reads as severe, and a big
   * cluster of low-severity reports never inflates into looking severe
   * purely from its size. */
  severity: Severity;
  ids: string[];
}

/** Greedily groups events within `radiusDegrees` of each other into
 * clusters, recentering each cluster's point to the running centroid of
 * its members as they're added. Degrees rather than a true haversine
 * distance — this is a display-density heuristic for the 3D globe (see
 * ConflictGlobe's altitude-to-radius mapping), not a geospatial query, and
 * plain lat/lng deltas are cheap enough to run on every camera-altitude
 * change without a spatial index. Order-dependent (a single left-to-right
 * pass, not a globally optimal clustering) — acceptable for a "how many
 * reports are roughly here" marker, not for anything requiring a precise
 * partition. */
export function clusterEvents(events: ConflictEvent[], radiusDegrees: number): EventCluster[] {
  const clusters: EventCluster[] = [];
  // The same canonical markers the flat map draws: each carries its UNIQUE report count.
  for (const m of buildEventMarkers(events)) {
    const e = { id: m.id, lat: m.latitude, lng: m.longitude, severity: m.severity, reportCount: m.reportCount };
    const existing = clusters.find(
      (c) => Math.abs(c.lat - e.lat) <= radiusDegrees && Math.abs(c.lng - e.lng) <= radiusDegrees,
    );
    if (existing) {
      const n = existing.count;
      existing.lat = (existing.lat * n + e.lat) / (n + 1);
      existing.lng = (existing.lng * n + e.lng) / (n + 1);
      existing.count = n + 1;
      existing.reportCount += e.reportCount;
      existing.ids.push(e.id);
      existing.severity = maxSeverity(existing.severity, e.severity) as Severity;
    } else {
      clusters.push({ lat: e.lat, lng: e.lng, count: 1, reportCount: e.reportCount, severity: e.severity, ids: [e.id] });
    }
  }
  return clusters;
}

/** Maps the globe's camera altitude (three-globe's unitless "how many
 * globe-radii away" distance — bigger number is further out/more zoomed
 * out) to a clustering radius in degrees: zoomed far out clusters
 * aggressively (a whole region collapses to one marker), zoomed in barely
 * clusters at all (individual nearby reports stay distinct). Tuned against
 * this app's own camera bounds (ConflictGlobe's controls.minDistance/
 * maxDistance, translated to altitude, and its own initial ~2.15-2.6
 * altitude), not a general-purpose formula. */
export function clusterRadiusForAltitude(altitude: number): number {
  const clamped = Math.max(0.3, Math.min(4, altitude));
  // 0.3 altitude (close) -> ~0.4 degrees, 4 altitude (far) -> ~10 degrees.
  return 0.4 + ((clamped - 0.3) / (4 - 0.3)) * 9.6;
}

/** Formats a report count for display, capping the label (not the
 * underlying count) at "99+". */
export function formatClusterCount(count: number): string {
  return formatReportCount(count);
}
