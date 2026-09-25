import { prisma } from "@/lib/db/client";
import type { ConflictActor, ConflictTerritory, Conflict, TerritorialDataset } from "@prisma/client";
import { nextActorColor } from "@/lib/map/territorial-colors";
import { deriveDisplayStatus, parseTerritorialGeometry } from "@/lib/data/territorial-control";
import { splitGeometry, validateTerritorialGeometry } from "@/lib/territory/geometry";
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

type TerritoryRow = ConflictTerritory & { conflict: Conflict; actor: ConflictActor | null; dataset?: Pick<TerritorialDataset, "name" | "provider" | "license" | "attribution" | "datasetType" | "lastUpdated"> | null };

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
    conflictSlug: row.conflict.slug,
    actorId: row.actorId,
    actorName: row.actor?.name ?? null,
    actorColor: row.actor?.color ?? "#8a8f98",
    status: asOf ? deriveDisplayStatus(row.status as AssignableTerritorialStatus, row.validFrom, asOf) : (row.status as AssignableTerritorialStatus),
    territoryKind: (["control", "influence", "presence"].includes(row.territoryKind) ? row.territoryKind : "control") as TerritoryDTO["territoryKind"],
    datasetId: row.datasetId,
    // Dataset provenance travels with every area: an attribution licence (e.g. CC BY) must be visible where it is shown.
    datasetName: row.dataset?.name ?? null,
    datasetProvider: row.dataset?.provider ?? null,
    datasetLicense: row.dataset?.license ?? null,
    datasetAttribution: row.dataset?.attribution ?? null,
    datasetUpdatedAt: row.dataset?.lastUpdated ? row.dataset.lastUpdated.toISOString() : null,
    confidence: row.confidence,
    geometry,
    sourceName: row.sourceName,
    sourceUrl: row.sourceUrl,
    validFrom: row.validFrom.toISOString(),
    validTo: row.validTo ? row.validTo.toISOString() : null,
    published: row.published,
    splitFromId: row.splitFromId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const WITH_RELATIONS = { conflict: true, actor: true, dataset: { select: { name: true, provider: true, license: true, attribution: true, datasetType: true, lastUpdated: true } } } as const;

/** Selects the territory of the given dataset ids. `conflict:<id>` selects a conflict's editorially drawn territory
 * (rows with no registry dataset), which the public availability list exposes as an implicit dataset. */
