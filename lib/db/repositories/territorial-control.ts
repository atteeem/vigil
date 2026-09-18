import { prisma } from "@/lib/db/client";
import type { ConflictActor, ConflictTerritory, Conflict } from "@prisma/client";
import { nextActorColor } from "@/lib/map/territorial-colors";
import { deriveDisplayStatus, parseTerritorialGeometry } from "@/lib/data/territorial-control";
import type {
  AssignableTerritorialStatus,
  ConflictActorDTO,
  TerritorialGeometry,
  TerritoryDTO,
} from "@/lib/types/territorial-control";

export function toActorDTO(actor: ConflictActor): ConflictActorDTO {
  return {
    id: actor.id,
    conflictId: actor.conflictId,
    name: actor.name,
    color: actor.color,
    createdAt: actor.createdAt.toISOString(),
  };
}

type TerritoryRow = ConflictTerritory & { conflict: Conflict; actor: ConflictActor | null };

/** `asOf`, when given, drives the derived "recently_changed" DISPLAY
 * status (see lib/data/territorial-control.ts) — which rows are even in
 * the input set is already decided by the caller's own validFrom/validTo
 * query, so this never re-filters by time itself. Omitted (admin
 * contexts — listAllTerritoriesAdmin, getTerritory), the raw ASSIGNED
 * status is returned instead: an admin table showing "recently_changed"
 * for a row an admin just set to "uncertain" would misrepresent what
 * they actually configured — that derivation is purely a public-map
 * presentation concern (see listTerritoriesAt). Returns null (skip this
 * row) for unparsable geometry rather than throwing, same reasoning as
 * parseTerritorialGeometry. */
