import { independentSourceCount, normalizeSourceUrl } from "@/lib/data/independence";
import { sourceTrust } from "@/lib/sources/trust";
import type { ConflictEvent, SourceRef } from "@/lib/types";
import type { EventType, Severity } from "@/lib/types";
import type { DbVerificationStatus, EventAdminDTO } from "@/lib/types/db";
import type { EventHistory } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import type { EventWithSources } from "@/lib/db/repositories/events";
import { eventStatus } from "@/lib/data/event-status";
import { parseJsonArray } from "@/lib/ingestion/event-update-proposals";

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

/** Converts a published DB event (+ its linked sources) into the exact
 * shape the existing mock-data-driven UI (WorldMap, EventCard,
 * EventDetailPanel, MapFilters) already renders — so published events
 * appear on /world without any change to those components. `history` is
 * optional and only populated by getDbEventBySlug's single-event lookup
 * (spec "Live Event Updates" §7 "optionally show a concise update
 * history") — the /world feed and admin list don't need it per-event. */
function authorOf(rawMetadata: string | null): string | null {
  if (!rawMetadata) return null;
  try {
    const parsed = JSON.parse(rawMetadata) as { author?: unknown };
    return typeof parsed.author === "string" && parsed.author.trim() ? parsed.author.trim() : null;
  } catch {
    return null;
  }
}

export function dbEventToConflictEvent(event: EventWithSources & { history?: EventHistory[] }): ConflictEvent {
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
    sourceRole: link.rawIngestionItem.source.sourceRole,
    trust: sourceTrust({
      independenceClass: link.rawIngestionItem.source.independenceClass,
      claimPolicy: link.rawIngestionItem.source.claimPolicy,
      sourceRole: link.rawIngestionItem.source.sourceRole,
      perspective: link.rawIngestionItem.source.perspective,
    }),
    relationship: link.relationship,
    reportTitle: link.rawIngestionItem.originalTitle,
    author: authorOf(link.rawIngestionItem.rawMetadata),
    url: link.rawIngestionItem.originalUrl && link.rawIngestionItem.originalUrl.trim() ? link.rawIngestionItem.originalUrl : null,
    publishedAt: (link.rawIngestionItem.publishedAt ?? link.rawIngestionItem.receivedAt).toISOString(),
    attachedAt: link.createdAt.toISOString(),
    note: link.relationship === "relay" ? "Relay — not an independent confirmation of the originating source." : undefined,
  }));
  // The same article listed twice is one piece of evidence: flag the repeat.
  const seenUrls = new Set<string>();
  for (const source of sources) {
    const key = normalizeSourceUrl(source.url);
    if (!key) continue;
    if (seenUrls.has(key)) source.note = source.note ?? "Same article as a report already listed — not independent evidence.";
    seenUrls.add(key);
  }

  return {
    id: event.id,
    slug: event.slug,
    title: event.title,
    summary: event.summary,
    eventType: event.eventType as EventType,
    lat: event.latitude,
    lng: event.longitude,
    locationPrecision: event.locationPrecision,
    countryCode: event.countryCode ?? "XX",
    region: event.region ?? "Global",
    conflictId: event.conflictId,
    occurredAt: event.occurredAt.toISOString(),
    severity: event.severity as Severity,
    importance: event.importance,
    verificationStatus,
    disputed,
    // Independent-source count (spec §5): a relay post of the same
    // originating report is linked (shown in the Sources list for
    // transparency) but must NOT inflate this count — only links marked
    // isOriginatingSource (the true originating report, or a genuinely
    // separate corroborating source) count.
    sourceCount: independentSourceCount(event.sources),
    sources,
    timeline: [
      {
        label: "First report",
        time: event.occurredAt.toISOString(),
        description: event.summary,
      },
    ],
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
    // Populated only via an accepted EventUpdateProposal (spec "Live
    // Event Updates") — undefined/empty for an event nothing has ever
    // been accepted onto yet, same as a fresh mock event.
    actors: parseJsonArray(event.actors),
    casualtiesKilled: event.casualtiesKilled,
    casualtiesInjured: event.casualtiesInjured,
    infrastructureDamage: parseJsonArray(event.infrastructureDamage),
    updateHistory: event.history?.map((h) => ({
      field: h.field,
      oldValue: h.oldValue,
      newValue: h.newValue,
      changedAt: h.createdAt.toISOString(),
    })),
  };
}

/** Admin-only view (spec "event management"): includes lifecycle status
 * and works for draft/unpublished events too, unlike dbEventToConflictEvent
 * (which is written to feed the public UI — status is irrelevant there
 * since GET /api/events already filters to published: true). */
export function toEventAdminDTO(event: EventWithSources): EventAdminDTO {
  return {
    id: event.id,
    slug: event.slug,
    title: event.title,
    summary: event.summary,
    eventType: event.eventType,
    countryCode: event.countryCode ?? "XX",
    region: event.region ?? "Global",
    locationPrecision: event.locationPrecision,
    occurredAt: event.occurredAt.toISOString(),
    status: eventStatus(event),
    publishedAt: event.publishedAt ? event.publishedAt.toISOString() : null,
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
    conflictId: event.conflictId,
    sourceCount: independentSourceCount(event.sources),
    supportingReportCount: event.sources.length,
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
    include: {
      sources: { include: { rawIngestionItem: { include: { source: true } } } },
      // Concise, public-safe update history (spec §7 "optionally show a
      // concise update history if cleanly supported") — capped at the 5
      // most recent accepted changes; the admin history view
      // (GET /api/admin/events/[id]/history) is unlimited.
      history: { orderBy: { createdAt: "desc" }, take: 5 },
    },
  });
  return event ? dbEventToConflictEvent(event) : null;
}
