import { prisma } from "@/lib/db/client";
import type { EventHistory } from "@prisma/client";
import { reconstructEventState, type ReconstructedEventState } from "@/lib/data/event-reconstruction";
import { WITH_SOURCES, type EventWithSources } from "@/lib/db/repositories/events";

/**
 * Event Version History / Timeline Backbone — DB-facing half of
 * reconstruction (the actual replay logic is pure, see
 * lib/data/event-reconstruction.ts). `listEventIdsKnownAt` ("which
 * events existed by T") and `reconstructEventStateAt` ("what did THIS
 * event look like at T") were built as a foundation with no UI wired to
 * them yet; `reconstructWorldStateAt` below is Global Timeline /
 * Historical Playback's own addition — the batched "world state at T"
 * query the public `/world` map's timeline control actually calls,
 * built ON TOP of the same `reconstructEventState` replay logic rather
 * than a separate implementation.
 */
export async function reconstructEventStateAt(eventId: string, timestamp: Date): Promise<ReconstructedEventState | null> {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return null;

  const [history, sources] = await Promise.all([
    prisma.eventHistory.findMany({ where: { eventId } }),
    prisma.eventSource.findMany({ where: { eventId }, select: { rawIngestionItemId: true, relationship: true, createdAt: true } }),
  ]);

  return reconstructEventState(event, history, sources, timestamp);
}

export interface KnownEventSummary {
  id: string;
  slug: string;
  title: string;
  createdAt: string;
}

/** Every event that existed (had been created) by `timestamp` — the
 * lightweight "which events are known at T" query. Deliberately does NOT
 * filter by current publish status: a caller wanting "published as of T"
 * should reconstruct each candidate (reconstructEventStateAt) and check
 * its own `published` field, since an event's publish state at T can
 * differ from its CURRENT publish state (e.g. published since, or
 * unpublished since) — filtering on the live `Event.published` column
 * here would silently give a wrong answer for exactly the historical
 * queries this function exists to support. */
export async function listEventIdsKnownAt(timestamp: Date): Promise<KnownEventSummary[]> {
  const events = await prisma.event.findMany({
    where: { createdAt: { lte: timestamp } },
    select: { id: true, slug: true, title: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  return events.map((e) => ({ id: e.id, slug: e.slug, title: e.title, createdAt: e.createdAt.toISOString() }));
}

/**
 * Global Timeline / Historical Playback — "the world as it was at time
 * T," for the public `/world` map (spec "use the existing reconstruction
 * ... foundation rather than duplicating logic"). Reuses
 * `reconstructEventState` per event, but batches the two supporting
 * queries (history, and the events themselves) instead of looping one
 * event at a time — exactly two round-trips regardless of event count,
 * so this stays cheap enough to call on every timeline-timestamp change
 * (spec "do not create expensive per-frame historical queries").
 *
 * Returns `EventWithSources` — the SAME shape `lib/data/world-events.ts`'s
 * `dbEventToConflictEvent()` already knows how to convert — with the
 * reconstructed field values overlaid onto a shallow copy of each
 * event's row and `sources` filtered down to only links attached by
 * `timestamp`. This lets the API route reuse the exact existing
 * conversion function unchanged, rather than a second, parallel DTO
 * mapper (spec "reuse existing APIs/data services... rather than
 * duplicating logic").
 *
 * "The world at T" means "what was really happening at T" (Pre-Launch Critical Correctness & Security v1
 * §5) — an event is visible from its `occurredAt`, not from whenever it was ingested/published, and
 * "published" here is the event's CURRENT publish status (options.published: "current"), not "had it been
 * published by T yet" — the latter is a "what did Vigil KNOW at T" question, which is what the separate,
 * admin-only single-event reconstruction (reconstructEventStateAt above) intentionally still answers with
 * this same function's DEFAULT options. Before this fix, both used the default createdAt/asOf-published
 * semantics, which made almost the entire bulk-published backlog invisible for any `asOf` earlier than its
 * (recent) bulk-publish moment, regardless of how far back in real history `asOf` scrubbed — the "replay
 * does nothing, then dumps everything near the end" bug.
 */
export async function reconstructWorldStateAt(timestamp: Date): Promise<EventWithSources[]> {
  const events = await prisma.event.findMany({ where: { occurredAt: { lte: timestamp }, published: true }, include: WITH_SOURCES });
  if (events.length === 0) return [];

  const historyRows = await prisma.eventHistory.findMany({ where: { eventId: { in: events.map((e) => e.id) } } });
  const historyByEvent = new Map<string, EventHistory[]>();
  for (const h of historyRows) {
    const list = historyByEvent.get(h.eventId);
    if (list) list.push(h);
    else historyByEvent.set(h.eventId, [h]);
  }

  const result: EventWithSources[] = [];
  for (const event of events) {
    const history = historyByEvent.get(event.id) ?? [];
    const sourcesForReplay = event.sources.map((s) => ({
      rawIngestionItemId: s.rawIngestionItemId,
      relationship: s.relationship,
      createdAt: s.createdAt,
    }));
    const state = reconstructEventState(event, history, sourcesForReplay, timestamp, { existence: "occurredAt", published: "current" });
    if (!state || !state.published) continue;

    const attachedByT = new Set(state.sources.map((s) => s.rawIngestionItemId));
    result.push({
      ...event,
      title: state.title,
      summary: state.summary,
      eventType: state.eventType,
      locationName: state.locationName,
      countryCode: state.countryCode,
      region: state.region,
      latitude: state.latitude,
      longitude: state.longitude,
      occurredAt: new Date(state.occurredAt),
      severity: state.severity,
      conflictId: state.conflictId,
      actors: state.actors.length > 0 ? JSON.stringify(state.actors) : null,
      casualtiesKilled: state.casualtiesKilled,
      casualtiesInjured: state.casualtiesInjured,
      infrastructureDamage: state.infrastructureDamage.length > 0 ? JSON.stringify(state.infrastructureDamage) : null,
      sources: event.sources.filter((s) => attachedByT.has(s.rawIngestionItemId)),
    });
  }
  return result;
}
