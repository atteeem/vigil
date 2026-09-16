import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import type { Prisma } from "@prisma/client";
import { findDuplicateCandidates } from "@/lib/ingestion/duplicates";
import type { ProcessingStatus, IncomingSort, DuplicateLikelihood } from "@/lib/types/db";

function likelihoodFromScore(score: number | undefined): DuplicateLikelihood {
  if (score === undefined) return "none";
  if (score >= 70) return "high";
  if (score >= 50) return "medium";
  return "low"; // findDuplicateCandidates already drops anything below its own MIN_SCORE
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
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const status = params.get("status") as ProcessingStatus | null;
  const sourceId = params.get("sourceId");
  const conflictId = params.get("conflictId");
  const region = params.get("region");
  const eventType = params.get("eventType");
  const maxAgeHoursRaw = params.get("maxAgeHours");
  const maxAgeHours = maxAgeHoursRaw ? Number(maxAgeHoursRaw) : null;
  const sort = (params.get("sort") as IncomingSort | null) ?? "newest";
  const duplicateLikelihood = params.get("duplicateLikelihood") as DuplicateLikelihood | null;

  const where: Prisma.RawIngestionItemWhereInput = {};
  if (status) where.processingStatus = status;
  if (sourceId) where.sourceId = sourceId;
  if (conflictId) where.suggestedConflictId = conflictId;
  if (region) where.suggestedRegion = region;
  if (eventType) where.suggestedEventType = eventType;
  if (maxAgeHours) where.receivedAt = { gte: new Date(Date.now() - maxAgeHours * 3_600_000) };

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
      return {
        ...item,
        mediaUrls: item.mediaUrls ? (JSON.parse(item.mediaUrls) as string[]) : [],
        rawMetadata: item.rawMetadata ? (JSON.parse(item.rawMetadata) as Record<string, unknown>) : null,
        topDuplicate,
        duplicateLikelihood: likelihoodFromScore(topDuplicate?.score),
      };
    }),
  );

  let result = withDuplicates;
  if (duplicateLikelihood) result = result.filter((item) => item.duplicateLikelihood === duplicateLikelihood);
  if (sort === "duplicate") {
    result = [...result].sort((a, b) => (b.topDuplicate?.score ?? 0) - (a.topDuplicate?.score ?? 0));
  }

  return NextResponse.json(result);
}
