import { prisma } from "@/lib/db/client";
import type { Event, EventSource, RawIngestionItem, Source } from "@prisma/client";
import type { DbVerificationStatus } from "@/lib/types/db";
import type { EventType, Severity } from "@/lib/types";

export interface EventInput {
  slug: string;
  title: string;
  summary: string;
  eventType: EventType;
  locationName?: string | null;
  latitude: number;
  longitude: number;
  countryCode?: string | null;
  region?: string | null;
  conflictId?: string | null;
  occurredAt: Date;
  severity: Severity;
  importance?: number;
  verificationStatus?: DbVerificationStatus;
  published?: boolean;
  publishedAt?: Date | null;
}

export type EventWithSources = Event & {
  sources: (EventSource & { rawIngestionItem: RawIngestionItem & { source: Source } })[];
};

const WITH_SOURCES = { sources: { include: { rawIngestionItem: { include: { source: true } } } } } as const;

/** Every event regardless of lifecycle status — the admin list needs
 * drafts/unpublished events too, unlike the public GET /api/events. */
export function listAllEventsWithSources(): Promise<EventWithSources[]> {
  return prisma.event.findMany({ include: WITH_SOURCES, orderBy: { occurredAt: "desc" } });
}

export function getEventWithSources(id: string): Promise<EventWithSources | null> {
  return prisma.event.findUnique({ where: { id }, include: WITH_SOURCES });
}

export function listEvents(filter?: { published?: boolean }): Promise<Event[]> {
  return prisma.event.findMany({
    where: filter?.published !== undefined ? { published: filter.published } : undefined,
    orderBy: { occurredAt: "desc" },
  });
}

export function getEvent(id: string): Promise<Event | null> {
  return prisma.event.findUnique({ where: { id } });
}

export function createEvent(input: EventInput): Promise<Event> {
  return prisma.event.create({ data: input });
}

export function updateEvent(id: string, input: Partial<EventInput>): Promise<Event> {
  return prisma.event.update({ where: { id }, data: input });
}

/** Publish sets publishedAt only the first time (never overwritten by a
 * later republish) — see EVENT_STATUSES' draft-vs-unpublished distinction.
 * Unpublish preserves publishedAt. For published rows predating this
 * column, createdAt supplies a legacy history marker on unpublish. */
export async function setEventPublished(id: string, published: boolean): Promise<Event> {
  if (published) {
    const current = await prisma.event.findUnique({ where: { id }, select: { publishedAt: true } });
    return prisma.event.update({
      where: { id },
      data: { published: true, publishedAt: current?.publishedAt ?? new Date() },
    });
  }
  const current = await prisma.event.findUnique({ where: { id } });
  return prisma.event.update({
    where: { id },
    data: {
      published: false,
      publishedAt: current?.publishedAt ?? (current?.published ? current.createdAt : null),
    },
  });
}

/** Deletes an event and, in the same transaction, returns any raw
 * ingestion items that were ONLY attached to this event back to "pending"
 * — deleting an Event cascades away its EventSource link rows (see
 * prisma/schema.prisma), but the underlying reports must not be silently
 * lost: they go back to the incoming queue for re-review rather than
 * being left dangling in a "published" state that points at nothing. */
export async function deleteEventCleanly(id: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const links = await tx.eventSource.findMany({ where: { eventId: id }, select: { rawIngestionItemId: true } });
    await tx.event.delete({ where: { id } });
    if (links.length > 0) {
      await tx.rawIngestionItem.updateMany({
        where: { id: { in: links.map((l) => l.rawIngestionItemId) }, eventLinks: { none: {} } },
        data: { processingStatus: "pending" },
      });
    }
  });
}
