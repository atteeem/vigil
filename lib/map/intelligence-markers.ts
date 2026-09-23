import type { ConflictEvent, PointEvent, Severity } from "@/lib/types";
import { hasPoint } from "@/lib/types/event";
import { attributeReports, formatReportCount, reportIdsOf } from "@/lib/map/report-counts";
import { maxSeverity } from "@/lib/utils/severity";

// THE canonical aggregation behind every report count on the flat map and the 3D globe. Both renderers consume these
// records (the flat map through GeoJSON properties, the globe through its cluster/marker elements), so a number can
// never differ between them. `reportCount` counts UNIQUE published reports (lib/map/report-counts.ts); the true number
// is always kept, and only the label is capped ("99+").
//
// Geography follows the report's known scope: a POINT / CITY / REGION report is a marker at its coordinates (a city or
// region marker is approximate and says so through `scope`); a COUNTRY, GLOBAL or UNKNOWN report has no point and
// never becomes one. It still counts toward its conflict's aggregate.

export type MarkerScope = "point" | "city" | "region";

export interface MapIntelligenceMarker {
  id: string;
  latitude: number;
  longitude: number;
  scope: MarkerScope;
  conflictId: string | null;
  eventIds: string[];
  reportIds: string[];
  reportCount: number;
  eventCount: number;
  severity: Severity;
  confidence: number | null;
}

const scopeOf = (e: PointEvent): MarkerScope => (e.locationScope === "region" || e.locationPrecision === "region" ? "region" : e.locationScope === "city" || e.locationPrecision === "city" ? "city" : "point");

/** One marker per event that has a map point, each carrying the unique reports attributed to it. */
export function buildEventMarkers(events: readonly ConflictEvent[]): MapIntelligenceMarker[] {
  const attributed = attributeReports(events);
  return events.filter(hasPoint).map((e) => {
    const a = attributed.get(e.id)!;
    return { id: e.id, latitude: e.lat, longitude: e.lng, scope: scopeOf(e), conflictId: e.conflictId ?? null, eventIds: [e.id], reportIds: a.reportIds, reportCount: a.reportCount, eventCount: 1, severity: e.severity, confidence: null };
  });
}

export interface ConflictAggregate {
  conflictId: string;
  reportCount: number;
  eventCount: number;
  severity: Severity | null;
}

/** Unique published reports per conflict over the given events (including country-level events that have no point). */
export function buildConflictAggregates(events: readonly ConflictEvent[]): Map<string, ConflictAggregate> {
  const out = new Map<string, ConflictAggregate & { ids: Set<string> }>();
  for (const e of events) {
    if (!e.conflictId) continue;
    const agg = out.get(e.conflictId) ?? { conflictId: e.conflictId, reportCount: 0, eventCount: 0, severity: null, ids: new Set<string>() };
    for (const r of reportIdsOf(e)) agg.ids.add(r);
    agg.eventCount++;
    agg.severity = agg.severity ? (maxSeverity(agg.severity, e.severity) as Severity) : e.severity;
    out.set(e.conflictId, agg);
  }
  for (const agg of out.values()) agg.reportCount = agg.ids.size;
  return out;
}

/** The label drawn inside a marker: the exact number up to 99, "99+" above. */
export const markerLabel = (reportCount: number) => formatReportCount(reportCount);
