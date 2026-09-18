import { prisma } from "@/lib/db/client";
import { reconstructEventState, type ReconstructedEventState } from "@/lib/data/event-reconstruction";

/**
 * Event Version History / Timeline Backbone — DB-facing half of
 * reconstruction (the actual replay logic is pure, see
 * lib/data/event-reconstruction.ts). Also the "historical query
 * foundation" the spec asks for (§5): clean, minimal functions the NEXT
 * milestone (global timeline) can call — `listEventIdsKnownAt` for
 * "which events existed by T," `reconstructEventStateAt` for "what did
 * THIS event look like at T." No UI beyond the admin history panel is
 * built against these yet, per spec "do not build the full global
 * time-slider UI yet."
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
