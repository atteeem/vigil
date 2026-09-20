import { prisma } from "@/lib/db/client";
import { ACTOR_REGISTRY, resolveActorName } from "@/lib/actors/registry";
import { ensureCanonicalAlias, resolveEntity } from "@/lib/military/aliases";
import { entityTypeFromDesignation, entityTypeFromRegistryKind, isEntityType } from "@/lib/military/entity-types";
import { appointCommander, setUnitParent } from "@/lib/military/knowledge";
import type {
  MilitaryUnitDTO,
  MilitaryEquipmentDTO,
  CommanderDTO,
  CommanderAppointmentDTO,
  MilitaryUnitEquipmentLinkDTO,
  MilitaryUnitEventLinkDTO,
} from "@/lib/types/db";

// MilitaryLand Phase 1 — see prisma/schema.prisma's own comment block on
// these models for the full rationale (reference/provenance layer, not
// live tactical tracking).

export interface ProvenanceInput {
  sourceName?: string | null;
  sourceUrl?: string | null;
}

function toUnitDTO(row: {
  id: string;
  name: string;
  branch: string | null;
  unitType: string | null;
  parentUnitId: string | null;
  parentUnit?: { name: string } | null;
  status: string | null;
  entityType?: string | null;
  country?: string | null;
  nativeName?: string | null;
  primaryConflictId: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  lastUpdatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}): MilitaryUnitDTO {
  return {
    id: row.id,
    name: row.name,
    branch: row.branch,
    unitType: row.unitType,
    parentUnitId: row.parentUnitId,
    parentUnitName: row.parentUnit?.name ?? null,
    status: row.status,
    entityType: row.entityType ?? null,
    country: row.country ?? null,
    nativeName: row.nativeName ?? null,
    primaryConflictId: row.primaryConflictId,
    sourceName: row.sourceName,
    sourceUrl: row.sourceUrl,
    lastUpdatedAt: row.lastUpdatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listMilitaryUnits(): Promise<MilitaryUnitDTO[]> {
  const rows = await prisma.militaryUnit.findMany({
    include: { parentUnit: { select: { name: true } } },
    orderBy: { name: "asc" },
  });
  return rows.map(toUnitDTO);
}

export async function getMilitaryUnit(id: string): Promise<MilitaryUnitDTO | null> {
  const row = await prisma.militaryUnit.findUnique({
    where: { id },
    include: { parentUnit: { select: { name: true } } },
  });
  return row ? toUnitDTO(row) : null;
}

export interface MilitaryUnitInput extends ProvenanceInput {
  name: string;
  branch?: string | null;
  unitType?: string | null;
  parentUnitId?: string | null;
  status?: string | null;
  primaryConflictId?: string | null;
  entityType?: string | null;
  country?: string | null;
  nativeName?: string | null;
}

/**
 * Finds an existing unit by exact name (case-insensitive) or creates one —
 * the dedup contract "do not duplicate entities when later articles
 * mention them again" (spec). Matching on name is deliberately simple
 * (Phase 1): MilitaryLand's own unit designations are already
 * near-canonical ("25th Airborne Brigade"), and a fuzzier alias-based
 * matcher is future work, not attempted here. An existing unit's
 * provenance/lastUpdatedAt is refreshed only when the caller supplies a
 * new source (later articles corroborate/update, they don't blank out
 * an already-known unit's fields with nulls).
 */
export async function findOrCreateMilitaryUnit(input: MilitaryUnitInput): Promise<MilitaryUnitDTO> {
  // Spelling variants of a registered actor ("the junta", "SAC", "IDF" ...)
  // resolve to ONE canonical row (lib/actors/registry.ts); a legacy row already
  // stored under the variant name is reused rather than duplicated.
  const canonicalName = resolveActorName(input.name);
  // A name that is a known alias (native name, abbreviation, historical name...) of exactly ONE
  // existing entity reuses it. Ambiguous or unknown names never merge anything.
  const byAlias = await resolveEntity("unit", input.name, { country: input.country });
  const aliasHit = byAlias.status === "resolved" ? await prisma.militaryUnit.findUnique({ where: { id: byAlias.id }, include: { parentUnit: { select: { name: true } } } }) : null;
  const existing =
    aliasHit ??
    (await prisma.militaryUnit.findFirst({ where: { name: { equals: canonicalName } }, include: { parentUnit: { select: { name: true } } } })) ??
    (canonicalName !== input.name
      ? await prisma.militaryUnit.findFirst({ where: { name: { equals: input.name } }, include: { parentUnit: { select: { name: true } } } })
      : null);
  input = { ...input, name: existing?.name ?? canonicalName };
  if (existing) {
    if (!input.sourceUrl) {
      await ensureCanonicalAlias("unit", existing.id, existing.name);
      return toUnitDTO(existing);
    }
    const updated = await prisma.militaryUnit.update({
      where: { id: existing.id },
      data: {
        branch: input.branch ?? existing.branch,
        unitType: input.unitType ?? existing.unitType,
        status: input.status ?? existing.status,
        entityType: input.entityType && isEntityType(input.entityType) ? input.entityType : existing.entityType,
        country: input.country ?? existing.country,
        nativeName: input.nativeName ?? existing.nativeName,
        primaryConflictId: input.primaryConflictId ?? existing.primaryConflictId,
        sourceName: input.sourceName ?? existing.sourceName,
        sourceUrl: input.sourceUrl,
        lastUpdatedAt: new Date(),
      },
      include: { parentUnit: { select: { name: true } } },
    });
    if (input.parentUnitId && input.parentUnitId !== existing.parentUnitId) await setUnitParent(existing.id, input.parentUnitId, { sourceName: input.sourceName, sourceUrl: input.sourceUrl });
    await ensureCanonicalAlias("unit", existing.id, existing.name);
    return toUnitDTO({ ...updated, parentUnitId: input.parentUnitId ?? updated.parentUnitId });
  }
  const created = await prisma.militaryUnit.create({
    data: {
      name: input.name,
      branch: input.branch ?? null,
      unitType: input.unitType ?? null,
      parentUnitId: input.parentUnitId ?? null,
      status: input.status ?? null,
      // Structural type only where the name form makes it unambiguous; otherwise left unknown.
      entityType: input.entityType && isEntityType(input.entityType) ? input.entityType : (entityTypeFromDesignation(input.name) ?? (ACTOR_REGISTRY.find((a) => a.canonical === input.name) ? entityTypeFromRegistryKind(ACTOR_REGISTRY.find((a) => a.canonical === input.name)!.kind) : null)),
      country: input.country ?? ACTOR_REGISTRY.find((a) => a.canonical === input.name)?.country ?? null,
      nativeName: input.nativeName ?? null,
      primaryConflictId: input.primaryConflictId ?? null,
      sourceName: input.sourceName ?? null,
      sourceUrl: input.sourceUrl ?? null,
    },
    include: { parentUnit: { select: { name: true } } },
  });
  await ensureCanonicalAlias("unit", created.id, created.name);
  if (created.parentUnitId) await prisma.unitParentHistory.create({ data: { unitId: created.id, parentUnitId: created.parentUnitId, sourceName: input.sourceName ?? null, sourceUrl: input.sourceUrl ?? null, observedAt: new Date() } });
  return toUnitDTO(created);
}

export async function updateMilitaryUnit(id: string, input: Partial<MilitaryUnitInput>): Promise<MilitaryUnitDTO> {
  const { parentUnitId, ...rest } = input;
  if (parentUnitId !== undefined) await setUnitParent(id, parentUnitId ?? null, { sourceName: input.sourceName, sourceUrl: input.sourceUrl });
  const row = await prisma.militaryUnit.update({
    where: { id },
    data: { ...rest, lastUpdatedAt: new Date() },
    include: { parentUnit: { select: { name: true } } },
  });
  return toUnitDTO(row);
}

export async function deleteMilitaryUnit(id: string): Promise<void> {
  await prisma.militaryUnit.delete({ where: { id } });
}

function toEquipmentDTO(row: {
  id: string;
  name: string;
  category: string | null;
  countryOfOrigin: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  lastUpdatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}): MilitaryEquipmentDTO {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    countryOfOrigin: row.countryOfOrigin,
    sourceName: row.sourceName,
    sourceUrl: row.sourceUrl,
    lastUpdatedAt: row.lastUpdatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listMilitaryEquipment(): Promise<MilitaryEquipmentDTO[]> {
  const rows = await prisma.militaryEquipment.findMany({ orderBy: { name: "asc" } });
  return rows.map(toEquipmentDTO);
}

export interface MilitaryEquipmentInput extends ProvenanceInput {
  name: string;
  category?: string | null;
  countryOfOrigin?: string | null;
}

export async function findOrCreateMilitaryEquipment(input: MilitaryEquipmentInput): Promise<MilitaryEquipmentDTO> {
  const byAlias = await resolveEntity("equipment", input.name);
  const existing = (byAlias.status === "resolved" ? await prisma.militaryEquipment.findUnique({ where: { id: byAlias.id } }) : null) ?? (await prisma.militaryEquipment.findFirst({ where: { name: { equals: input.name } } }));
  if (existing) {
    if (!input.sourceUrl) return toEquipmentDTO(existing);
    const updated = await prisma.militaryEquipment.update({
      where: { id: existing.id },
      data: {
        category: input.category ?? existing.category,
        countryOfOrigin: input.countryOfOrigin ?? existing.countryOfOrigin,
        sourceName: input.sourceName ?? existing.sourceName,
        sourceUrl: input.sourceUrl,
        lastUpdatedAt: new Date(),
      },
    });
    return toEquipmentDTO(updated);
  }
  const created = await prisma.militaryEquipment.create({
    data: {
      name: input.name,
      category: input.category ?? null,
      countryOfOrigin: input.countryOfOrigin ?? null,
      sourceName: input.sourceName ?? null,
      sourceUrl: input.sourceUrl ?? null,
    },
  });
  await ensureCanonicalAlias("equipment", created.id, created.name);
  return toEquipmentDTO(created);
}

export async function updateMilitaryEquipment(
  id: string,
  input: Partial<MilitaryEquipmentInput>,
): Promise<MilitaryEquipmentDTO> {
  const row = await prisma.militaryEquipment.update({ where: { id }, data: { ...input, lastUpdatedAt: new Date() } });
  return toEquipmentDTO(row);
}

export async function deleteMilitaryEquipment(id: string): Promise<void> {
  await prisma.militaryEquipment.delete({ where: { id } });
}

/** unit -> equipment (spec) — idempotent: linking the same pair twice is a
 * no-op refresh (createdAt/provenance kept from the first link), not a
 * duplicate row, per the unique([unitId, equipmentId]) constraint. */
export async function linkUnitEquipment(
  unitId: string,
  equipmentId: string,
  provenance: ProvenanceInput & { confidence?: number | null; observedAt?: Date | null },
): Promise<MilitaryUnitEquipmentLinkDTO> {
  const observedAt = provenance.observedAt ?? new Date();
  const row = await prisma.militaryUnitEquipment.upsert({
    where: { unitId_equipmentId: { unitId, equipmentId } },
    // Re-sourcing refreshes "last sourced" (and fills missing provenance); it never blanks what is known.
    update: { observedAt, sourceName: provenance.sourceName ?? undefined, sourceUrl: provenance.sourceUrl ?? undefined, confidence: provenance.confidence ?? undefined },
    create: { unitId, equipmentId, sourceName: provenance.sourceName ?? null, sourceUrl: provenance.sourceUrl ?? null, observedAt, confidence: provenance.confidence ?? null },
  });
  return {
    id: row.id,
    unitId: row.unitId,
    equipmentId: row.equipmentId,
    sourceName: row.sourceName,
    sourceUrl: row.sourceUrl,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listUnitEquipmentLinks(unitId: string): Promise<MilitaryUnitEquipmentLinkDTO[]> {
  const rows = await prisma.militaryUnitEquipment.findMany({
    where: { unitId },
    include: { equipment: { select: { name: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    unitId: r.unitId,
    equipmentId: r.equipmentId,
    equipmentName: r.equipment.name,
    sourceName: r.sourceName,
    sourceUrl: r.sourceUrl,
    createdAt: r.createdAt.toISOString(),
  }));
}

function toCommanderDTO(row: {
  id: string;
  name: string;
  rank: string | null;
  currentUnitId: string | null;
  currentUnit?: { name: string } | null;
  sourceName: string | null;
  sourceUrl: string | null;
  lastUpdatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}): CommanderDTO {
  return {
    id: row.id,
    name: row.name,
    rank: row.rank,
    currentUnitId: row.currentUnitId,
    currentUnitName: row.currentUnit?.name ?? null,
    sourceName: row.sourceName,
    sourceUrl: row.sourceUrl,
    lastUpdatedAt: row.lastUpdatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listCommanders(): Promise<CommanderDTO[]> {
  const rows = await prisma.commander.findMany({
    include: { currentUnit: { select: { name: true } } },
    orderBy: { name: "asc" },
  });
  return rows.map(toCommanderDTO);
}

export interface CommanderInput extends ProvenanceInput {
  name: string;
  rank?: string | null;
  currentUnitId?: string | null;
}

/**
 * Finds-or-creates a commander by name, and — when a currentUnitId is
 * supplied and differs from what's on file — appends a new
 * CommanderAppointment row (spec "appointment/history where sourced")
 * rather than silently overwriting the prior assignment, so an
 * appointment history is reconstructable even though currentUnitId itself
 * is a denormalized "latest" pointer.
 */
export async function findOrCreateCommander(input: CommanderInput): Promise<CommanderDTO> {
  const byAlias = await resolveEntity("commander", input.name);
  const existing =
    (byAlias.status === "resolved" ? await prisma.commander.findUnique({ where: { id: byAlias.id }, include: { currentUnit: { select: { name: true } } } }) : null) ??
    (await prisma.commander.findFirst({ where: { name: { equals: input.name } }, include: { currentUnit: { select: { name: true } } } }));
  if (existing) {
    const unitChanged = input.currentUnitId && input.currentUnitId !== existing.currentUnitId;
    // Appointment history is kept: the previous appointment is closed, a new one opened (knowledge.ts).
    if (unitChanged) await appointCommander(existing.id, input.currentUnitId!, { sourceName: input.sourceName, sourceUrl: input.sourceUrl });
    if (!input.sourceUrl && !unitChanged) return toCommanderDTO(existing);
    const updated = await prisma.commander.update({
      where: { id: existing.id },
      data: {
        rank: input.rank ?? existing.rank,
        currentUnitId: input.currentUnitId ?? existing.currentUnitId,
        sourceName: input.sourceName ?? existing.sourceName,
        sourceUrl: input.sourceUrl ?? existing.sourceUrl,
        lastUpdatedAt: new Date(),
      },
      include: { currentUnit: { select: { name: true } } },
    });
    return toCommanderDTO(updated);
  }
  const created = await prisma.commander.create({
    data: {
      name: input.name,
      rank: input.rank ?? null,
      currentUnitId: input.currentUnitId ?? null,
      sourceName: input.sourceName ?? null,
      sourceUrl: input.sourceUrl ?? null,
    },
    include: { currentUnit: { select: { name: true } } },
  });
  await ensureCanonicalAlias("commander", created.id, created.name);
  if (input.currentUnitId) await appointCommander(created.id, input.currentUnitId, { sourceName: input.sourceName, sourceUrl: input.sourceUrl });
  return toCommanderDTO(created);
}

export async function updateCommander(id: string, input: Partial<CommanderInput>): Promise<CommanderDTO> {
  const { currentUnitId, ...rest } = input;
  // A change of unit is an appointment (history kept), not an overwrite.
  if (currentUnitId) await appointCommander(id, currentUnitId, { sourceName: input.sourceName, sourceUrl: input.sourceUrl });
  const row = await prisma.commander.update({
    where: { id },
    data: { ...rest, ...(currentUnitId === null ? { currentUnitId: null } : {}), lastUpdatedAt: new Date() },
    include: { currentUnit: { select: { name: true } } },
  });
  return toCommanderDTO(row);
}

export async function deleteCommander(id: string): Promise<void> {
  await prisma.commander.delete({ where: { id } });
}

export async function listCommanderAppointments(commanderId: string): Promise<CommanderAppointmentDTO[]> {
  const rows = await prisma.commanderAppointment.findMany({
    where: { commanderId },
    include: { unit: { select: { name: true } } },
    orderBy: { startDate: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    commanderId: r.commanderId,
    unitId: r.unitId,
    unitName: r.unit.name,
    role: r.role,
    startDate: r.startDate ? r.startDate.toISOString() : null,
    endDate: r.endDate ? r.endDate.toISOString() : null,
    sourceName: r.sourceName,
    sourceUrl: r.sourceUrl,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** article/report -> referenced unit/equipment/commander (spec) —
 * idempotent upserts, one per entity kind, mirroring the unique
 * constraints in prisma/schema.prisma. */
export interface LinkMeta {
  matchedText?: string | null;
  method?: string | null;
  confidence?: number | null;
}

export async function linkArticleToUnit(rawIngestionItemId: string, unitId: string, meta: LinkMeta = {}): Promise<void> {
  await prisma.articleMilitaryUnitLink.upsert({
    where: { rawIngestionItemId_unitId: { rawIngestionItemId, unitId } },
    update: {},
    create: { rawIngestionItemId, unitId, matchedText: meta.matchedText ?? null, method: meta.method ?? null, confidence: meta.confidence ?? null },
  });
}

export async function linkArticleToEquipment(rawIngestionItemId: string, equipmentId: string, meta: LinkMeta = {}): Promise<void> {
  await prisma.articleMilitaryEquipmentLink.upsert({
    where: { rawIngestionItemId_equipmentId: { rawIngestionItemId, equipmentId } },
    update: {},
    create: { rawIngestionItemId, equipmentId, matchedText: meta.matchedText ?? null, method: meta.method ?? null, confidence: meta.confidence ?? null },
  });
}

export async function linkArticleToCommander(rawIngestionItemId: string, commanderId: string, meta: LinkMeta = {}): Promise<void> {
  await prisma.articleMilitaryCommanderLink.upsert({
    where: { rawIngestionItemId_commanderId: { rawIngestionItemId, commanderId } },
    update: {},
    create: { rawIngestionItemId, commanderId, matchedText: meta.matchedText ?? null, method: meta.method ?? null, confidence: meta.confidence ?? null },
  });
}

export interface ArticleMilitaryLinksDTO {
  units: { id: string; name: string }[];
  equipment: { id: string; name: string }[];
  commanders: { id: string; name: string }[];
}

export async function getArticleMilitaryLinks(rawIngestionItemId: string): Promise<ArticleMilitaryLinksDTO> {
  const [units, equipment, commanders] = await Promise.all([
    prisma.articleMilitaryUnitLink.findMany({ where: { rawIngestionItemId }, include: { unit: { select: { id: true, name: true } } } }),
    prisma.articleMilitaryEquipmentLink.findMany({ where: { rawIngestionItemId }, include: { equipment: { select: { id: true, name: true } } } }),
    prisma.articleMilitaryCommanderLink.findMany({ where: { rawIngestionItemId }, include: { commander: { select: { id: true, name: true } } } }),
  ]);
  return {
    units: units.map((u) => u.unit),
    equipment: equipment.map((e) => e.equipment),
    commanders: commanders.map((c) => c.commander),
  };
}

// Myanmar Specialist Source Integration (spec §4 "actor -> events") —
// unit -> event linking, a DIRECT relationship (unlike article -> unit
// links above, which stay on the RawIngestionItem forever regardless of
// publish state).

export async function linkUnitToEvent(unitId: string, eventId: string, provenance: ProvenanceInput): Promise<void> {
  await prisma.militaryUnitEvent.upsert({
    where: { unitId_eventId: { unitId, eventId } },
    update: {},
    create: { unitId, eventId, sourceName: provenance.sourceName ?? null, sourceUrl: provenance.sourceUrl ?? null },
  });
}

export async function listUnitEventLinks(unitId: string): Promise<MilitaryUnitEventLinkDTO[]> {
  const rows = await prisma.militaryUnitEvent.findMany({
    where: { unitId },
    include: { event: { select: { title: true } } },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    unitId: r.unitId,
    eventId: r.eventId,
    eventTitle: r.event.title,
    sourceName: r.sourceName,
    sourceUrl: r.sourceUrl,
    createdAt: r.createdAt.toISOString(),
  }));
}

/**
 * Spec "actor -> events" — when a RawIngestionItem that already has
 * ArticleMilitaryUnitLink rows (units mentioned in the article text) is
 * published or merged into an Event, this transfers those same unit
 * associations onto the resulting Event, so "which events involve this
 * unit" is answerable without a RawIngestionItem-level join. Called from
 * the publish/merge routes; never invents a new unit — only propagates
 * units the entity extractor already found and linked to this article.
 */
export async function propagateUnitLinksToEvent(rawIngestionItemId: string, eventId: string): Promise<void> {
  const links = await prisma.articleMilitaryUnitLink.findMany({ where: { rawIngestionItemId } });
  for (const link of links) {
    await linkUnitToEvent(link.unitId, eventId, {});
  }
}
