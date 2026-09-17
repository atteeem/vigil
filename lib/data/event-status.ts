import type { EventStatus } from "@/lib/types/db";

// Zero server-only dependencies (no Prisma import), same reasoning as
// lib/data/corroboration.ts — safe to call from client components too.

/** Derives an event's lifecycle status from its two underlying columns.
 * "draft" (never published) and "unpublished" (was live, now hidden) both
 * have published === false; publishedAt (set once, on first publish, and
 * never cleared by Unpublish) is what tells them apart. */
export function eventStatus(event: { published: boolean; publishedAt: string | Date | null }): EventStatus {
  if (event.published) return "published";
  return event.publishedAt ? "unpublished" : "draft";
}
