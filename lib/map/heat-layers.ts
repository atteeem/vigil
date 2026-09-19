import type { FeatureCollection, Point } from "geojson";
import type { ConflictEvent } from "@/lib/types";
import { distanceKm } from "@/lib/utils/geo";
import { maxSeverity, severityRank } from "@/lib/utils/severity";
import { computeSeverityScore } from "@/lib/scoring/severity";
import { computeConfidenceScore } from "@/lib/scoring/confidence";

// Heatmap-mode rendering data (world-map.tsx). Deliberately kept separate
// from events-to-geojson.ts's marker-mode feature shape: the heat
// visualization encodes different things per spec —
//   color = severity (per event / per conflict's worst event, never an
//     aggregate of how many reports exist) — now the Central Conflict
//     Scoring Engine's severityScore, run back through severityFromScore
//     to pick a color band, rather than the raw admin-entered enum
//     directly. 100 (the engine's exclusive "active full-scale war" band)
//     always resolves to "extreme", the deepest red.
//   opacity = confidenceScore (evidence quality — independent source
//     count, source diversity, freshness) x recency decay. Previously
//     interpolated straight off sourceCount; now goes through the same
//     centralized confidence engine admin/conflict views use, so this
//     project has exactly one "how well-evidenced is this" formula, not
//     a second ad hoc one living only in the heatmap.
//   radius = geographic scope (event importance for an incident;
//     geographic spread of its events for a whole conflict)
// Report/article COUNT never drives color — severity.ts's input shape has
// no source/report-count field at all (see lib/scoring/severity.ts).

export interface EventHeatFeatureProps {
  id: string;
  severity: string;
  /** 0-100, Central Conflict Scoring Engine output — drives color band via severityFromScore. */
  severityScore: number;
  /** 0-100, Central Conflict Scoring Engine output — drives opacity (evidence quality), independent of severity. */
  confidenceScore: number;
  /** Hours between the event's occurredAt and the reference "now" this
   * feature collection was built against — used to fade older, isolated
   * incidents (spec "recency"). */
  ageHours: number;
  /** Independent supporting-source count — kept for display/debugging;
   * confidenceScore (above), not this raw count, drives opacity. */
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
  const withScores = events.map((e) => {
    const severity = computeSeverityScore({ severityLabel: e.severity, importance: e.importance });
    const confidence = computeConfidenceScore({
      independentSourceCount: e.sourceCount,
      sourceCategories: Array.from(new Set(e.sources.map((s) => s.sourceType))),
      latestCorroborationAt: e.sources.length > 0 ? new Date(Math.max(...e.sources.map((s) => new Date(s.publishedAt).getTime()))).toISOString() : null,
      now: nowIso,
    });
    return { event: e, severity, confidence };
  });
  return {
    type: "FeatureCollection",
    // MapLibre circle layers paint features in source-array order, later
    // entries on top — sorting ascending by severity (least severe first)
    // is what makes "severe never gets visually covered by a lower
    // severity" deterministic, via plain render order rather than any
    // opacity/z-index hack. Stable sort (Array.prototype.sort guarantees
    // this) preserves relative order within the same severity. Sorts by
    // the ENGINE's computed severityScore rank, not the raw input label —
    // the two usually agree, but the engine can refine a label upward
    // when enough structured signals stack up.
    features: withScores
      .sort((a, b) => severityRank(a.severity.severityLabel) - severityRank(b.severity.severityLabel))
      .map(({ event: e, severity, confidence }) => ({
        type: "Feature",
        id: e.id,
        geometry: { type: "Point", coordinates: [e.lng, e.lat] },
        properties: {
          id: e.id,
          severity: severity.severityLabel,
          severityScore: severity.severityScore,
          confidenceScore: confidence.confidenceScore,
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
  /** 0-100, Central Conflict Scoring Engine output for the conflict as a
   * whole (worst-event severity enriched with spreadKm/eventCount) —
   * drives the base layer's color band via severityFromScore. */
  severityScore: number;
  /** Great-circle radius (km) covering every event attributed to this
   * conflict — drives the base layer's geographic footprint (spec
   * "radius = geographic scope" / "sustained regional conflict = broad
   * area"). */
  spreadKm: number;
  eventCount: number;
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
    const worst = group.reduce((w: string, e) => maxSeverity(w, e.severity), group[0]!.severity);
    const severity = computeSeverityScore({ severityLabel: worst as ConflictEvent["severity"], spreadKm, eventCount: group.length });
    features.push({
      type: "Feature",
      id: conflictId,
      geometry: { type: "Point", coordinates: [lng, lat] },
      properties: { conflictId, severity: severity.severityLabel, severityScore: severity.severityScore, spreadKm, eventCount: group.length },
    });
  }
  // Same deterministic-stacking rationale as eventsToHeatGeoJSON above —
  // least severe conflict base first, so a severe/extreme conflict's base
  // glow is never painted over by a lower-severity one it happens to
  // overlap.
  features.sort((a, b) => severityRank(a.properties.severity) - severityRank(b.properties.severity));
  return { type: "FeatureCollection", features };
}
