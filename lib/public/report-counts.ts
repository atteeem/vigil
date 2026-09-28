import { prisma } from "@/lib/db/client";
import { TIME_RANGE_MS } from "@/lib/utils/time-range";
import { PUBLIC_EVENT_WINDOW_DAYS } from "./events";
import type { TimeRange } from "@/lib/types";

// THE canonical conflict report count: how many UNIQUE published reports (raw report ids) are attached to a conflict's
// published events in the displayed state (window, timeline asOf, event-type and region filters). Computed here, over
// the database, not over whatever bounded slice of events a page happened to load: the homepage globe and /world load
// different, capped event feeds, and counting on those slices gave different (and too small) numbers for the same
// conflict. Both renderers' conflict markers read this one result.
//
// Rules (mirroring /api/events and its ?at= reconstruction, lib/db/repositories/event-reconstruction.ts's
// reconstructWorldStateAt — the same "what was happening at T" semantic, not "what was known at T"):
//   - live: currently-published events, occurred within the window before now;
//   - historical (asOf): currently-published events that had OCCURRED by asOf (not "existed/were published by
//     asOf" — an event's ingestion/publish timing must never gate whether the real-world incident it describes
//     counts), occurred within the 45-day window before asOf, counting only report links attached by asOf
//     (which reports are shown as a source at that reconstructed state IS legitimately an attachment-time
//     question, unlike whether the underlying event counts at all);
//   - a report linked to several events of a conflict counts once; unpublished reports never count (a report is only
//     ever attached to a published event through publishing or a reviewed merge);
//   - country-level reports (no map point) count toward their conflict like any other.

export type CountWindow = TimeRange | "45D";
const WINDOW_MS: Record<CountWindow, number> = { ...TIME_RANGE_MS, "45D": PUBLIC_EVENT_WINDOW_DAYS * 86_400_000 };
export const COUNT_WINDOWS = Object.keys(WINDOW_MS) as CountWindow[];

export interface ReportCountQuery {
  window: CountWindow;
  asOf?: Date | null;
  eventType?: string | null;
  region?: string | null;
}

export interface ConflictReportCounts {
  window: CountWindow;
  asOf: string | null;
  since: string;
  /** conflictId -> unique published reports. Conflicts with none are absent. */
  conflicts: Record<string, number>;
  /** conflictId -> the subset of `conflicts[id]` attached to events that HAVE a map point (locationScope
   * "region"/"city"/"point" with real coordinates). `conflicts[id] - mapped[id]` is the country-level/
   * unknown-scope count with no point at all — Final Intelligence Consistency & Map Correctness v1 §9:
   * the map needs this split so a conflict's aggregate marker can say "18 mapped · 23 country-level"
   * instead of implying every report occurred at one marker's exact coordinates, and so that count is
   * never silently dropped once the map zooms past the aggregate marker's own visibility range. */
  mapped: Record<string, number>;
}

export async function conflictReportCounts(q: ReportCountQuery): Promise<ConflictReportCounts> {
  const ref = q.asOf ?? new Date();
  const since = new Date(ref.getTime() - WINDOW_MS[q.window]);
  const links = await prisma.eventSource.findMany({
    where: {
      ...(q.asOf ? { createdAt: { lte: q.asOf } } : {}),
      event: {
        conflictId: { not: null },
        occurredAt: { gte: since, lte: ref },
        published: true,
        ...(q.eventType ? { eventType: q.eventType } : {}),
        ...(q.region ? { region: q.region } : {}),
      },
    },
    select: { rawIngestionItemId: true, event: { select: { conflictId: true, latitude: true, longitude: true } } },
  });
  const sets = new Map<string, Set<string>>();
  const mappedSets = new Map<string, Set<string>>();
  for (const l of links) {
    const c = l.event.conflictId!;
    let s = sets.get(c);
    if (!s) sets.set(c, (s = new Set()));
    s.add(l.rawIngestionItemId);
    if (l.event.latitude != null && l.event.longitude != null) {
      let ms = mappedSets.get(c);
      if (!ms) mappedSets.set(c, (ms = new Set()));
      ms.add(l.rawIngestionItemId);
    }
  }
  return {
    window: q.window,
    asOf: q.asOf ? q.asOf.toISOString() : null,
    since: since.toISOString(),
    conflicts: Object.fromEntries([...sets].map(([id, s]) => [id, s.size])),
    mapped: Object.fromEntries([...mappedSets].map(([id, s]) => [id, s.size])),
  };
}
