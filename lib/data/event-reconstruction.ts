import type { Event, EventHistory } from "@prisma/client";

/**
 * Event Version History / Timeline Backbone (spec "Make every accepted
 * event change historically reconstructable"). Pure replay logic over
 * plain data — Event's CURRENT row, its full EventHistory ledger, and
 * its EventSource attachments — so this is directly unit-testable with
 * no database, same "extraction/comparison separate from persistence"
 * split this codebase already uses for fact extraction (lib/ingestion/
 * extract-facts.ts) and update proposals (lib/ingestion/event-update-
 * proposals.ts). Persistence/fetching lives in lib/db/repositories/
 * event-reconstruction.ts.
 *
 * Deliberately reconstructs from EventHistory rather than storing a full
 * snapshot per version (spec "avoid duplicating full event snapshots
 * unnecessarily if a clean change-log/version model fits") — EventHistory
 * IS that change-log; replaying it is the whole mechanism.
 */
export interface ReconstructedSourceRef {
  rawIngestionItemId: string;
  relationship: string;
  attachedAt: string; // ISO — when this EventSource link was created
}

export interface ReconstructedEventState {
  eventId: string;
  asOf: string; // ISO — the timestamp this state was reconstructed for
  title: string;
  summary: string;
  eventType: string;
  locationName: string | null;
  countryCode: string | null;
  region: string | null;
  /** null when the event has no point (country / global / unknown scope): never coerced to 0 or NaN. */
  latitude: number | null;
  longitude: number | null;
  occurredAt: string; // ISO
  severity: string;
  conflictId: string | null;
  actors: string[];
  casualtiesKilled: number | null;
  casualtiesInjured: number | null;
  infrastructureDamage: string[];
  /** Whether the event was published as of `asOf` — best-effort from
   * `Event.publishedAt` (set once, on first publish, never cleared by an
   * unpublish — see prisma/schema.prisma's Event model comment), so this
   * answers "had this event ever been published by this time," not a
   * full publish/unpublish toggle history (none is tracked; existing
   * lifecycle rules are unchanged by this milestone). */
  published: boolean;
  /** Every source attached by `asOf`, oldest attachment first. */
  sources: ReconstructedSourceRef[];
}

// Fields whose current value can be rolled straight back to
// EventHistory.oldValue — every field EXCEPT the two list-valued ones
// below, which need accumulation instead (see reconstructEventState).
const SCALAR_ROLLBACK_FIELDS = new Set([
  "eventType",
  "title",
  "summary",
  "locationName",
  "countryCode",
  "region",
  "latitude",
  "longitude",
  "occurredAt",
  "severity",
  "conflictId",
  "casualtiesKilled",
  "casualtiesInjured",
]);

export interface ReconstructableSource {
  rawIngestionItemId: string;
  relationship: string;
  createdAt: Date;
}

/**
 * Reconstructs an event's state as of `timestamp`. Returns `null` if the
 * event did not exist yet at that time (`event.createdAt > timestamp`) —
 * there is no meaningful state to report before creation.
 *
 * Algorithm: start from the event's CURRENT row (the only place full
 * state lives — history rows only carry per-field diffs), then walk
 * EventHistory newest-first and roll back every entry that happened
 * AFTER `timestamp` by restoring `oldValue`. Because entries are
 * processed strictly newest-to-oldest, two or more changes to the same
 * field after `timestamp` correctly collapse to the value from
 * immediately before the EARLIEST of them — each rollback overwrites the
 * previous one, and the last (chronologically first) entry applied is
 * the one whose `oldValue` genuinely predates every after-`timestamp`
 * change. This only works because EventHistory.oldValue is always the
 * TRUE value immediately before that specific change (see
 * lib/db/repositories/event-updates.ts's acceptProposal) — never a
 * possibly-stale proposal-creation-time snapshot.
 *
 * actor/infrastructureDamage are handled separately: every accepted
 * entry for those fields is an ADDITION (never a replacement — see
 * lib/ingestion/event-update-proposals.ts), so their state at
 * `timestamp` is simply every such entry with `createdAt <= timestamp`,
 * not a rollback.
 */
const coord = (v: string | null | undefined): number | null => {
  if (v === null || v === undefined || v === "" || v === "null") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function reconstructEventState(
  event: Event,
  history: EventHistory[],
  sources: ReconstructableSource[],
  timestamp: Date,
): ReconstructedEventState | null {
  if (event.createdAt.getTime() > timestamp.getTime()) return null;

  const state: Record<string, string | null> = {
    eventType: event.eventType,
    title: event.title,
    summary: event.summary,
    locationName: event.locationName,
    countryCode: event.countryCode,
    region: event.region,
    latitude: event.latitude === null ? null : String(event.latitude),
    longitude: event.longitude === null ? null : String(event.longitude),
    occurredAt: event.occurredAt.toISOString(),
    severity: event.severity,
    conflictId: event.conflictId,
    casualtiesKilled: event.casualtiesKilled === null ? null : String(event.casualtiesKilled),
    casualtiesInjured: event.casualtiesInjured === null ? null : String(event.casualtiesInjured),
  };

  const newestFirst = [...history].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  for (const entry of newestFirst) {
    if (entry.createdAt.getTime() <= timestamp.getTime()) continue;
    if (SCALAR_ROLLBACK_FIELDS.has(entry.field)) {
      state[entry.field] = entry.oldValue;
    }
  }

  const oldestFirst = [...history].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const actors = oldestFirst
    .filter((h) => h.field === "actor" && h.createdAt.getTime() <= timestamp.getTime())
    .map((h) => h.newValue);
  const infrastructureDamage = oldestFirst
    .filter((h) => h.field === "infrastructureDamage" && h.createdAt.getTime() <= timestamp.getTime())
    .map((h) => h.newValue);

  const relevantSources = sources
    .filter((s) => s.createdAt.getTime() <= timestamp.getTime())
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((s) => ({
      rawIngestionItemId: s.rawIngestionItemId,
      relationship: s.relationship,
      attachedAt: s.createdAt.toISOString(),
    }));

  return {
    eventId: event.id,
    asOf: timestamp.toISOString(),
    title: state.title!,
    summary: state.summary!,
    eventType: state.eventType!,
    locationName: state.locationName ?? null,
    countryCode: state.countryCode ?? null,
    region: state.region ?? null,
    latitude: coord(state.latitude),
    longitude: coord(state.longitude),
    occurredAt: state.occurredAt!,
    severity: state.severity!,
    conflictId: state.conflictId ?? null,
    actors,
    casualtiesKilled: state.casualtiesKilled === null ? null : Number(state.casualtiesKilled),
    casualtiesInjured: state.casualtiesInjured === null ? null : Number(state.casualtiesInjured),
    infrastructureDamage,
    published: event.publishedAt !== null && event.publishedAt.getTime() <= timestamp.getTime(),
    sources: relevantSources,
  };
}
