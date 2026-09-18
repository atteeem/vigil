import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { dbEventToConflictEvent } from "@/lib/data/world-events";
import { reconstructWorldStateAt } from "@/lib/db/repositories/event-reconstruction";

// Polled by hooks/use-live-events.ts so newly published events appear on
// /world without a full page reload (Implementation Order #13 / spec §15).
//
// Global Timeline / Historical Playback: an optional `at` query param
// (ISO timestamp) switches this from "current published events" to "the
// world as it was known/published at that moment" — same response
// shape either way, so hooks/use-world-events.ts needs no special-casing
// beyond which URL it fetches. Reuses reconstructWorldStateAt (which
// itself reuses the pure per-event replay logic from Event Version
// History) rather than a second query path.
export async function GET(request: Request) {
  const at = new URL(request.url).searchParams.get("at");
  if (at) {
    const timestamp = new Date(at);
    if (Number.isNaN(timestamp.getTime())) {
      return NextResponse.json({ error: "'at' is not a valid timestamp" }, { status: 400 });
    }
    const events = await reconstructWorldStateAt(timestamp);
    return NextResponse.json(events.map((e) => dbEventToConflictEvent(e)));
  }

  const events = await prisma.event.findMany({
    where: { published: true },
    include: { sources: { include: { rawIngestionItem: { include: { source: true } } } } },
    orderBy: { occurredAt: "desc" },
  });
  return NextResponse.json(events.map(dbEventToConflictEvent));
}
