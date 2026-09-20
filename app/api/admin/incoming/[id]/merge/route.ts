import { NextResponse } from "next/server";
import { alertsForEvent } from "@/lib/alerts/hooks";
import { prisma } from "@/lib/db/client";
import { linkEventSource } from "@/lib/db/repositories/event-sources";
import { setProcessingStatus } from "@/lib/db/repositories/raw-ingestion-items";
import { proposeEventUpdatesFromReport } from "@/lib/db/repositories/event-updates";
import { propagateEntityLinksToEvent } from "@/lib/military/link-entities";
import type { EventSourceRelationship } from "@/lib/types/db";
import { isAggregatorRole } from "@/lib/registry/source-tiers";

interface MergeBody {
  eventId: string;
  relationship?: EventSourceRelationship;
}

// MERGE: attaches this raw item to an EXISTING event as an additional
// source rather than creating a new one — for a duplicate/corroborating
// report of something already published. Per Decisions.md, a relay of the
// same originating source still counts as one underlying source, so the
// caller is expected to pass relationship: "relay" for that case (default
// here is "corroborating", i.e. a genuinely independent second source).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json()) as MergeBody;
  if (!body.eventId) return NextResponse.json({ error: "eventId is required" }, { status: 400 });

  const event = await prisma.event.findUnique({ where: { id: body.eventId } });
  if (!event) return NextResponse.json({ error: "Target event not found" }, { status: 404 });

  // An aggregator/relay report is never an independent confirmation: whatever the
  // caller asked for, it is attached as a relay (still shown as a supporting
  // report, but not counted as an independent source).
  const rawItem = await prisma.rawIngestionItem.findUnique({ where: { id }, include: { source: { select: { sourceRole: true } } } });
  const relationship: EventSourceRelationship = isAggregatorRole(rawItem?.source.sourceRole) ? "relay" : (body.relationship ?? "corroborating");
  await linkEventSource(body.eventId, id, relationship, relationship !== "relay");
  const item = await setProcessingStatus(id, "merged");

  // Live Event Updates (spec "when new reports match an existing event,
  // use their structured extracted facts to propose/update the event"):
  // attachment itself (above) is the "match" action; this is what turns
  // that match into reviewable proposals. Never fails the merge itself —
  // a report with no extracted facts yet just proposes nothing.
  const proposals = await proposeEventUpdatesFromReport(body.eventId, id);

  // Myanmar Specialist Source Integration (spec §4 "actor -> events") —
  // same propagation as publish: a merged report's already-linked units
  // carry over to the event it's attached to.
  await propagateEntityLinksToEvent(id, body.eventId);

  await alertsForEvent(body.eventId);
  return NextResponse.json({ ...item, proposalsCreated: proposals.length });
}
