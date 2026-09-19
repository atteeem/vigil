import { NextResponse } from "next/server";
import { listTerritorialChangeCandidates, createTerritorialChangeCandidate } from "@/lib/db/repositories/myanmar";
import { LOCATION_PRECISIONS, TERRITORIAL_CHANGE_CANDIDATE_STATUSES, type LocationPrecision, type TerritorialChangeCandidateStatus } from "@/lib/types/db";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const candidates = await listTerritorialChangeCandidates({
    conflictId: url.searchParams.get("conflictId") ?? undefined,
    status: TERRITORIAL_CHANGE_CANDIDATE_STATUSES.includes(status as TerritorialChangeCandidateStatus)
      ? (status as TerritorialChangeCandidateStatus)
      : undefined,
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
    sourceName?: string;
    sourceUrl?: string;
    observedAt?: string;
  } | null;
  if (!body?.conflictId || !body.description) {
    return NextResponse.json({ error: "conflictId and description are required" }, { status: 400 });
  }
  const candidate = await createTerritorialChangeCandidate({
    ...body,
    conflictId: body.conflictId,
    description: body.description,
    precision: LOCATION_PRECISIONS.includes(body.precision as LocationPrecision) ? (body.precision as LocationPrecision) : "unknown",
    observedAt: body.observedAt ? new Date(body.observedAt) : null,
  });
  return NextResponse.json(candidate, { status: 201 });
}
