import { prisma } from "@/lib/db/client";
import type { ConflictTerritory } from "@prisma/client";
import {
  CANDIDATE_INCLUDE,
  createTerritorialChangeCandidate,
  parseCorroboration,
  toCandidateDTO,
  type CandidateRow,
  type TerritorialChangeCandidateInput,
} from "@/lib/db/repositories/myanmar";
import { createActor, createTerritoryDraft, publishTerritory, supersedeTerritory } from "@/lib/db/repositories/territorial-control";
import { isValidTerritorialGeometry, parseTerritorialGeometry } from "@/lib/data/territorial-control";
import { claimKeyFor, normalizeLocationKey } from "@/lib/territory/change-detection";
import { isChangeType, proposedStatusFor, type TerritorialChangeType } from "@/lib/territory/change-types";
import { hasComparablePoint, toLocationPrecision } from "@/lib/territory/location-precision";
import {
  OPEN_CANDIDATE_STATUSES,
  type LocationPrecision,
  type TerritorialChangeCandidateDTO,
  type TerritorialChangeComparisonDTO,
} from "@/lib/types/db";
import type { TerritorialGeometry } from "@/lib/types/territorial-control";

// Territorial Change Intelligence. A candidate is a review-queue row; the
// ONLY code path here that touches ConflictTerritory is an explicit admin
// approve/attachGeometry, and it always goes through the existing
// supersede / draft+publish workflow — history is never overwritten and
// geometry is never fabricated.

// ---- geometry ---------------------------------------------------------------

function inRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi! > lat !== yj! > lat && lng < ((xj! - xi!) * (lat - yi!)) / (yj! - yi!) + xi!) inside = !inside;
  }
  return inside;
}

function inPolygon(lng: number, lat: number, rings: number[][][]): boolean {
  const [outer, ...holes] = rings;
  if (!outer || !inRing(lng, lat, outer)) return false;
  return !holes.some((h) => inRing(lng, lat, h));
}

export function pointInGeometry(lng: number, lat: number, geometry: TerritorialGeometry): boolean {
  if (geometry.type === "Polygon") return inPolygon(lng, lat, geometry.coordinates);
  return geometry.coordinates.some((poly) => inPolygon(lng, lat, poly));
}

// ---- current territorial state ---------------------------------------------

interface ActiveTerritory {
  row: ConflictTerritory;
  actorName: string | null;
  geometry: TerritorialGeometry;
}

/** Published, currently-active (validTo null or in the future) territory rows
 * for a set of conflicts — RAW assigned status, not the derived
 * "recently_changed" display status. */
async function activeTerritories(conflictIds: string[], at: Date): Promise<ActiveTerritory[]> {
  if (conflictIds.length === 0) return [];
  const rows = await prisma.conflictTerritory.findMany({
    where: {
      conflictId: { in: conflictIds },
      published: true,
      validFrom: { lte: at },
      OR: [{ validTo: null }, { validTo: { gt: at } }],
    },
    include: { actor: true },
  });
  const out: ActiveTerritory[] = [];
  for (const row of rows) {
    const geometry = parseTerritorialGeometry(row.geometry);
    if (geometry) out.push({ row, actorName: row.actor?.name ?? null, geometry });
  }
  return out;
}

// ---- comparison -------------------------------------------------------------

interface ComparableCandidate {
  id: string;
  conflictId: string;
  changeType: string;
  locationName: string | null;
  lat: number | null;
  lng: number | null;
  precision: LocationPrecision;
  claimedActorName: string | null;
  previousActorName: string | null;
}

const norm = (s: string | null | undefined) => normalizeLocationKey(s);

function proposalFor(c: ComparableCandidate, currentActorName: string | null) {
  const type = (isChangeType(c.changeType) ? c.changeType : "captured") as TerritorialChangeType;
  let actor: string | null;
  if (type === "contested") actor = currentActorName;
  else if (type === "control_uncertain") actor = null;
  else actor = c.claimedActorName;
  return { actor, status: proposedStatusFor(type, actor !== null) };
}

const GAIN_LIKE = new Set(["captured", "recaptured", "transferred", "control_restored"]);

/** Compares one candidate with the current published state and with the
 * other OPEN candidates. Pure over its inputs so list/propose/approve share it. */
