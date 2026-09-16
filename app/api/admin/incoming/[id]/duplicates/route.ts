import { NextResponse } from "next/server";
import { findDuplicateCandidates } from "@/lib/ingestion/duplicates";

interface DuplicateCheckBody {
  title: string;
  eventType: string;
  latitude: number | null;
  longitude: number | null;
  countryCode: string | null;
  region: string | null;
  conflictId: string | null;
  occurredAt: string;
}

// Re-scores duplicate candidates against whatever the admin has currently
// typed into the review form (spec §2) — called after a manual edit to
// location/type/conflict, not just once at draft-generation time.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json()) as DuplicateCheckBody;

  const candidates = await findDuplicateCandidates({
    title: body.title,
    eventType: body.eventType,
    latitude: body.latitude,
    longitude: body.longitude,
    countryCode: body.countryCode,
    region: body.region,
    conflictId: body.conflictId,
    occurredAt: new Date(body.occurredAt),
  });

  void id; // raw item id — not needed for scoring, kept for route symmetry/future use (e.g. excluding a self-merge)
  return NextResponse.json(candidates);
}
