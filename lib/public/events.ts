import { prisma } from "@/lib/db/client";
import type { Conflict, ConflictEvent } from "@/lib/types";
import { dbEventToConflictEvent } from "@/lib/data/world-events";
import { WITH_SOURCES } from "@/lib/db/repositories/events";
import { getPublicConflictBySlug } from "./conflicts";
import { resolveActorLinks, type ActorLink } from "./actors";
import { listConflictingClaims, type ConflictingClaims } from "./claims";
import { parseJsonArray } from "@/lib/ingestion/event-update-proposals";

// Bounded, published-only event reads for every public surface. Never returns
// "all events": callers get a recency window and a hard limit, plus a cursor
// for paging further back.

export const PUBLIC_EVENT_LIMIT = 300;
export const PUBLIC_EVENT_WINDOW_DAYS = 45;
const MAX_LIMIT = 500;

export interface PublicEventQuery {
  limit?: number;
  /** Only events that occurred within this many days before now (or before `before`). */
  sinceDays?: number;
  /** Cursor: only events strictly older than this ISO time. */
  before?: string | null;
  conflictId?: string;
  countryCode?: string;
}

export interface PublicEventPage {
  events: ConflictEvent[];
  /** Pass as `before` to fetch the next (older) page; null when there is nothing older in the window. */
  nextBefore: string | null;
}

export async function listPublicEvents(query: PublicEventQuery = {}): Promise<PublicEventPage> {
  const limit = Math.min(Math.max(1, query.limit ?? PUBLIC_EVENT_LIMIT), MAX_LIMIT);
  const upper = query.before ? new Date(query.before) : null;
  const sinceDays = query.sinceDays ?? PUBLIC_EVENT_WINDOW_DAYS;
  const since = new Date((upper ?? new Date()).getTime() - sinceDays * 86_400_000);
  const rows = await prisma.event.findMany({
    where: {
      published: true,
      occurredAt: { gte: since, ...(upper && !Number.isNaN(upper.getTime()) ? { lt: upper } : {}) },
      ...(query.conflictId ? { conflictId: query.conflictId } : {}),
      ...(query.countryCode ? { countryCode: query.countryCode.toUpperCase() } : {}),
    },
    include: WITH_SOURCES,
    orderBy: { occurredAt: "desc" },
    take: limit + 1,
  });
  const page = rows.slice(0, limit);
  return {
    events: page.map((e) => dbEventToConflictEvent(e)),
    nextBefore: rows.length > limit ? page[page.length - 1]!.occurredAt.toISOString() : null,
  };
}

export interface PublicEventDetail {
  event: ConflictEvent;
  conflict: Conflict | null;
  actors: ActorLink[];
  related: ConflictEvent[];
  /** Places tied to this event where two sides both claim control. */
  conflictingClaims: ConflictingClaims[];
  territorialChanges: {
    id: string;
    description: string;
    changeType: string;
    locationName: string | null;
    conflictSlug: string;
    sourceName: string | null;
    sourceUrl: string | null;
    geometryApplied: boolean;
  }[];
}

/** One published event with its conflict, actors (linked where they exist as stored
 * actors), related events and the approved territorial changes that trace back to
 * the same reports. */
export async function getPublicEventDetail(slug: string): Promise<PublicEventDetail | null> {
  const row = await prisma.event.findFirst({
    where: { slug, published: true },
    include: { ...WITH_SOURCES, history: { orderBy: { createdAt: "desc" }, take: 5 }, conflict: { select: { slug: true } }, militaryUnitLinks: { include: { unit: { select: { name: true } } } } },
  });
  if (!row) return null;
  const event = dbEventToConflictEvent(row);
  const rawIds = row.sources.map((s) => s.rawIngestionItemId);
  const [conflict, relatedRows, changes] = await Promise.all([
    row.conflict ? getPublicConflictBySlug(row.conflict.slug) : Promise.resolve(null),
    row.conflictId
      ? prisma.event.findMany({ where: { published: true, conflictId: row.conflictId, id: { not: row.id } }, include: WITH_SOURCES, orderBy: { occurredAt: "desc" }, take: 4 })
      : Promise.resolve([]),
    rawIds.length
      ? prisma.territorialChangeCandidate.findMany({ where: { status: "approved", rawIngestionItemId: { in: rawIds } }, include: { conflict: { select: { slug: true } } }, take: 5 })
      : Promise.resolve([]),
  ]);
  const locations = new Set(changes.map((c) => (c.locationName ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()).filter(Boolean));
  const conflictingClaims = row.conflictId && locations.size > 0 ? (await listConflictingClaims(row.conflictId)).filter((g) => locations.has(g.location.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim())) : [];
  const names = [...parseJsonArray(row.actors), ...row.militaryUnitLinks.map((l) => l.unit.name)];
  return {
    event,
    conflict,
    actors: await resolveActorLinks(names),
    related: relatedRows.map((e) => dbEventToConflictEvent(e)),
    conflictingClaims,
    territorialChanges: changes.map((c) => ({
      id: c.id,
      description: c.description,
      changeType: c.changeType,
      locationName: c.locationName,
      conflictSlug: c.conflict.slug,
      sourceName: c.sourceName,
      sourceUrl: c.sourceUrl && c.sourceUrl.trim() ? c.sourceUrl : null,
      geometryApplied: c.appliedTerritoryId != null,
    })),
  };
}