export function compareCandidate(
  c: ComparableCandidate,
  territories: ActiveTerritory[],
  openOthers: ComparableCandidate[],
): TerritorialChangeComparisonDTO {
  const conflicting = openOthers.filter(
    (o) =>
      o.id !== c.id &&
      o.conflictId === c.conflictId &&
      norm(o.locationName) === norm(c.locationName) &&
      GAIN_LIKE.has(o.changeType) &&
      GAIN_LIKE.has(c.changeType) &&
      o.claimedActorName &&
      c.claimedActorName &&
      norm(o.claimedActorName) !== norm(c.claimedActorName),
  );
  const conflictingCandidateIds = conflicting.map((o) => o.id);

  const containing = hasComparablePoint(c.precision, c.lat, c.lng)
    ? territories.filter((t) => t.row.conflictId === c.conflictId && pointInGeometry(c.lng!, c.lat!, t.geometry))
    : [];
  const current = containing.length === 1 ? containing[0]! : null;
  const proposal = proposalFor(c, current?.actorName ?? null);

  const base = {
    currentTerritoryId: current?.row.id ?? null,
    currentActorName: current?.actorName ?? null,
    currentStatus: current?.row.status ?? null,
    proposedActorName: proposal.actor,
    proposedStatus: proposal.status,
    conflictingCandidateIds,
  };

  if (conflicting.length > 0) {
    return { ...base, outcome: "conflicting_claim", reason: "Another open candidate names a different controller for the same place — both stay pending until reviewed.", canReuseGeometry: false };
  }
  if (GAIN_LIKE.has(c.changeType) && !c.claimedActorName) {
    return { ...base, outcome: "insufficient_evidence", reason: "The report does not name who gained control.", canReuseGeometry: false };
  }
  if (containing.length > 1) {
    return { ...base, outcome: "insufficient_evidence", reason: "The location falls inside overlapping published territories — current state is ambiguous.", canReuseGeometry: false };
  }
  if (!current) {
    return {
      ...base,
      outcome: "insufficient_evidence",
      reason: hasComparablePoint(c.precision, c.lat, c.lng)
        ? "No published territory covers this point, so there is no current state to compare against."
        : `Location precision is ${c.precision.replace("_", "-")} with no comparable point — it cannot be matched to a mapped territory.`,
      canReuseGeometry: false,
    };
  }

  if (c.previousActorName && current.actorName && current.row.status === "controlled" && norm(c.previousActorName) !== norm(current.actorName)) {
    return { ...base, outcome: "conflicting_claim", reason: `The map shows ${current.actorName} in control, but the report says ${c.previousActorName} held it.`, canReuseGeometry: false };
  }
  if (current.row.status === proposal.status && norm(current.actorName) === norm(proposal.actor)) {
    return { ...base, outcome: "already_known", reason: "The current published state already matches this claim.", canReuseGeometry: false };
  }
  return { ...base, outcome: "genuine_change", reason: "The claim differs from the current published state.", canReuseGeometry: true };
}

function toComparable(dto: TerritorialChangeCandidateDTO): ComparableCandidate {
  return {
    id: dto.id,
    conflictId: dto.conflictId,
    changeType: dto.changeType,
    locationName: dto.locationName,
    lat: dto.lat,
    lng: dto.lng,
    precision: dto.precision,
    claimedActorName: dto.claimedActorName ?? null,
    previousActorName: dto.previousActorName ?? null,
  };
}

// ---- reading (with report/event/comparison) --------------------------------

async function enrich(rows: CandidateRow[]): Promise<TerritorialChangeCandidateDTO[]> {
  const dtos = rows.map(toCandidateDTO);
  const conflictIds = [...new Set(dtos.map((d) => d.conflictId))];
  const territories = await activeTerritories(conflictIds, new Date());
  const open = dtos.filter((d) => (OPEN_CANDIDATE_STATUSES as readonly string[]).includes(d.status)).map(toComparable);

  const itemIds = dtos.map((d) => d.rawIngestionItemId).filter((x): x is string => !!x);
  const items = itemIds.length
    ? await prisma.rawIngestionItem.findMany({
        where: { id: { in: itemIds } },
        select: { id: true, originalTitle: true, originalUrl: true, publishedAt: true },
      })
    : [];
  const eventLinks = itemIds.length
    ? await prisma.eventSource.findMany({
        where: { rawIngestionItemId: { in: itemIds } },
        select: { rawIngestionItemId: true, event: { select: { id: true, slug: true, title: true } } },
      })
    : [];

  return dtos.map((d) => {
    const item = items.find((i) => i.id === d.rawIngestionItemId);
    const link = eventLinks.find((l) => l.rawIngestionItemId === d.rawIngestionItemId);
    return {
      ...d,
      comparison: compareCandidate(toComparable(d), territories, open),
      report: item ? { title: item.originalTitle, url: item.originalUrl, publishedAt: item.publishedAt ? item.publishedAt.toISOString() : null } : null,
      event: link?.event ?? null,
    };
  });
}

