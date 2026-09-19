import { NextResponse } from "next/server";
import { createTerritorialChangeCandidate } from "@/lib/db/repositories/myanmar";
import { listReviewCandidates } from "@/lib/db/repositories/territorial-changes";
import { isChangeType } from "@/lib/territory/change-types";
import { LOCATION_PRECISIONS, TERRITORIAL_CHANGE_CANDIDATE_STATUSES, type LocationPrecision, type TerritorialChangeCandidateStatus } from "@/lib/types/db";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  // Each row carries its comparison against the current published territorial
  // state, the source report and (when published) the event.
  const candidates = await listReviewCandidates({
    conflictId: url.searchParams.get("conflictId") ?? undefined,
    status: TERRITORIAL_CHANGE_CANDIDATE_STATUSES.includes(status as TerritorialChangeCandidateStatus) ? (status ?? undefined) : undefined,
  });
  return NextResponse.json(candidates);
}

// Manual flagging by an admin. Always creates a "pending" row — never
// touches ConflictTerritory.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    conflictId?: string;
    description?: string;
    claimedActorId?: string;
    previousActorId?: string;
    locationName?: string;
    lat?: number;
    lng?: number;
    precision?: string;
    changeType?: string;
    confidence?: number;
    evidence?: string;
    sourceName?: string;
    sourceUrl?: string;
    observedAt?: string;
  } | null;
  if (!body?.conflictId || !body.description) {
    return NextResponse.json({ error: "conflictId and description are required" }, { status: 400 });
  }
  const precision = LOCATION_PRECISIONS.includes(body.precision as LocationPrecision) ? (body.precision as LocationPrecision) : "unknown";
  // A point is only kept for exact/approximate claims — never invented for an area-level/unknown one.
  const keepPoint = precision === "exact" || precision === "approximate";
  const candidate = await createTerritorialChangeCandidate({
    ...body,
    conflictId: body.conflictId,
    description: body.description,
    changeType: body.changeType && isChangeType(body.changeType) ? body.changeType : "captured",
    lat: keepPoint ? body.lat : null,
    lng: keepPoint ? body.lng : null,
    precision,
    observedAt: body.observedAt ? new Date(body.observedAt) : null,
  });
  return NextResponse.json(candidate, { status: 201 });
}
