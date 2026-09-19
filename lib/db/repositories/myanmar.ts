import { prisma } from "@/lib/db/client";
import type {
  AreaOfOperationDTO,
  TerritorialChangeCandidateDTO,
  LocationPrecision,
  TerritorialChangeCandidateStatus,
} from "@/lib/types/db";

// Myanmar Specialist Source Integration — repository layer for Areas of
// Operation and territorial-change candidates. Deliberately separate
// functions/tables from lib/db/repositories/territorial-control.ts (which
// owns ConflictTerritory) — see prisma/schema.prisma's AreaOfOperation and
// TerritorialChangeCandidate model comments for why these must never share
// code paths with real territorial-control mutation.

function toPrecision(value: string): LocationPrecision {
  return value === "exact" || value === "approximate" || value === "area_level" ? value : "unknown";
}

export interface AreaOfOperationInput {
  unitId: string;
  conflictId?: string | null;
  name?: string | null;
  description?: string | null;
  geometry: string;
  precision?: LocationPrecision;
  asOfDate?: Date | null;
  sourceName?: string | null;
  sourceUrl?: string | null;
}

function toAooDTO(row: {
  id: string;
  unitId: string;
  unit?: { name: string };
  conflictId: string | null;
  name: string | null;
  description: string | null;
  geometry: string;
  precision: string;
  asOfDate: Date | null;
  sourceName: string | null;
  sourceUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}): AreaOfOperationDTO {
  return {
    id: row.id,
    unitId: row.unitId,
    unitName: row.unit?.name,
    conflictId: row.conflictId,
    name: row.name,
    description: row.description,
    geometry: row.geometry,
    precision: toPrecision(row.precision),
    asOfDate: row.asOfDate ? row.asOfDate.toISOString() : null,
    sourceName: row.sourceName,
    sourceUrl: row.sourceUrl,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listAreasOfOperation(filter?: { unitId?: string; conflictId?: string }): Promise<AreaOfOperationDTO[]> {
  const rows = await prisma.areaOfOperation.findMany({
    where: { unitId: filter?.unitId, conflictId: filter?.conflictId },
    include: { unit: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toAooDTO);
}

export async function createAreaOfOperation(input: AreaOfOperationInput): Promise<AreaOfOperationDTO> {
  const row = await prisma.areaOfOperation.create({
    data: {
      unitId: input.unitId,
      conflictId: input.conflictId ?? null,
      name: input.name ?? null,
      description: input.description ?? null,
      geometry: input.geometry,
      precision: input.precision ?? "unknown",
      asOfDate: input.asOfDate ?? null,
      sourceName: input.sourceName ?? null,
      sourceUrl: input.sourceUrl ?? null,
    },
    include: { unit: { select: { name: true } } },
  });
  return toAooDTO(row);
}

export interface TerritorialChangeCandidateInput {
  conflictId: string;
  description: string;
  claimedActorId?: string | null;
  previousActorId?: string | null;
  locationName?: string | null;
  lat?: number | null;
  lng?: number | null;
  precision?: LocationPrecision;
  sourceName?: string | null;
  sourceUrl?: string | null;
  observedAt?: Date | null;
}

function toCandidateDTO(row: {
  id: string;
  conflictId: string;
  conflict?: { name: string };
  description: string;
  claimedActorId: string | null;
  claimedActor?: { name: string } | null;
  previousActorId: string | null;
  previousActor?: { name: string } | null;
  locationName: string | null;
  lat: number | null;
  lng: number | null;
  precision: string;
  sourceName: string | null;
  sourceUrl: string | null;
  observedAt: Date | null;
  status: string;
  reviewNote: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
}): TerritorialChangeCandidateDTO {
  return {
    id: row.id,
    conflictId: row.conflictId,
    conflictName: row.conflict?.name,
    description: row.description,
    claimedActorId: row.claimedActorId,
    claimedActorName: row.claimedActor?.name ?? null,
    previousActorId: row.previousActorId,
    previousActorName: row.previousActor?.name ?? null,
    locationName: row.locationName,
    lat: row.lat,
    lng: row.lng,
    precision: toPrecision(row.precision),
    sourceName: row.sourceName,
    sourceUrl: row.sourceUrl,
    observedAt: row.observedAt ? row.observedAt.toISOString() : null,
    status: (row.status === "reviewed" || row.status === "dismissed" ? row.status : "pending") as TerritorialChangeCandidateStatus,
    reviewNote: row.reviewNote,
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

const CANDIDATE_INCLUDE = {
  conflict: { select: { name: true } },
  claimedActor: { select: { name: true } },
  previousActor: { select: { name: true } },
} as const;

export async function listTerritorialChangeCandidates(filter?: {
  conflictId?: string;
  status?: TerritorialChangeCandidateStatus;
}): Promise<TerritorialChangeCandidateDTO[]> {
  const rows = await prisma.territorialChangeCandidate.findMany({
    where: { conflictId: filter?.conflictId, status: filter?.status },
    include: CANDIDATE_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toCandidateDTO);
}

/** Always creates a new "pending" row — a candidate is never upserted onto
 * an existing one, since each is a distinct reported claim (spec "flag it
 * as a potential... candidate", plural claims about the same place over
 * time are each their own reviewable row, same as EventUpdateProposal
 * never overwriting a prior proposal). */
export async function createTerritorialChangeCandidate(
  input: TerritorialChangeCandidateInput,
): Promise<TerritorialChangeCandidateDTO> {
  const row = await prisma.territorialChangeCandidate.create({
    data: {
      conflictId: input.conflictId,
      description: input.description,
      claimedActorId: input.claimedActorId ?? null,
      previousActorId: input.previousActorId ?? null,
      locationName: input.locationName ?? null,
      lat: input.lat ?? null,
      lng: input.lng ?? null,
      precision: input.precision ?? "unknown",
      sourceName: input.sourceName ?? null,
      sourceUrl: input.sourceUrl ?? null,
      observedAt: input.observedAt ?? null,
    },
    include: CANDIDATE_INCLUDE,
  });
  return toCandidateDTO(row);
}

/**
 * Marks a candidate reviewed or dismissed — an explicit admin action,
 * purely a status/note update on THIS row. Never touches ConflictTerritory
 * (spec "do NOT automatically modify published control polygons") — an
 * admin who agrees with a candidate creates/supersedes a territory
 * separately, the normal way.
 */
export async function reviewTerritorialChangeCandidate(
  id: string,
  status: "reviewed" | "dismissed",
  reviewNote?: string | null,
): Promise<TerritorialChangeCandidateDTO> {
  const row = await prisma.territorialChangeCandidate.update({
    where: { id },
    data: { status, reviewNote: reviewNote ?? null, reviewedAt: new Date() },
    include: CANDIDATE_INCLUDE,
  });
  return toCandidateDTO(row);
}
