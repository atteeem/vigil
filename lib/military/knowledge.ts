import { prisma } from "@/lib/db/client";
import type { RelationType } from "./entity-types";

// Relationship writes for the knowledge layer. Every function keeps HISTORY (a change closes
// the previous row rather than overwriting it) and records provenance: source name/URL, when
// it was observed, and how sure. Seeded/manual knowledge is "as of" its observation — it is
// never treated as eternally true.

export interface Provenance {
  sourceName?: string | null;
  sourceUrl?: string | null;
  observedAt?: Date | null;
  confidence?: number | null;
  note?: string | null;
}

const clampConfidence = (c: number | null | undefined) => (c == null ? null : Math.max(0, Math.min(1, c)));

/** True if `candidateParentId` is `unitId` itself or one of its descendants (would make a cycle). */
async function wouldCycle(unitId: string, candidateParentId: string): Promise<boolean> {
  let cursor: string | null = candidateParentId;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    if (cursor === unitId) return true;
    seen.add(cursor);
    const next: { parentUnitId: string | null } | null = await prisma.militaryUnit.findUnique({ where: { id: cursor }, select: { parentUnitId: true } });
    cursor = next?.parentUnitId ?? null;
  }
  return false;
}

/** Sets a unit's parent formation, keeping history. A no-op when the parent is unchanged. The
 * previous parent's history row is closed (validTo = when the change takes effect), a new one
 * opened, and MilitaryUnit.parentUnitId updated as the current pointer. */
export async function setUnitParent(unitId: string, parentId: string | null, options: Provenance & { validFrom?: Date | null } = {}): Promise<{ changed: boolean }> {
  const unit = await prisma.militaryUnit.findUnique({ where: { id: unitId }, select: { parentUnitId: true } });
  if (!unit) throw new Error("Unit not found");
  if (parentId && (await wouldCycle(unitId, parentId))) throw new Error("A unit cannot be its own ancestor");
  const openRows = await prisma.unitParentHistory.findMany({ where: { unitId, validTo: null } });
  if ((unit.parentUnitId ?? null) === (parentId ?? null) && (openRows.length > 0 || parentId === null)) {
    // Same parent: only refresh provenance on the open row.
    if (openRows[0] && (options.sourceUrl || options.observedAt)) {
      await prisma.unitParentHistory.update({ where: { id: openRows[0].id }, data: { observedAt: options.observedAt ?? new Date(), sourceName: options.sourceName ?? openRows[0].sourceName, sourceUrl: options.sourceUrl ?? openRows[0].sourceUrl } });
    }
    return { changed: false };
  }
  const effective = options.validFrom ?? new Date();
  await prisma.$transaction([
    prisma.unitParentHistory.updateMany({ where: { unitId, validTo: null }, data: { validTo: effective } }),
    prisma.unitParentHistory.create({
      data: { unitId, parentUnitId: parentId, validFrom: options.validFrom ?? null, sourceName: options.sourceName ?? null, sourceUrl: options.sourceUrl ?? null, observedAt: options.observedAt ?? new Date(), confidence: clampConfidence(options.confidence), note: options.note ?? null },
    }),
    prisma.militaryUnit.update({ where: { id: unitId }, data: { parentUnitId: parentId, lastUpdatedAt: new Date() } }),
  ]);
  return { changed: true };
}

/** Records that `commanderId` commands/serves in `unitId`. If they already hold an open
 * appointment there, it is re-confirmed (lastConfirmedAt) instead of duplicated; if they move,
 * the old appointment is closed and kept. Also updates the commander's current-unit pointer. */
export async function appointCommander(commanderId: string, unitId: string, options: Provenance & { role?: string | null; startDate?: Date | null } = {}): Promise<{ created: boolean }> {
  const open = await prisma.commanderAppointment.findMany({ where: { commanderId, endDate: null } });
  const same = open.find((a) => a.unitId === unitId && (a.role ?? "commander") === (options.role ?? "commander"));
  if (same) {
    await prisma.commanderAppointment.update({ where: { id: same.id }, data: { lastConfirmedAt: new Date(), observedAt: options.observedAt ?? new Date(), sourceName: options.sourceName ?? same.sourceName, sourceUrl: options.sourceUrl ?? same.sourceUrl, confidence: clampConfidence(options.confidence) ?? same.confidence } });
    await prisma.commander.update({ where: { id: commanderId }, data: { currentUnitId: unitId, lastUpdatedAt: new Date() } });
    return { created: false };
  }
  const start = options.startDate ?? new Date();
  await prisma.$transaction([
    prisma.commanderAppointment.updateMany({ where: { commanderId, endDate: null, NOT: { unitId } }, data: { endDate: start } }),
    prisma.commanderAppointment.create({
      data: { commanderId, unitId, role: options.role ?? "commander", startDate: options.startDate ?? null, sourceName: options.sourceName ?? null, sourceUrl: options.sourceUrl ?? null, observedAt: options.observedAt ?? new Date(), confidence: clampConfidence(options.confidence), lastConfirmedAt: new Date() },
    }),
    prisma.commander.update({ where: { id: commanderId }, data: { currentUnitId: unitId, lastUpdatedAt: new Date() } }),
  ]);
  return { created: true };
}

/** Actor -> conflict participation with provenance (idempotent; re-observation refreshes it). */
export async function linkParticipant(conflictId: string, unitId: string, role: "belligerent" | "participant" | "supporter", options: Provenance & { validFrom?: Date | null } = {}): Promise<void> {
  await prisma.conflictParticipant.upsert({
    where: { conflictId_unitId: { conflictId, unitId } },
    update: { role, observedAt: options.observedAt ?? new Date(), sourceName: options.sourceName ?? undefined, sourceUrl: options.sourceUrl ?? undefined, confidence: clampConfidence(options.confidence) ?? undefined },
    create: { conflictId, unitId, role, note: options.note ?? null, sourceName: options.sourceName ?? null, sourceUrl: options.sourceUrl ?? null, observedAt: options.observedAt ?? new Date(), confidence: clampConfidence(options.confidence), validFrom: options.validFrom ?? null },
  });
}

/** Allied / cooperating / opposing relationships, ONLY when explicitly asserted with a source.
 * Never inferred from two actors appearing in the same event. */
export async function addActorRelationship(fromId: string, toId: string, relationType: RelationType, options: Provenance & { conflictId?: string | null; validFrom?: Date | null } = {}): Promise<{ created: boolean }> {
  if (fromId === toId) throw new Error("An actor cannot be related to itself");
  const conflictId = options.conflictId ?? null;
  const existing = await prisma.actorRelationship.findFirst({ where: { fromId, toId, relationType, conflictId } });
  if (existing) {
    await prisma.actorRelationship.update({ where: { id: existing.id }, data: { observedAt: options.observedAt ?? new Date(), sourceName: options.sourceName ?? existing.sourceName, sourceUrl: options.sourceUrl ?? existing.sourceUrl, confidence: clampConfidence(options.confidence) ?? existing.confidence } });
    return { created: false };
  }
  await prisma.actorRelationship.create({ data: { fromId, toId, relationType, conflictId, sourceName: options.sourceName ?? null, sourceUrl: options.sourceUrl ?? null, observedAt: options.observedAt ?? new Date(), confidence: clampConfidence(options.confidence), validFrom: options.validFrom ?? null } });
  return { created: true };
}
