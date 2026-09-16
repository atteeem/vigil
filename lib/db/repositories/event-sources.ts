import { prisma } from "@/lib/db/client";
import type { EventSource } from "@prisma/client";
import type { EventSourceRelationship } from "@/lib/types/db";

export function linkEventSource(
  eventId: string,
  rawIngestionItemId: string,
  relationship: EventSourceRelationship = "originating",
  isOriginatingSource = relationship === "originating",
): Promise<EventSource> {
  return prisma.eventSource.upsert({
    where: { eventId_rawIngestionItemId: { eventId, rawIngestionItemId } },
    update: { relationship, isOriginatingSource },
    create: { eventId, rawIngestionItemId, relationship, isOriginatingSource },
  });
}

export function listSourcesForEvent(eventId: string) {
  return prisma.eventSource.findMany({
    where: { eventId },
    include: { rawIngestionItem: { include: { source: true } } },
  });
}

/** Independent-source count per Decisions.md: relay posts of the same
 * originating source don't each count as a new confirmation. This counts
 * distinct originating-source links only, not every raw item attached. */
export async function countIndependentSources(eventId: string): Promise<number> {
  const links = await prisma.eventSource.findMany({
    where: { eventId, isOriginatingSource: true },
  });
  return links.length;
}
