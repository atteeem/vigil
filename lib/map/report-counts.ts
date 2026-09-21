// Supporting-REPORT counts for the map and globe — one definition used by the
// marker labels, the cluster sums, the heatmap hotspot labels and the 3D globe.
//
// A marker's number is how many reports support it, never how many event
// objects sit nearby: a lone event with 18 attached reports reads "18", a
// cluster of three events with 1 + 3 + 18 reports reads "22". The true count
// is always kept as a number; only the DISPLAY is capped at "99+".
//
// These are pure functions of the event list. Territorial Control, severity
// and heat scoring never feed into them, and they never feed into severity.

export const REPORT_COUNT_CAP = 99;

export interface ReportCountable {
  sources?: readonly unknown[];
  sourceCount?: number;
}

/** Reports attached to one event (every supporting report, relays included).
 * Falls back to the independent-source count, then to 1: an event exists
 * because at least one report did. */
export function reportCountOf(event: ReportCountable): number {
  const attached = event.sources?.length ?? 0;
  if (attached > 0) return attached;
  return Math.max(1, event.sourceCount ?? 0);
}

export function sumReportCounts(events: readonly ReportCountable[]): number {
  return events.reduce((total, e) => total + reportCountOf(e), 0);
}

/** Display form: capped at "99+" (the underlying number is unchanged). */
export function formatReportCount(count: number): string {
  return count > REPORT_COUNT_CAP ? `${REPORT_COUNT_CAP}+` : String(count);
}

export interface GeoReportable extends ReportCountable {
  id: string;
  /** null: the report has no map point (country-level / unknown location) and is not bucketed. */
  lat: number | null;
  lng: number | null;
}

export interface ReportBucket {
  lat: number;
  lng: number;
  /** True (uncapped) number of reports contributing to this bucket. */
  reports: number;
  eventCount: number;
  ids: string[];
}

/** Geographic bucket size (degrees) for hotspot labels at a MapLibre zoom
 * level: world view groups whole regions, zoomed in splits them apart.
 * Halves with every zoom step, so a label never has a neighbour closer than
 * about one cell and labels cannot pile up. */
export function hotspotCellDegrees(zoom: number): number {
  const z = Math.max(0, Math.min(12, zoom));
  return 48 / 2 ** z;
}

/** Groups events into a fixed geographic grid for the given zoom and sums
 * each cell's reports. The label position is the report-weighted centroid
 * of the cell's events. Returns at most `maxBuckets` cells, busiest first —
 * the guard that keeps a dense world from producing hundreds of labels.
 * Deterministic: same events + zoom -> same buckets in the same order. */
export function aggregateReportBuckets(events: readonly GeoReportable[], zoom: number, maxBuckets = 40): ReportBucket[] {
  const cell = hotspotCellDegrees(zoom);
  const cells = new Map<string, { latSum: number; lngSum: number; reports: number; ids: string[] }>();
  for (const e of events) {
    if (e.lat == null || e.lng == null) continue;
    const key = `${Math.floor(e.lat / cell)}:${Math.floor(e.lng / cell)}`;
    const weight = reportCountOf(e);
    const acc = cells.get(key) ?? { latSum: 0, lngSum: 0, reports: 0, ids: [] };
    acc.latSum += e.lat * weight;
    acc.lngSum += e.lng * weight;
    acc.reports += weight;
    acc.ids.push(e.id);
    cells.set(key, acc);
  }
  return [...cells.values()]
    .map((c) => ({ lat: c.latSum / c.reports, lng: c.lngSum / c.reports, reports: c.reports, eventCount: c.ids.length, ids: c.ids }))
    .sort((a, b) => b.reports - a.reports || a.lat - b.lat || a.lng - b.lng)
    .slice(0, maxBuckets);
}