export async function listReviewCandidates(filter?: { conflictId?: string; status?: string }): Promise<TerritorialChangeCandidateDTO[]> {
  const rows = await prisma.territorialChangeCandidate.findMany({
    where: { conflictId: filter?.conflictId, status: filter?.status },
    include: CANDIDATE_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
  return enrich(rows);
}

export async function getReviewCandidate(id: string): Promise<TerritorialChangeCandidateDTO | null> {
  const row = await prisma.territorialChangeCandidate.findUnique({ where: { id }, include: CANDIDATE_INCLUDE });
  if (!row) return null;
  return (await enrich([row]))[0]!;
}

// ---- proposing (called from ingestion) -------------------------------------

export interface ProposeInput extends Omit<TerritorialChangeCandidateInput, "claimKey"> {
  claimedActorName: string | null;
  changeType: TerritorialChangeType;
}

export interface ProposeResult {
  created: boolean;
  candidate: TerritorialChangeCandidateDTO | null;
  /** Set when the claim already exists (open or resolved). */
  duplicateOf?: string;
}

const MAX_CORROBORATED_CONFIDENCE = 0.8;

/** Creates a candidate unless the same underlying claim (conflict + place +
 * change type + claimed actor) already exists. A restatement from a
 * DIFFERENT source is recorded as corroboration on the open candidate; the
 * same source never inflates it. Different claimed actors are different
 * claims and coexist. */
export async function proposeTerritorialChange(input: ProposeInput): Promise<ProposeResult> {
  const claimKey = claimKeyFor({ conflictId: input.conflictId, locationName: input.locationName ?? null, changeType: input.changeType, claimedActorName: input.claimedActorName });

  const existing = await prisma.territorialChangeCandidate.findFirst({
    where: {
      OR: [
        { claimKey },
        // Rows from before claim keys existed (seeded/legacy): same conflict, place and report.
        { claimKey: null, conflictId: input.conflictId, locationName: input.locationName ?? null, sourceUrl: input.sourceUrl ?? null },
      ],
    },
    include: CANDIDATE_INCLUDE,
  });

  if (existing) {
    const sameReport = (input.sourceUrl ?? null) === existing.sourceUrl;
    const isOpen = (OPEN_CANDIDATE_STATUSES as readonly string[]).includes(existing.status);
    if (!sameReport && isOpen) {
      const extras = parseCorroboration(existing.corroboration);
      const known = new Set([existing.sourceName, ...extras.map((e) => e.sourceName)].map((s) => (s ?? "").toLowerCase()));
      const alreadyListed = extras.some((e) => e.sourceUrl === (input.sourceUrl ?? null));
      if (!alreadyListed) {
        extras.push({ sourceName: input.sourceName ?? null, sourceUrl: input.sourceUrl ?? null, observedAt: input.observedAt ? input.observedAt.toISOString() : null });
        const independent = !known.has((input.sourceName ?? "").toLowerCase());
        await prisma.territorialChangeCandidate.update({
          where: { id: existing.id },
          data: {
            corroboration: JSON.stringify(extras),
            // Only an independent source raises the claim's confidence, and never to certainty.
            confidence: independent ? Math.min(MAX_CORROBORATED_CONFIDENCE, Math.round((existing.confidence + 0.1) * 100) / 100) : existing.confidence,
          },
        });
      }
    }
    return { created: false, candidate: null, duplicateOf: existing.id };
  }

  const candidate = await createTerritorialChangeCandidate({ ...input, claimKey });
  return { created: true, candidate };
}

// ---- review actions ---------------------------------------------------------

function assertOpen(status: string) {
  if (!(OPEN_CANDIDATE_STATUSES as readonly string[]).includes(status)) {
    throw new Error(`Candidate is already resolved (${status})`);
  }
}

export async function rejectCandidate(id: string, note?: string | null): Promise<TerritorialChangeCandidateDTO> {
  const row = await prisma.territorialChangeCandidate.findUnique({ where: { id } });
  if (!row) throw new Error("Candidate not found");
  assertOpen(row.status);
  await prisma.territorialChangeCandidate.update({ where: { id }, data: { status: "rejected", reviewNote: note ?? null, reviewedAt: new Date() } });
  return (await getReviewCandidate(id))!;
}

/** "Mark uncertain" keeps the candidate open for later — nothing is applied. */
export async function markCandidateUncertain(id: string, note?: string | null): Promise<TerritorialChangeCandidateDTO> {
  const row = await prisma.territorialChangeCandidate.findUnique({ where: { id } });
  if (!row) throw new Error("Candidate not found");
  assertOpen(row.status);
  await prisma.territorialChangeCandidate.update({ where: { id }, data: { status: "uncertain", reviewNote: note ?? null, reviewedAt: new Date() } });
  return (await getReviewCandidate(id))!;
}

/** Folds candidate `id` into `intoId` (same conflict): the source candidate
 * becomes "merged" and its report is recorded as corroboration on the target. */
export async function mergeCandidate(id: string, intoId: string, note?: string | null): Promise<TerritorialChangeCandidateDTO> {
  if (id === intoId) throw new Error("Cannot merge a candidate into itself");
  const [source, target] = await Promise.all([
    prisma.territorialChangeCandidate.findUnique({ where: { id } }),
    prisma.territorialChangeCandidate.findUnique({ where: { id: intoId } }),
  ]);
  if (!source || !target) throw new Error("Candidate not found");
  if (source.conflictId !== target.conflictId) throw new Error("Candidates belong to different conflicts");
  assertOpen(source.status);
  assertOpen(target.status);

  const extras = parseCorroboration(target.corroboration);
  const known = new Set([target.sourceName, ...extras.map((e) => e.sourceName)].map((s) => (s ?? "").toLowerCase()));
  extras.push({ sourceName: source.sourceName, sourceUrl: source.sourceUrl, observedAt: source.observedAt ? source.observedAt.toISOString() : null });
  for (const e of parseCorroboration(source.corroboration)) extras.push(e);
  const independent = !known.has((source.sourceName ?? "").toLowerCase());

  await prisma.$transaction([
    prisma.territorialChangeCandidate.update({
      where: { id: intoId },
      data: {
        corroboration: JSON.stringify(extras),
        confidence: independent ? Math.min(MAX_CORROBORATED_CONFIDENCE, Math.round((target.confidence + 0.1) * 100) / 100) : target.confidence,
      },
    }),
    prisma.territorialChangeCandidate.update({
      where: { id },
      data: { status: "merged", mergedIntoId: intoId, reviewNote: note ?? null, reviewedAt: new Date() },
    }),
  ]);
  return (await getReviewCandidate(id))!;
}

async function findOrCreateConflictActor(conflictId: string, name: string) {
  const actors = await prisma.conflictActor.findMany({ where: { conflictId } });
  return actors.find((a) => norm(a.name) === norm(name)) ?? createActor(conflictId, name);
}

export interface ApproveOptions {
  note?: string | null;
  /** "reuse": supersede the matched polygon with its own geometry.
   * "record_only": record the verified change, geometry pending.
   * Default: reuse when it is safe, otherwise record_only. */
  geometryMode?: "reuse" | "record_only";
  validFrom?: Date | null;
  precision?: LocationPrecision;
  lat?: number | null;
  lng?: number | null;
  confidence?: number;
}

/** Explicit admin approval. Never overwrites history: a reusable polygon is
 * SUPERSEDED (old row closed with validTo, new row created with validFrom)
 * via the existing supersedeTerritory workflow; with no safe geometry the
 * change is recorded "pending geometry" and no polygon is fabricated. */
export async function approveCandidate(id: string, options: ApproveOptions = {}): Promise<TerritorialChangeCandidateDTO> {
  const row = await prisma.territorialChangeCandidate.findUnique({ where: { id }, include: CANDIDATE_INCLUDE });
  if (!row) throw new Error("Candidate not found");
  assertOpen(row.status);

  // Optional admin corrections to location detail before applying.
  const precision = options.precision ? toLocationPrecision(options.precision) : toLocationPrecision(row.precision);
  const lat = options.lat !== undefined ? options.lat : row.lat;
  const lng = options.lng !== undefined ? options.lng : row.lng;
  const corrected = { ...row, precision, lat, lng };

  const dto = toCandidateDTO(corrected);
  const now = new Date();
  const territories = await activeTerritories([row.conflictId], now);
  const open = (
    await prisma.territorialChangeCandidate.findMany({ where: { conflictId: row.conflictId, status: { in: [...OPEN_CANDIDATE_STATUSES] } }, include: CANDIDATE_INCLUDE })
  ).map((r) => toComparable(toCandidateDTO(r)));
  const comparison = compareCandidate(toComparable(dto), territories, open);

  const mode = options.geometryMode ?? (comparison.canReuseGeometry ? "reuse" : "record_only");
  if (mode === "reuse" && !comparison.canReuseGeometry) {
    throw new Error("No single existing polygon can be safely reused for this claim — approve as record_only and add geometry later");
  }

  const confidence = options.confidence ?? row.confidence;
  let appliedTerritoryId: string | null = null;

  if (mode === "reuse") {
    const current = territories.find((t) => t.row.id === comparison.currentTerritoryId)!;
    const actor = comparison.proposedActorName ? await findOrCreateConflictActor(row.conflictId, comparison.proposedActorName) : null;
    let validFrom = options.validFrom ?? row.observedAt ?? now;
    if (validFrom.getTime() > now.getTime()) validFrom = now;
    if (validFrom.getTime() < current.row.validFrom.getTime()) validFrom = current.row.validFrom;
    const { next } = await supersedeTerritory(current.row.id, {
      actorId: actor?.id ?? null,
      status: comparison.proposedStatus,
      confidence,
      geometry: current.geometry,
      sourceName: row.sourceName,
      sourceUrl: row.sourceUrl,
      validFrom,
    });
    appliedTerritoryId = next.id;
  }

  await prisma.territorialChangeCandidate.update({
    where: { id },
    data: {
      status: "approved",
      precision,
      lat,
      lng,
      confidence,
      reviewNote: options.note ?? null,
      reviewedAt: now,
      appliedTerritoryId,
      geometryPending: mode === "record_only",
    },
  });
  return (await getReviewCandidate(id))!;
}

/** Supplies admin-authored geometry for an approved-pending-geometry change.
 * Creates and publishes a NEW territory version from that geometry (nothing
 * is drawn automatically). */
export async function attachGeometry(id: string, geometry: unknown, options: { validFrom?: Date | null } = {}): Promise<TerritorialChangeCandidateDTO> {
  const row = await prisma.territorialChangeCandidate.findUnique({ where: { id }, include: CANDIDATE_INCLUDE });
  if (!row) throw new Error("Candidate not found");
  if (row.status !== "approved" || !row.geometryPending) throw new Error("Candidate is not approved and awaiting geometry");
  if (!isValidTerritorialGeometry(geometry)) throw new Error("Geometry must be a GeoJSON Polygon or MultiPolygon");

  const dto = toCandidateDTO(row);
  const proposal = proposalFor(toComparable(dto), null);
  const actor = proposal.actor ? await findOrCreateConflictActor(row.conflictId, proposal.actor) : null;
  const now = new Date();
  let validFrom = options.validFrom ?? row.observedAt ?? now;
  if (validFrom.getTime() > now.getTime()) validFrom = now;

  const draft = await createTerritoryDraft({
    conflictId: row.conflictId,
    actorId: actor?.id ?? null,
    status: proposal.status,
    confidence: row.confidence,
    geometry,
    sourceName: row.sourceName,
    sourceUrl: row.sourceUrl,
    validFrom,
  });
  const published = await publishTerritory(draft.id);
  await prisma.territorialChangeCandidate.update({ where: { id }, data: { appliedTerritoryId: published.id, geometryPending: false } });
  return (await getReviewCandidate(id))!;
}