export function datasetWhere(ids: string[]) {
  const conflictIds = ids.filter((i) => i.startsWith("conflict:")).map((i) => i.slice("conflict:".length));
  const datasetIds = ids.filter((i) => !i.startsWith("conflict:"));
  return { OR: [...(datasetIds.length ? [{ datasetId: { in: datasetIds } }] : []), ...(conflictIds.length ? [{ datasetId: null, conflictId: { in: conflictIds } }] : []), ...(ids.length === 0 ? [{ id: "__none__" }] : [])] };
}

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
export async function listTerritoriesAt(timestamp: Date, opts: { datasetIds?: string[] } = {}): Promise<TerritoryDTO[]> {
  const rows = await prisma.conflictTerritory.findMany({
    where: {
      // AND, not spread: the time window below has its own OR, which would silently replace a dataset OR.
      ...(opts.datasetIds ? { AND: [datasetWhere(opts.datasetIds)] } : {}),
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

/** Thrown when geometry fails validation; `errors` has one clear message per problem. */
export class TerritoryValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(errors.join(" "));
    this.name = "TerritoryValidationError";
  }
}

export function assertValidGeometry(geometry: unknown): asserts geometry is TerritorialGeometry {
  const result = validateTerritorialGeometry(geometry);
  if (!result.valid) throw new TerritoryValidationError(result.errors);
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
  /** Draft only: the active version this draft partially changes (a split). */
  splitFromId?: string | null;
  /** What the source supports; defaults to "control". Presence / influence are never drawn as control. */
  territoryKind?: "control" | "influence" | "presence";
  datasetId?: string | null;
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
    splitFromId: input.splitFromId ?? null,
    territoryKind: input.territoryKind ?? "control",
    datasetId: input.datasetId ?? null,
  };
}

/** Creates a new DRAFT version (published: false) — freely editable/
 * deletable until published. */
export async function createTerritoryDraft(input: TerritoryInput): Promise<ConflictTerritory> {
  assertValidGeometry(input.geometry);
  if (input.splitFromId) await assertSplittableSource(input.splitFromId, input.conflictId);
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
  if (input.geometry !== undefined) assertValidGeometry(input.geometry);
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
  if (existing.published) return existing;
  // Never publish invalid geometry, whatever path created the draft.
  const geometry = parseTerritorialGeometry(existing.geometry);
  if (!geometry) throw new TerritoryValidationError(["Stored geometry is not a valid Polygon or MultiPolygon."]);
  assertValidGeometry(geometry);
  // A draft that is a partial change carves its area out of the active
  // version it was drawn against, instead of replacing the whole polygon.
  if (existing.splitFromId) {
    const { affected } = await splitTerritory(existing.splitFromId, geometry, {
      actorId: existing.actorId,
      status: existing.status as AssignableTerritorialStatus,
      confidence: existing.confidence,
      sourceName: existing.sourceName,
      sourceUrl: existing.sourceUrl,
      validFrom: existing.validFrom,
      draftId: existing.id,
    });
    return affected;
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
  assertValidGeometry(next.geometry);
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

// ---- split / partial control change -----------------------------------------

/** The version a split carves from must be published, still active and in the
 * same conflict — anything else would rewrite or double-close history. */
async function assertSplittableSource(sourceId: string, conflictId: string): Promise<ConflictTerritory> {
  const source = await prisma.conflictTerritory.findUnique({ where: { id: sourceId } });
  if (!source) throw new Error("Territory to split not found");
  if (!source.published) throw new Error("Cannot split a draft — only a published, active version");
  if (source.validTo !== null) throw new Error("This territory version has already been superseded");
  if (source.conflictId !== conflictId) throw new Error("The territory to split belongs to a different conflict");
  return source;
}

export interface SplitPreview {
  valid: boolean;
  errors: string[];
  /** Base geometry being split (the active version). */
  base: TerritorialGeometry | null;
  /** Part of the base the drawn area covers — will go to the new controller/status. */
  affected: TerritorialGeometry | null;
  /** Rest of the base — stays with the old controller/status, unchanged. */
  remainder: TerritorialGeometry | null;
  /** True when the drawn area reaches outside the base (that part is ignored, never added). */
  areaOutsideBase: boolean;
}

/** Pure preview of splitting `sourceId` by a drawn area. Reads only. */
export async function previewSplit(sourceId: string, area: unknown): Promise<SplitPreview> {
  const empty: SplitPreview = { valid: false, errors: [], base: null, affected: null, remainder: null, areaOutsideBase: false };
  const check = validateTerritorialGeometry(area);
  if (!check.valid) return { ...empty, errors: check.errors };
  const source = await prisma.conflictTerritory.findUnique({ where: { id: sourceId } });
  if (!source) return { ...empty, errors: ["Territory to split not found."] };
  const base = parseTerritorialGeometry(source.geometry);
  if (!base) return { ...empty, errors: ["The territory to split has unreadable geometry."] };
  const drawn = area as TerritorialGeometry;
  const { affected, remainder } = splitGeometry(base, drawn);
  if (!affected) return { ...empty, base, remainder, errors: ["The drawn area does not overlap the territory being changed."] };
  const outside = splitGeometry(drawn, base).remainder !== null;
  return { valid: true, errors: [], base, affected, remainder, areaOutsideBase: outside };
}

export interface SplitNext {
  actorId?: string | null;
  status: AssignableTerritorialStatus;
  confidence: number;
  sourceName?: string | null;
  sourceUrl?: string | null;
  validFrom: Date;
  /** An existing draft to publish as the affected area instead of creating a new row. */
  draftId?: string;
}

/**
 * Partial control change. In ONE transaction:
 *  - the active version is closed (validTo = validFrom of the change) — its
 *    geometry is never touched, so history before the change is intact;
 *  - a new published version holds the AFFECTED part (base ∩ drawn area) with
 *    the new actor/status/confidence/provenance;
 *  - a new published version holds the REMAINDER (base − drawn area) with the
 *    OLD actor/status/confidence/provenance, so unaffected ground keeps its
 *    controller and is exactly complementary (no gap, no overlap);
 *  - both new rows record `splitFromId` = the closed version.
 * If the drawn area covers the whole base there is no remainder row (it is a
 * whole-area supersede). The drawn area outside the base is ignored.
 */
export async function splitTerritory(
  sourceId: string,
  area: TerritorialGeometry,
  next: SplitNext,
): Promise<{ previous: ConflictTerritory; affected: ConflictTerritory; remainder: ConflictTerritory | null }> {
  assertValidGeometry(area);
  const source = await prisma.conflictTerritory.findUnique({ where: { id: sourceId } });
  if (!source) throw new Error("Territory to split not found");
  await assertSplittableSource(sourceId, source.conflictId);
  if (next.validFrom.getTime() < source.validFrom.getTime()) {
    throw new Error("A change's effective time cannot be before the version it changes");
  }
  const base = parseTerritorialGeometry(source.geometry);
  if (!base) throw new Error("The territory to split has unreadable geometry");
  const { affected, remainder } = splitGeometry(base, area);
  if (!affected) throw new Error("The drawn area does not overlap the territory being changed");

  const result = await prisma.$transaction(async (tx) => {
    const previous = await tx.conflictTerritory.update({ where: { id: source.id }, data: { validTo: next.validFrom } });
    const affectedData = {
      conflictId: source.conflictId,
      actorId: next.actorId ?? null,
      status: next.status,
      confidence: next.confidence,
      geometry: JSON.stringify(affected),
      sourceName: next.sourceName ?? null,
      sourceUrl: next.sourceUrl ?? null,
      validFrom: next.validFrom,
      validTo: null,
      published: true,
      splitFromId: remainder ? source.id : null,
    };
    const affectedRow = next.draftId
      ? await tx.conflictTerritory.update({ where: { id: next.draftId }, data: affectedData })
      : await tx.conflictTerritory.create({ data: affectedData });
    const remainderRow = remainder
      ? await tx.conflictTerritory.create({
          data: {
            conflictId: source.conflictId,
            actorId: source.actorId,
            status: source.status,
            confidence: source.confidence,
            geometry: JSON.stringify(remainder),
            sourceName: source.sourceName,
            sourceUrl: source.sourceUrl,
            validFrom: next.validFrom,
            validTo: null,
            published: true,
            splitFromId: source.id,
          },
        })
      : null;
    return { previous, affected: affectedRow, remainder: remainderRow };
  });
  return result;
}
