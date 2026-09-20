import { NextResponse } from "next/server";
import { dbEventToConflictEvent } from "@/lib/data/world-events";
import { reconstructWorldStateAt } from "@/lib/db/repositories/event-reconstruction";
import { listPublicEvents, PUBLIC_EVENT_WINDOW_DAYS } from "@/lib/public/events";

// Polled by hooks/use-live-events.ts so newly published events appear on
// /world without a full page reload.
//
// Bounded by design: only the last PUBLIC_EVENT_WINDOW_DAYS days, at most
// `limit` (default 300, max 500) newest-first, with `before` (ISO) to page back.
//
// Global Timeline / Historical Playback: an optional `at` query param
// (ISO timestamp) switches this from "current published events" to "the
// world as it was known/published at that moment" — same response
// shape either way. Reuses reconstructWorldStateAt, limited to the same
// recency window before `at`.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const at = params.get("at");
  if (at) {
    const timestamp = new Date(at);
    if (Number.isNaN(timestamp.getTime())) {
      return NextResponse.json({ error: "'at' is not a valid timestamp" }, { status: 400 });
    }
    const events = await reconstructWorldStateAt(timestamp);
    const floor = timestamp.getTime() - PUBLIC_EVENT_WINDOW_DAYS * 86_400_000;
    return NextResponse.json(events.filter((e) => e.occurredAt.getTime() >= floor).slice(0, 500).map((e) => dbEventToConflictEvent(e)));
  }
  const before = params.get("before");
  if (before && Number.isNaN(new Date(before).getTime())) {
    return NextResponse.json({ error: "'before' is not a valid timestamp" }, { status: 400 });
  }
  const limit = Number(params.get("limit") ?? "") || undefined;
  const page = await listPublicEvents({ limit, before });
  return NextResponse.json(page.events, { headers: page.nextBefore ? { "x-next-before": page.nextBefore } : {} });
}
