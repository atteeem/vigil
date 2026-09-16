import type { Event as DbEvent, EventSource, RawIngestionItem, Source } from "@prisma/client";
import type { ConflictEvent, SourceRef } from "@/lib/types";
import type { EventType, Severity } from "@/lib/types";
import type { DbVerificationStatus } from "@/lib/types/db";
import { prisma } from "@/lib/db/client";

const SOURCE_TYPE_LABEL: Record<string, SourceRef["sourceType"]> = {
  rss: "Wire",
  telegram: "Social",
  manual: "OSINT",
};

// The DB's 6-state verification vocabulary (Decisions.md) collapses onto
// the mock-data UI's 5-state VerificationStatus + a separate `disputed`
// boolean — "disputed" carries no independent confidence level of its own
// in the UI model, so it falls back to "reported" alongside disputed=true.
function toUiVerification(status: DbVerificationStatus): { verificationStatus: ConflictEvent["verificationStatus"]; disputed: boolean } {
  if (status === "disputed") return { verificationStatus: "reported", disputed: true };
  return { verificationStatus: status, disputed: false };
}

type EventWithSources = DbEvent & {
  sources: (EventSource & { rawIngestionItem: RawIngestionItem & { source: Source } })[];
};

/** Converts a published DB event (+ its linked sources) into the exact
 * shape the existing mock-data-driven UI (WorldMap, EventCard,
 * EventDetailPanel, MapFilters) already renders — so published events
 * appear on /world without any change to those components. */
export function dbEventToConflictEvent(event: EventWithSources): ConflictEvent {
  const { verificationStatus, disputed } = toUiVerification(event.verificationStatus as DbVerificationStatus);
  const sources: SourceRef[] = event.sources.map((link) => ({
    id: link.rawIngestionItem.source.id,
    name: link.rawIngestionItem.source.name,
    // Prefer the source's own configured category (e.g. "News" for BBC
    // World) over the generic per-adapter-type label, when set.
    sourceType:
      (link.rawIngestionItem.source.sourceCategory as SourceRef["sourceType"] | null) ??
      SOURCE_TYPE_LABEL[link.rawIngestionItem.source.type] ??
      "OSINT",
    url: link.rawIngestionItem.originalUrl ?? "",
    publishedAt: (link.rawIngestionItem.publishedAt ?? link.rawIngestionItem.receivedAt).toISOString(),
    note: link.relationship === "relay" ? "Relay — not an independent confirmation of the originating source." : undefined,
  }));

  return {
    id: event.id,
    slug: event.slug,
    title: event.title,
    summary: event.summary,
    eventType: event.eventType as EventType,
    lat: event.latitude,
    lng: event.longitude,
    countryCode: event.countryCode ?? "XX",
    region: event.region ?? "Global",
    conflictId: event.conflictId,
    occurredAt: event.occurredAt.toISOString(),
    severity: event.severity as Severity,
    importance: event.importance,
    verificationStatus,
    disputed,
    sourceCount: sources.length,
    sources,
    timeline: [
      {
        label: "First report",
        time: event.occurredAt.toISOString(),
        description: event.summary,
      },
    ],
  };
}

/** Server-only: looks up a published DB event by slug for /event/[slug] —
 * the mock-data event pages (app/event/[slug]/page.tsx) fall back to this
 * when the slug isn't a mock event, so a freshly published admin-review
 * event (e.g. from the BBC World RSS ingestion proof) has a working
 * detail page even though it was never in generateStaticParams (Next
 * renders it on demand — dynamicParams defaults to true). */
export async function getDbEventBySlug(slug: string): Promise<ConflictEvent | null> {
  const event = await prisma.event.findFirst({
    where: { slug, published: true },
    include: { sources: { include: { rawIngestionItem: { include: { source: true } } } } },
  });
  return event ? dbEventToConflictEvent(event) : null;
}
