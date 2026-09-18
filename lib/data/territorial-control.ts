// Territorial Control Mode — pure logic, no DB (same
// data/db-repository split as lib/data/event-reconstruction.ts and
// lib/db/repositories/event-reconstruction.ts). Directly unit-testable.

import type { TerritorialGeometry, TerritorialStatus } from "@/lib/types/territorial-control";

// "Recently changed" is a derived DISPLAY state, not something an admin
// assigns (see lib/types/territorial-control.ts's own comment) — any
// version whose validFrom falls within this window of the timestamp being
// viewed renders as "recently_changed" regardless of its own assigned
// status, satisfying spec §3's "temporary outline/highlight" without a
// second stored field that would need to be kept in sync with validFrom.
export const RECENTLY_CHANGED_WINDOW_MS = 24 * 60 * 60 * 1000;

/** What status a territory version should actually DISPLAY as when viewed
 * "as of" `asOf` — the assigned status, unless this version only just
 * became active (within RECENTLY_CHANGED_WINDOW_MS of `asOf`), in which
 * case "recently_changed" takes over regardless of the assigned status.
 * Pure function of (validFrom, asOf) so it works identically for a live
 * view (asOf = now) and a historical/playback view (asOf = some past T) —
 * a control change plays back with the same brief "recently changed"
 * highlight it had when it actually happened. */
export function deriveDisplayStatus(assignedStatus: TerritorialStatus, validFrom: Date, asOf: Date): TerritorialStatus {
  const age = asOf.getTime() - validFrom.getTime();
  if (age >= 0 && age <= RECENTLY_CHANGED_WINDOW_MS) return "recently_changed";
  return assignedStatus;
}

/** Structural validation only (spec's geometry field is "an appropriate
 * GeoJSON-compatible representation" — Polygon or MultiPolygon per §4) —
 * does not validate ring winding/self-intersection, which is out of scope
 * for an admin-entry guard. Rejects anything that isn't at minimum a
 * well-typed GeoJSON Polygon/MultiPolygon with non-empty coordinates. */
export function isValidTerritorialGeometry(value: unknown): value is TerritorialGeometry {
  if (typeof value !== "object" || value === null) return false;
  const geom = value as { type?: unknown; coordinates?: unknown };
  if (geom.type === "Polygon") {
    return Array.isArray(geom.coordinates) && geom.coordinates.length > 0 && geom.coordinates.every((ring) => Array.isArray(ring) && ring.length >= 4);
  }
  if (geom.type === "MultiPolygon") {
    return (
      Array.isArray(geom.coordinates) &&
      geom.coordinates.length > 0 &&
      geom.coordinates.every(
        (polygon) => Array.isArray(polygon) && polygon.every((ring) => Array.isArray(ring) && ring.length >= 4),
      )
    );
  }
  return false;
}

/** Parses the JSON-encoded geometry column back into a typed GeoJSON
 * object — returns null on malformed JSON or a shape that fails
 * isValidTerritorialGeometry, rather than throwing, since a caller
 * reconstructing a whole FeatureCollection should skip one bad row
 * instead of failing the entire response. */
export function parseTerritorialGeometry(json: string): TerritorialGeometry | null {
  try {
    const parsed = JSON.parse(json);
    return isValidTerritorialGeometry(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
