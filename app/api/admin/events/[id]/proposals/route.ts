import { NextResponse } from "next/server";
import { getEvent } from "@/lib/db/repositories/events";
import { listProposalsForEvent } from "@/lib/db/repositories/event-updates";

// Live Event Updates (spec "on the event/admin review view show... new
// supporting reports, pending updates, changed fields, confidence,
// provenance, conflict warnings"): every proposal for this event
// (pending, accepted, and rejected — the admin page filters client-side),
// each with hasConflict computed fresh (see listProposalsForEvent).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const event = await getEvent(id);
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

  const proposals = await listProposalsForEvent(id);
  return NextResponse.json({ proposals });
}
