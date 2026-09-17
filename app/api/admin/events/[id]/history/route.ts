import { NextResponse } from "next/server";
import { getEvent } from "@/lib/db/repositories/events";
import { listEventHistory, toEventHistoryDTO } from "@/lib/db/repositories/event-updates";

// Full, unfiltered history for the admin view (spec "Event history...
// track field changed, old value, new value, source/report responsible,
// timestamp, whether automatic or admin-approved"). The public page uses
// a separate, deliberately shorter slice of the same table — see
// lib/data/world-events.ts's getDbEventBySlug.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const event = await getEvent(id);
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

  const history = await listEventHistory(id);
  return NextResponse.json({ history: history.map(toEventHistoryDTO) });
}
