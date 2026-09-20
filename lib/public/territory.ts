import { prisma } from "@/lib/db/client";
import { resolveActorLinks, type ActorLink } from "./actors";

// Public territorial state, read from the same published tables the map uses.
// Only APPROVED territorial-change records are public; pending/rejected
// candidates are review-queue material and never shown.

export interface PublicTerritorialChange {
  id: string;
  conflictSlug: string;
  conflictName: string;
  description: string;
  changeType: string;
  locationName: string | null;
  claimedActor: ActorLink | null;
  previousActor: ActorLink | null;
  observedAt: string | null;
  reviewedAt: string | null;
  /** Reported-claim confidence (0-1). Not conflict severity. */
  confidence: number;
  /** The original report the claim came from — null when none was stored. */
  sourceName: string | null;
  sourceUrl: string | null;
  /** True once the approval changed published territorial control; false when it is a verified record still awaiting geometry. */
  geometryApplied: boolean;
}

export async function listPublicTerritorialChanges(options: { conflictId?: string; limit?: number } = {}): Promise<PublicTerritorialChange[]> {
  const rows = await prisma.territorialChangeCandidate.findMany({
    where: { status: "approved", ...(options.conflictId ? { conflictId: options.conflictId } : {}) },
    include: { conflict: { select: { slug: true, name: true } }, claimedActor: { select: { name: true } }, previousActor: { select: { name: true } } },
    orderBy: [{ reviewedAt: "desc" }, { createdAt: "desc" }],
    take: options.limit ?? 10,
  });
  const names = rows.flatMap((r) => [r.claimedActor?.name, r.previousActor?.name].filter((n): n is string => Boolean(n)));
  const links = new Map((await resolveActorLinks(names)).map((l) => [l.name, l]));
  return rows.map((r) => ({
    id: r.id,
    conflictSlug: r.conflict.slug,
    conflictName: r.conflict.name,
    description: r.description,
    changeType: r.changeType,
    locationName: r.locationName,
    claimedActor: r.claimedActor ? (links.get(r.claimedActor.name) ?? { name: r.claimedActor.name, href: null }) : null,
    previousActor: r.previousActor ? (links.get(r.previousActor.name) ?? { name: r.previousActor.name, href: null }) : null,
    observedAt: r.observedAt ? r.observedAt.toISOString() : null,
    reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
    confidence: r.confidence,
    sourceName: r.sourceName,
    sourceUrl: r.sourceUrl && r.sourceUrl.trim() ? r.sourceUrl : null,
    geometryApplied: r.appliedTerritoryId != null,
  }));
}

export interface PublicTerritorySummary {
  areas: number;
  actors: { name: string; areas: number; link: ActorLink }[];
  statuses: Record<string, number>;
  /** validFrom of the most recently created published version. */
  lastChangeAt: string | null;
}

/** Currently valid published territorial control for one conflict. */
export async function getPublicTerritorySummary(conflictId: string, now: Date = new Date()): Promise<PublicTerritorySummary> {
  const rows = await prisma.conflictTerritory.findMany({
    where: { conflictId, published: true, validFrom: { lte: now }, OR: [{ validTo: null }, { validTo: { gt: now } }] },
    select: { status: true, validFrom: true, actor: { select: { name: true } } },
  });
  const byActor = new Map<string, number>();
  const statuses: Record<string, number> = {};
  let last: Date | null = null;
  for (const r of rows) {
    statuses[r.status] = (statuses[r.status] ?? 0) + 1;
    if (r.actor) byActor.set(r.actor.name, (byActor.get(r.actor.name) ?? 0) + 1);
    if (!last || r.validFrom > last) last = r.validFrom;
  }
  const links = new Map((await resolveActorLinks([...byActor.keys()])).map((l) => [l.name, l]));
  return {
    areas: rows.length,
    actors: [...byActor.entries()].map(([name, areas]) => ({ name, areas, link: links.get(name) ?? { name, href: null } })).sort((a, b) => b.areas - a.areas),
    statuses,
    lastChangeAt: last ? last.toISOString() : null,
  };
}
