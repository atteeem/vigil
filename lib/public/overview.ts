import { prisma } from "@/lib/db/client";
import type { Conflict, ConflictEvent } from "@/lib/types";
import { listPublicConflicts } from "./conflicts";
import { listPublicEvents } from "./events";
import { listPublicTerritorialChanges, type PublicTerritorialChange } from "./territory";

// One bounded payload for the homepage, globe, For You and heat surface: real
// conflicts, a recent-event window, the latest approved territorial changes and
// honest freshness stamps. Same builders as every other public path.

export interface PublicFreshness {
  /** When this payload was assembled (server time). NOT a statement that the world is "live". */
  generatedAt: string;
  /** Occurrence time of the newest published event, or null when there are none. */
  lastEventAt: string | null;
  /** Newest successful ingestion across enabled sources, or null when nothing was ever fetched. */
  lastIngestionAt: string | null;
  enabledSources: number;
  /** Enabled sources whose last success is older than STALE_SOURCE_HOURS (or that never succeeded). */
  staleSources: number;
}

export interface PublicOverview {
  conflicts: Conflict[];
  events: ConflictEvent[];
  /** The REAL total published-event count for the 30-day window `events` is drawn from — never
   * `events.length` (capped at 200), which several public surfaces used to display as if it were a total
   * (Pre-Launch Critical Correctness & Security v1 §8). */
  eventsTotal: number;
  territorialChanges: PublicTerritorialChange[];
  freshness: PublicFreshness;
}

export { STALE_SOURCE_HOURS } from "./stale";
import { STALE_SOURCE_HOURS } from "./stale";

export async function getPublicFreshness(now: Date = new Date()): Promise<PublicFreshness> {
  const [latest, sources] = await Promise.all([
    prisma.event.aggregate({ where: { published: true }, _max: { occurredAt: true } }),
    prisma.source.findMany({ where: { enabled: true }, select: { lastSuccessfulIngestion: true } }),
  ]);
  const cutoff = now.getTime() - STALE_SOURCE_HOURS * 3_600_000;
  let newest: Date | null = null;
  let stale = 0;
  for (const s of sources) {
    if (s.lastSuccessfulIngestion && (!newest || s.lastSuccessfulIngestion > newest)) newest = s.lastSuccessfulIngestion;
    if (!s.lastSuccessfulIngestion || s.lastSuccessfulIngestion.getTime() < cutoff) stale++;
  }
  return {
    generatedAt: now.toISOString(),
    lastEventAt: latest._max.occurredAt ? latest._max.occurredAt.toISOString() : null,
    lastIngestionAt: newest ? newest.toISOString() : null,
    enabledSources: sources.length,
    staleSources: stale,
  };
}

export async function getPublicOverview(): Promise<PublicOverview> {
  const [conflicts, page, territorialChanges, freshness] = await Promise.all([
    listPublicConflicts(),
    listPublicEvents({ limit: 200, sinceDays: 30 }),
    listPublicTerritorialChanges({ limit: 5 }),
    getPublicFreshness(),
  ]);
  return { conflicts, events: page.events, eventsTotal: page.total, territorialChanges, freshness };
}
