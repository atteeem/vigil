import { prisma } from "@/lib/db/client";
import type { Event } from "@prisma/client";
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

export function setEventPublished(id: string, published: boolean): Promise<Event> {
  return prisma.event.update({ where: { id }, data: { published } });
}

export function deleteEvent(id: string): Promise<Event> {
  return prisma.event.delete({ where: { id } });
}
