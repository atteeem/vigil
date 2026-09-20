import { NextResponse } from "next/server";
import { alertsForEvent } from "@/lib/alerts/hooks";
import { getEventWithSources, updateEvent, deleteEventCleanly } from "@/lib/db/repositories/events";
import { dbEventToConflictEvent } from "@/lib/data/world-events";
import { eventStatus } from "@/lib/data/event-status";
import { editEventInput } from "@/lib/data/event-input";

// Single-event admin view: the same shape /event/[slug] uses
// (dbEventToConflictEvent — title/type/location/sources/etc.) plus
// lifecycle fields the public page has no use for. Works for
// draft/unpublished events too, unlike getDbEventBySlug (published-only).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const event = await getEventWithSources(id);
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

  return NextResponse.json({
    ...dbEventToConflictEvent(event),
    locationName: event.locationName,
    status: eventStatus(event),
    publishedAt: event.publishedAt ? event.publishedAt.toISOString() : null,
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
  });
}

// Edit (spec "Event Editing"): only ordinary Event-table fields are ever
// touched here — EventSource links (supporting reports/corroboration
// metadata) are a completely separate table this route never writes to,
// so editing title/location/etc. can never destroy them.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const existing = await getEventWithSources(id);
  if (!existing) return NextResponse.json({ error: "Event not found" }, { status: 404 });

  const parsed = editEventInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid event fields." }, { status: 400 });
  const body = parsed.data;
  const updated = await updateEvent(id, {
    ...(body.title !== undefined && { title: body.title }),
    ...(body.summary !== undefined && { summary: body.summary }),
    ...(body.eventType !== undefined && { eventType: body.eventType }),
    ...(body.locationName !== undefined && { locationName: body.locationName }),
    ...(body.countryCode !== undefined && { countryCode: body.countryCode }),
    ...(body.region !== undefined && { region: body.region }),
    ...(body.latitude !== undefined && { latitude: body.latitude }),
    ...(body.longitude !== undefined && { longitude: body.longitude }),
    ...(body.occurredAt !== undefined && { occurredAt: new Date(body.occurredAt) }),
    ...(body.severity !== undefined && { severity: body.severity }),
    ...(body.importance !== undefined && { importance: body.importance }),
    ...(body.verificationStatus !== undefined && { verificationStatus: body.verificationStatus }),
    ...(body.conflictId !== undefined && { conflictId: body.conflictId }),
  });
  await alertsForEvent(updated.id);
  return NextResponse.json(updated);
}

// Delete (spec "must require a confirmation step" — enforced client-side;
// this is the actual deletion). deleteEventCleanly reverts any raw items
// that were only attached to this event back to "pending" rather than
// leaving them dangling — see its own comment in
// lib/db/repositories/events.ts for why.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const existing = await getEventWithSources(id);
  if (!existing) return NextResponse.json({ error: "Event not found" }, { status: 404 });

  await deleteEventCleanly(id);
  return NextResponse.json({ ok: true });
}
