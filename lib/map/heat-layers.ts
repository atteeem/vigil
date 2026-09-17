import type { FeatureCollection, Point } from "geojson";
import type { ConflictEvent, Severity } from "@/lib/types";
import { SEVERITY_LEVELS } from "@/lib/types";
import { distanceKm } from "@/lib/utils/geo";

// Heatmap-mode rendering data (world-map.tsx). Deliberately kept separate
// from events-to-geojson.ts's marker-mode feature shape: the heat
// visualization encodes different things per spec —
//   color = severity (per event / per conflict's worst event, never an
//     aggregate of how many reports exist)
//   opacity = corroboration (independent source count) x recency decay
//   radius = geographic scope (event importance for an incident;
//     geographic spread of its events for a whole conflict)
// Report/article COUNT never drives color — see conflictBaseGeoJSON's
// eventCount usage below, which only nudges opacity/confidence, capped,
// same as an individual event's sourceCount.

export interface EventHeatFeatureProps {
  id: string;
  severity: string;
  /** Hours between the event's occurredAt and the reference "now" this
   * feature collection was built against — used to fade older, isolated
   * incidents (spec "recency"). */
  ageHours: number;
  /** Independent supporting-source count — drives opacity/confidence,
   * never severity (spec "corroboration"). */
  sourceCount: number;
  importance: number;
}

/** Builds the per-event heat layer's source data. `nowIso` is a parameter
 * (not Date.now()) so callers can pass the same reference-time convention
 * the rest of the app uses for its mixed mock+live event set (MOCK_NOW) —
 * otherwise a mock event calibrated against a fixed past "now" would
 * always render as maximally stale relative to the real wall clock. */
export function eventsToHeatGeoJSON(
  events: ConflictEvent[],
  nowIso: string,
): FeatureCollection<Point, EventHeatFeatureProps> {
  const now = new Date(nowIso).getTime();
  return {
    type: "FeatureCollection",
    features: events.map((e) => ({
      type: "Feature",
      id: e.id,
      geometry: { type: "Point", coordinates: [e.lng, e.lat] },
      properties: {
        id: e.id,
        severity: e.severity,
        ageHours: Math.max(0, (now - new Date(e.occurredAt).getTime()) / 3_600_000),
        sourceCount: e.sourceCount,
        importance: e.importance,
      },
    })),
  };
}

export interface ConflictBaseFeatureProps {
  conflictId: string;
  /** The worst (highest-ranked) severity among the conflict's own events —
   * a sustained conflict reads as however bad its worst confirmed incident
   * is, not an average diluted by many minor reports (spec: "a severe
   * conflict can be red even with few reports" / "many low-severity
   * reports must not automatically become red" — both fall out of using
   * max rather than mean or count). */
  severity: string;
  /** Great-circle radius (km) covering every event attributed to this
   * conflict — drives the base layer's geographic footprint (spec
   * "radius = geographic scope" / "sustained regional conflict = broad
   * area"). */
  spreadKm: number;
  eventCount: number;
}

function severityRank(s: string): number {
  const i = SEVERITY_LEVELS.indexOf(s as Severity);
  return i === -1 ? 0 : i;
}

/** Aggregates events sharing a conflictId into one wide "ongoing conflict"
 * base feature per conflict (spec "conflict base layer" — broader heat
 * underneath individual incident hotspots). Events with no conflictId are
 * one-off incidents, not part of a sustained conflict, and are
 * deliberately excluded — they still render their own event-hotspot, just
 * no base glow beneath them. Unlike event hotspots, nothing here decays
 * with recency: an active conflict's base presence is meant to persist
 * through temporary reporting gaps (spec "recency" #3), so no age input
 * is taken at all — staying active is a property of the conflict, not of
 * any single report's freshness. */
export function conflictBaseGeoJSON(events: ConflictEvent[]): FeatureCollection<Point, ConflictBaseFeatureProps> {
  const groups = new Map<string, ConflictEvent[]>();
  for (const e of events) {
    if (!e.conflictId) continue;
    const list = groups.get(e.conflictId);
    if (list) list.push(e);
    else groups.set(e.conflictId, [e]);
  }

  const features: FeatureCollection<Point, ConflictBaseFeatureProps>["features"] = [];
  for (const [conflictId, group] of groups) {
    const lat = group.reduce((sum, e) => sum + e.lat, 0) / group.length;
    const lng = group.reduce((sum, e) => sum + e.lng, 0) / group.length;
    const spreadKm = group.reduce((max, e) => Math.max(max, distanceKm({ lat, lng }, { lat: e.lat, lng: e.lng })), 0);
    const worst = group.reduce((w, e) => (severityRank(e.severity) > severityRank(w) ? e.severity : w), group[0]!.severity);
    features.push({
      type: "Feature",
      id: conflictId,
      geometry: { type: "Point", coordinates: [lng, lat] },
      properties: { conflictId, severity: worst, spreadKm, eventCount: group.length },
    });
  }
  return { type: "FeatureCollection", features };
}
