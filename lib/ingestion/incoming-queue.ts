import { prisma } from "@/lib/db/client";
import type { Prisma } from "@prisma/client";
import { findDuplicateCandidates } from "@/lib/ingestion/duplicates";
import { applyDuplicateSignal, type Classification, type ReadinessStatus } from "@/lib/ingestion/publish-readiness";
import type { ProcessingStatus, IncomingSort, DuplicateLikelihood } from "@/lib/types/db";

function likelihoodFromScore(score: number | undefined): DuplicateLikelihood {
  if (score === undefined) return "none";
  if (score >= 70) return "high";
  if (score >= 50) return "medium";
  return "low"; // findDuplicateCandidates already drops anything below its own MIN_SCORE
}

export interface IncomingFilters {
  status?: ProcessingStatus | null;
  sourceId?: string | null;
  conflictId?: string | null;
  region?: string | null;
  eventType?: string | null;
  maxAgeHours?: number | null;
  sort?: IncomingSort | null;
  duplicateLikelihood?: DuplicateLikelihood | null;
  /** Backlog Triage & Safe Publication v1 (lib/ingestion/publish-readiness.ts). readiness filters on the
   * FINAL verdict (snapshot + live duplicate signal combined), applied in memory below since the
   * duplicate part can never be a stale DB column. */
  readiness?: ReadinessStatus | null;
  classification?: Classification | null;
  /** Bucketed on the snapshot's suggestedConflictConfidence: "high" >= 0.6, "medium" > 0 and < 0.6, "none" = 0/null. */
  conflictMatchLevel?: "high" | "medium" | "none" | null;
}

export function filtersFromParams(params: URLSearchParams): IncomingFilters {
  const maxAgeHoursRaw = params.get("maxAgeHours");
  return {
    status: params.get("status") as ProcessingStatus | null,
    sourceId: params.get("sourceId"),
    conflictId: params.get("conflictId"),
    region: params.get("region"),
    eventType: params.get("eventType"),
    maxAgeHours: maxAgeHoursRaw ? Number(maxAgeHoursRaw) : null,
    sort: params.get("sort") as IncomingSort | null,
    duplicateLikelihood: params.get("duplicateLikelihood") as DuplicateLikelihood | null,
    readiness: params.get("readiness") as ReadinessStatus | null,
    classification: params.get("classification") as Classification | null,
    conflictMatchLevel: params.get("conflictMatchLevel") as "high" | "medium" | "none" | null,
  };
}

// Incoming Queue (spec §8: filters + sorting). Source/conflict/region/
// event-type/age/status filter at the DB level via the suggestion
// snapshot columns (see prisma/schema.prisma's RawIngestionItem comment).
// Duplicate likelihood is different: it's never snapshotted (an event
// published after this item arrived can make it newly duplicate
// something), so it's computed fresh here, per pending item with a
// resolved location, and the duplicateLikelihood filter / "duplicate"
// sort are applied in memory afterward — see ARCHITECTURE.md "Duplicate
// handling in the incoming queue."
export async function listIncomingItems(filters: IncomingFilters) {
  const { status, sourceId, conflictId, region, eventType, maxAgeHours, duplicateLikelihood, readiness, classification, conflictMatchLevel } = filters;
  const sort = filters.sort ?? "newest";

  const where: Prisma.RawIngestionItemWhereInput = {};
  if (status) where.processingStatus = status;
  if (sourceId) where.sourceId = sourceId;
  if (conflictId) where.suggestedConflictId = conflictId;
  if (region) where.suggestedRegion = region;
  if (eventType) where.suggestedEventType = eventType;
  if (maxAgeHours) where.receivedAt = { gte: new Date(Date.now() - maxAgeHours * 3_600_000) };
  if (classification) where.suggestedClassification = classification;
  if (conflictMatchLevel === "high") where.suggestedConflictConfidence = { gte: 0.6 };
  else if (conflictMatchLevel === "medium") where.suggestedConflictConfidence = { gt: 0, lt: 0.6 };
  else if (conflictMatchLevel === "none") where.OR = [{ suggestedConflictConfidence: null }, { suggestedConflictConfidence: 0 }];

  const orderBy: Prisma.RawIngestionItemOrderByWithRelationInput[] =
    sort === "oldest"
      ? [{ receivedAt: "asc" }]
      : sort === "importance"
        ? [{ suggestedImportance: { sort: "desc", nulls: "last" } }, { receivedAt: "desc" }]
        : [{ receivedAt: "desc" }]; // "newest" and "duplicate" both start newest-first, "duplicate" re-sorts below

  const rows = await prisma.rawIngestionItem.findMany({ where, include: { source: true }, orderBy });

  const withDuplicates = await Promise.all(
    rows.map(async (item) => {
      let topDuplicate = null;
      if (item.processingStatus === "pending" && item.suggestedLat !== null && item.suggestedLng !== null) {
        const candidates = await findDuplicateCandidates({
          title: item.originalTitle ?? "",
          eventType: item.suggestedEventType ?? "other",
          latitude: item.suggestedLat,
          longitude: item.suggestedLng,
          countryCode: item.suggestedCountryCode,
          region: item.suggestedRegion,
          conflictId: item.suggestedConflictId,
          occurredAt: item.publishedAt ?? item.receivedAt,
        });
        topDuplicate = candidates[0] ?? null;
      }
      const finalVerdict = applyDuplicateSignal(
        {
          classification: (item.suggestedClassification as Classification) ?? "OTHER",
          readiness: (item.suggestedReadiness as ReadinessStatus) ?? "NEEDS_REVIEW",
          reasons: item.suggestedReadinessReasons ? (JSON.parse(item.suggestedReadinessReasons) as string[]) : [],
        },
        likelihoodFromScore(topDuplicate?.score),
      );
      return {
        ...item,
        mediaUrls: item.mediaUrls ? (JSON.parse(item.mediaUrls) as string[]) : [],
        rawMetadata: item.rawMetadata ? (JSON.parse(item.rawMetadata) as Record<string, unknown>) : null,
        topDuplicate,
        duplicateLikelihood: likelihoodFromScore(topDuplicate?.score),
        finalClassification: finalVerdict.classification,
        finalReadiness: finalVerdict.readiness,
        finalReadinessReasons: finalVerdict.reasons,
      };
    }),
  );

  let result = withDuplicates;
  if (duplicateLikelihood) result = result.filter((item) => item.duplicateLikelihood === duplicateLikelihood);
  if (readiness) result = result.filter((item) => item.finalReadiness === readiness);
  if (sort === "duplicate") {
    result = [...result].sort((a, b) => (b.topDuplicate?.score ?? 0) - (a.topDuplicate?.score ?? 0));
  }

  return result;
}
