import { NextResponse } from "next/server";
import { listEventIdsKnownAt } from "@/lib/db/repositories/event-reconstruction";

// Event Version History §5 "historical query foundation" — "events
// active/known at timestamp T." Deliberately lightweight (id/slug/title
// only); a caller wanting full reconstructed state for any of these
// calls GET /api/admin/events/[id]/reconstruct?at=... per event. Not
// wired into any UI yet — foundation for the global-timeline milestone,
// per spec "do not build the full global time-slider UI yet."
export async function GET(request: Request) {
  const at = new URL(request.url).searchParams.get("at");
  if (!at) return NextResponse.json({ error: "Query param 'at' (ISO timestamp) is required" }, { status: 400 });
  const timestamp = new Date(at);
  if (Number.isNaN(timestamp.getTime())) return NextResponse.json({ error: "'at' is not a valid timestamp" }, { status: 400 });

  const events = await listEventIdsKnownAt(timestamp);
  return NextResponse.json({ events });
}
