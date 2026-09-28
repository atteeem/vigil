import { alertsForEvent } from "@/lib/alerts/hooks";
import { prisma } from "@/lib/db/client";
import { linkEventSource } from "@/lib/db/repositories/event-sources";
import { setProcessingStatus } from "@/lib/db/repositories/raw-ingestion-items";
import { proposeEventUpdatesFromReport } from "@/lib/db/repositories/event-updates";
import { propagateEntityLinksToEvent } from "@/lib/military/link-entities";
import type { EventSourceRelationship } from "@/lib/types/db";
import { isAggregatorRole } from "@/lib/registry/source-tiers";

// Attaches a raw item to an EXISTING event as an additional source rather than creating a new one — the
// one place this happens, shared by the admin's manual "Merge" action (app/api/admin/incoming/[id]/merge)
// and automatic same-batch corroboration (lib/ingestion/bulk-publish.ts), so a report ends up identically
// attached regardless of which path found the match. Per Decisions.md, a relay of the same originating
// source still counts as one underlying source, so an aggregator/relay report is always attached as
// "relay" (a supporting report, never counted as independent), whatever relationship the caller requested.

export interface MergeOutcome {
  rawItemId: string;
  eventId: string;
  relationship: EventSourceRelationship;
  proposalsCreated: number;
}

export async function mergeReportIntoEvent(rawItemId: string, eventId: string, relationshipHint?: EventSourceRelationship): Promise<MergeOutcome> {
  const rawItem = await prisma.rawIngestionItem.findUnique({ where: { id: rawItemId }, include: { source: { select: { sourceRole: true } } } });
  const relationship: EventSourceRelationship = isAggregatorRole(rawItem?.source.sourceRole) ? "relay" : (relationshipHint ?? "corroborating");
  await linkEventSource(eventId, rawItemId, relationship, relationship !== "relay");
  await setProcessingStatus(rawItemId, "merged");

  // Live Event Updates (spec "when new reports match an existing event, use their structured extracted
  // facts to propose/update the event"): attachment itself (above) is the "match" action; this turns that
  // match into reviewable proposals. Never fails the merge itself.
  const proposals = await proposeEventUpdatesFromReport(eventId, rawItemId);
  // A report's already-linked entities carry over to the event it's attached to.
  await propagateEntityLinksToEvent(rawItemId, eventId);
  await alertsForEvent(eventId);

  return { rawItemId, eventId, relationship, proposalsCreated: proposals.length };
}
