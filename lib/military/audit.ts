import { prisma } from "@/lib/db/client";
import { STALE_RELATIONSHIP_DAYS, relationshipFreshness } from "./freshness";

// Admin intelligence audit: which entities are typed/sourced/fresh, and which need a human?
// Read-only aggregation; corrections go through the relationship endpoints.

export interface AuditFilters {
  entityType?: string;
  conflictId?: string;
  country?: string;
  /** Provenance source name contains this text. */
  source?: string;
  /** Text over name and aliases. */
  q?: string;
  /** stale | missing_provenance | unresolved_aliases | untyped */
  flag?: string;
  limit?: number;
}

export interface AuditRow {
  id: string;
  name: string;
  entityType: string | null;
  country: string | null;
  conflicts: string[];
  parent: string | null;
  sourceName: string | null;
  aliasCount: number;
  staleRelationships: number;
  missingProvenance: number;
  unresolvedAliases: number;
  flags: string[];
}

export async function auditEntities(filters: AuditFilters = {}, now: number = Date.now()): Promise<{ rows: AuditRow[]; total: number; matched: number }> {
  const idsFromText = filters.q
    ? new Set(
        (
          await prisma.entityAlias.findMany({ where: { entityKind: "unit", alias: { contains: filters.q } }, select: { entityId: true }, take: 300 })
        ).map((a) => a.entityId),
      )
    : null;
  const units = await prisma.militaryUnit.findMany({
    where: {
      ...(filters.entityType ? (filters.entityType === "untyped" ? { entityType: null } : { entityType: filters.entityType }) : {}),
      ...(filters.country ? { country: filters.country.toUpperCase() } : {}),
      ...(filters.conflictId ? { OR: [{ primaryConflictId: filters.conflictId }, { conflictLinks: { some: { conflictId: filters.conflictId } } }] } : {}),
      ...(filters.source ? { sourceName: { contains: filters.source } } : {}),
      ...(idsFromText ? { OR: [{ id: { in: [...idsFromText] } }, { name: { contains: filters.q } }] } : {}),
    },
    include: {
      parentUnit: { select: { name: true } },
      primaryConflict: { select: { name: true } },
      conflictLinks: { include: { conflict: { select: { name: true } } } },
      equipmentLinks: { select: { observedAt: true, sourceUrl: true, createdAt: true } },
      appointments: { where: { endDate: null }, select: { observedAt: true, lastConfirmedAt: true, sourceUrl: true, createdAt: true } },
      parentHistory: { where: { validTo: null }, select: { observedAt: true, sourceUrl: true } },
      _count: { select: { articleLinks: true } },
    },
    orderBy: { name: "asc" },
    take: 500,
  });
  const aliasCounts = new Map((await prisma.entityAlias.groupBy({ by: ["entityId"], where: { entityKind: "unit", aliasType: { not: "canonical" } }, _count: { _all: true } })).map((g) => [g.entityId, g._count._all]));
  const pending = await prisma.entityMatchReview.findMany({ where: { status: "pending", entityKind: "unit" }, select: { candidateIds: true } });
  const unresolvedByUnit = new Map<string, number>();
  for (const p of pending) for (const id of JSON.parse(p.candidateIds) as string[]) unresolvedByUnit.set(id, (unresolvedByUnit.get(id) ?? 0) + 1);

  const rows: AuditRow[] = units.map((u) => {
    let stale = 0;
    let missing = 0;
    const checkRel = (observed: Date | null | undefined, fallback: Date | null, url: string | null | undefined) => {
      if (relationshipFreshness((observed ?? fallback)?.toISOString() ?? null, now).state !== "fresh") stale++;
      if (!url) missing++;
    };
    u.equipmentLinks.forEach((e) => checkRel(e.observedAt, e.createdAt, e.sourceUrl));
    u.appointments.forEach((a) => checkRel(a.lastConfirmedAt ?? a.observedAt, a.createdAt, a.sourceUrl));
    u.parentHistory.forEach((h) => checkRel(h.observedAt, null, h.sourceUrl));
    if (!u.sourceUrl) missing++;
    const conflicts = [...new Set([u.primaryConflict?.name, ...u.conflictLinks.map((l) => l.conflict.name)].filter((n): n is string => Boolean(n)))];
    const flags: string[] = [];
    if (!u.entityType) flags.push("untyped");
    if (stale > 0) flags.push("stale");
    if (missing > 0) flags.push("missing_provenance");
    const unresolved = unresolvedByUnit.get(u.id) ?? 0;
    if (unresolved > 0) flags.push("unresolved_aliases");
    return { id: u.id, name: u.name, entityType: u.entityType, country: u.country, conflicts, parent: u.parentUnit?.name ?? null, sourceName: u.sourceName, aliasCount: aliasCounts.get(u.id) ?? 0, staleRelationships: stale, missingProvenance: missing, unresolvedAliases: unresolved, flags };
  });
  const matched = filters.flag ? rows.filter((r) => r.flags.includes(filters.flag!)) : rows;
  return { rows: matched.slice(0, filters.limit ?? 200), total: rows.length, matched: matched.length };
}

export { STALE_RELATIONSHIP_DAYS };
