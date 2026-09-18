import { NextResponse } from "next/server";
import { getEvent } from "@/lib/db/repositories/events";
import { reconstructEventStateAt } from "@/lib/db/repositories/event-reconstruction";

// Event Version History (spec "add a service/function that can
// reconstruct an event as it existed at any timestamp"). Query param
// `at` is a required ISO timestamp — this endpoint answers "what did
// this event look like at time T," not "what does it look like now"
// (that's the plain GET /api/admin/events/[id]). Part of the "historical
// query foundation" §5 the next (global timeline) milestone builds on;
// no UI beyond the admin history panel calls this yet.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const event = await getEvent(id);
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

  const at = new URL(request.url).searchParams.get("at");
  if (!at) return NextResponse.json({ error: "Query param 'at' (ISO timestamp) is required" }, { status: 400 });
  const timestamp = new Date(at);
  if (Number.isNaN(timestamp.getTime())) return NextResponse.json({ error: "'at' is not a valid timestamp" }, { status: 400 });

  const state = await reconstructEventStateAt(id, timestamp);
  if (!state) return NextResponse.json({ error: "Event did not exist yet at this timestamp" }, { status: 404 });
  return NextResponse.json(state);
}