function toTerritoryDTO(row: TerritoryRow, asOf?: Date): TerritoryDTO | null {
  const geometry = parseTerritorialGeometry(row.geometry);
  if (!geometry) return null;
  return {
    id: row.id,
    conflictId: row.conflictId,
    conflictName: row.conflict.name,
    actorId: row.actorId,
    actorName: row.actor?.name ?? null,
    actorColor: row.actor?.color ?? "#8a8f98",
    status: asOf ? deriveDisplayStatus(row.status as AssignableTerritorialStatus, row.validFrom, asOf) : (row.status as AssignableTerritorialStatus),
    confidence: row.confidence,
    geometry,
    sourceName: row.sourceName,
    sourceUrl: row.sourceUrl,
    validFrom: row.validFrom.toISOString(),
    validTo: row.validTo ? row.validTo.toISOString() : null,
    published: row.published,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const WITH_RELATIONS = { conflict: true, actor: true } as const;

export function listActorsForConflict(conflictId: string): Promise<ConflictActor[]> {
  return prisma.conflictActor.findMany({ where: { conflictId }, orderBy: { createdAt: "asc" } });
}

/** Creates a new actor for a conflict, assigning the next unused palette
 * color by position among that conflict's existing actors (spec "each
 * actor may have a stable map color within that conflict"). */
export async function createActor(conflictId: string, name: string): Promise<ConflictActor> {
  const existingCount = await prisma.conflictActor.count({ where: { conflictId } });
  return prisma.conflictActor.create({ data: { conflictId, name: name.trim(), color: nextActorColor(existingCount) } });
}

/** Territorial state "as of" a timestamp (spec §5: Live shows current
 * state, T = now works identically to any historical T since both are
 * just the query bound — no separate live-vs-historical branch needed).
 * A single indexed query, published-only — future/expired versions are
 * excluded purely by the validFrom/validTo bounds, never by re-checking
 * status client-side. */
export async function listTerritoriesAt(timestamp: Date): Promise<TerritoryDTO[]> {
  const rows = await prisma.conflictTerritory.findMany({
    where: {
      published: true,
      validFrom: { lte: timestamp },
      OR: [{ validTo: null }, { validTo: { gt: timestamp } }],
    },
    include: WITH_RELATIONS,
    orderBy: { validFrom: "asc" },
  });
  return rows.map((r) => toTerritoryDTO(r, timestamp)).filter((t): t is TerritoryDTO => t !== null);
}

/** Every row (draft + published, every historical version) for the admin
 * table — deliberately not time-filtered, and deliberately shows each
 * row's raw ASSIGNED status (see toTerritoryDTO's own comment), not the
 * "recently changed" display derivation the public map applies. */
export async function listAllTerritoriesAdmin(): Promise<TerritoryDTO[]> {
  const rows = await prisma.conflictTerritory.findMany({
    include: WITH_RELATIONS,
    orderBy: [{ conflictId: "asc" }, { validFrom: "desc" }],
  });
  return rows.map((r) => toTerritoryDTO(r)).filter((t): t is TerritoryDTO => t !== null);
}

export async function getTerritory(id: string): Promise<TerritoryDTO | null> {
  const row = await prisma.conflictTerritory.findUnique({ where: { id }, include: WITH_RELATIONS });
  if (!row) return null;
  return toTerritoryDTO(row);
}

export interface TerritoryInput {
  conflictId: string;
  actorId?: string | null;
  status: AssignableTerritorialStatus;
  confidence: number;
  geometry: TerritorialGeometry;
  sourceName?: string | null;
  sourceUrl?: string | null;
  validFrom: Date;
  validTo?: Date | null;
}

function toRow(input: TerritoryInput) {
  return {
    conflictId: input.conflictId,
    actorId: input.actorId ?? null,
    status: input.status,
    confidence: input.confidence,
    geometry: JSON.stringify(input.geometry),
    sourceName: input.sourceName ?? null,
    sourceUrl: input.sourceUrl ?? null,
    validFrom: input.validFrom,
    validTo: input.validTo ?? null,
  };
}

/** Creates a new DRAFT version (published: false) — freely editable/
 * deletable until published. */
export function createTerritoryDraft(input: TerritoryInput): Promise<ConflictTerritory> {
  return prisma.conflictTerritory.create({ data: { ...toRow(input), published: false } });
}

/** Drafts only — a published row is immutable (spec "must remain
 * historically reconstructable"); the only way to change a published
 * row's control state is supersedeTerritory below. Throws if the row is
 * already published so a caller can't silently no-op an edit it expected
 * to apply. */
export async function updateTerritoryDraft(id: string, input: Partial<TerritoryInput>): Promise<ConflictTerritory> {
  const existing = await prisma.conflictTerritory.findUnique({ where: { id } });
  if (!existing) throw new Error("Territory not found");
  if (existing.published) throw new Error("Cannot edit a published territory version — supersede it instead");
  const data: Record<string, unknown> = {};
  if (input.conflictId !== undefined) data.conflictId = input.conflictId;
  if (input.actorId !== undefined) data.actorId = input.actorId;
  if (input.status !== undefined) data.status = input.status;
  if (input.confidence !== undefined) data.confidence = input.confidence;
  if (input.geometry !== undefined) data.geometry = JSON.stringify(input.geometry);
  if (input.sourceName !== undefined) data.sourceName = input.sourceName;
  if (input.sourceUrl !== undefined) data.sourceUrl = input.sourceUrl;
  if (input.validFrom !== undefined) data.validFrom = input.validFrom;
  if (input.validTo !== undefined) data.validTo = input.validTo;
  return prisma.conflictTerritory.update({ where: { id }, data });
}

/** Draft → published. Once published a row is immutable (see model
 * comment in prisma/schema.prisma) — validated here rather than left to
 * the DB, since "geometry"/"status"/"validFrom" are required for a
 * published row to mean anything on the map. */
export async function publishTerritory(id: string): Promise<ConflictTerritory> {
  const existing = await prisma.conflictTerritory.findUnique({ where: { id } });
  if (!existing) throw new Error("Territory not found");
  if (!existing.geometry || !existing.status || !existing.validFrom) {
    throw new Error("Territory is missing required fields (geometry, status, validFrom)");
  }
  return prisma.conflictTerritory.update({ where: { id }, data: { published: true } });
}

/** Draft only — a published row is permanent history, never deletable
 * (spec "remove erroneous UNPUBLISHED data" is explicitly scoped to
 * unpublished rows only). */
export async function deleteTerritoryDraft(id: string): Promise<void> {
  const existing = await prisma.conflictTerritory.findUnique({ where: { id } });
  if (!existing) throw new Error("Territory not found");
  if (existing.published) throw new Error("Cannot delete a published territory version — it is permanent history");
  await prisma.conflictTerritory.delete({ where: { id } });
}

/** "Changing control must preserve previous historical state rather than
 * overwriting it" (spec §6/§4) — in one transaction, closes out the
 * currently-active published version (sets its validTo to the new
 * version's validFrom) and creates a new published version starting
 * there. Only valid on a row that is currently active (published, and
 * validTo still null) — superseding an already-closed or draft row would
 * either double-close history or skip the publish step, neither of which
 * is a coherent "control changed" action. */
export async function supersedeTerritory(
  currentId: string,
  next: Omit<TerritoryInput, "conflictId"> & { conflictId?: string },
): Promise<{ previous: ConflictTerritory; next: ConflictTerritory }> {
  const current = await prisma.conflictTerritory.findUnique({ where: { id: currentId } });
  if (!current) throw new Error("Territory not found");
  if (!current.published) throw new Error("Cannot supersede a draft — publish it first, or edit it directly");
  if (current.validTo !== null) throw new Error("This territory version has already been superseded");
  if (next.validFrom.getTime() < current.validFrom.getTime()) {
    throw new Error("A superseding version's validFrom cannot be before the version it replaces");
  }

  const [previous, created] = await prisma.$transaction([
    prisma.conflictTerritory.update({ where: { id: currentId }, data: { validTo: next.validFrom } }),
    prisma.conflictTerritory.create({
      data: { ...toRow({ ...next, conflictId: next.conflictId ?? current.conflictId }), published: true },
    }),
  ]);
  return { previous, next: created };
}
