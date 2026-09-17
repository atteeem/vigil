import type { ConflictEvent } from "@/lib/types";
import type { EventCorroborationDTO } from "@/lib/types/db";

// Deliberately has zero server-only dependencies (no Prisma import) so it
// can run in both server code (app/api/admin/events routes) and client
// components (app/admin/events pages) without pulling the Prisma client
// into the browser bundle.

/** Derives corroboration metadata (spec "Event corroboration metadata")
 * from an already-converted event's sources — descriptive only, never a
 * truth/credibility score (see EventCorroborationDTO's own comment). Pure
 * function of `sources`/`sourceCount`, so it works for both a freshly
 * queried DB event and (in tests) a hand-built ConflictEvent. */
export function getEventCorroboration(event: Pick<ConflictEvent, "sources" | "sourceCount">): EventCorroborationDTO {
  const timestamps = event.sources.map((s) => new Date(s.publishedAt).getTime());
  return {
    supportingReportCount: event.sources.length,
    independentSourceCount: event.sourceCount,
    sourceCategories: Array.from(new Set(event.sources.map((s) => s.sourceType))).sort(),
    earliestSourceAt: new Date(Math.min(...timestamps)).toISOString(),
    latestCorroborationAt: new Date(Math.max(...timestamps)).toISOString(),
  };
}
