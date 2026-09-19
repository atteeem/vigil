import { NextResponse } from "next/server";
import { reviewTerritorialChangeCandidate } from "@/lib/db/repositories/myanmar";

// Review-state only. Deliberately has no path that creates, edits, or
// supersedes a ConflictTerritory.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { status?: string; reviewNote?: string } | null;
  if (body?.status !== "reviewed" && body?.status !== "dismissed") {
    return NextResponse.json({ error: "status must be 'reviewed' or 'dismissed'" }, { status: 400 });
  }
  const candidate = await reviewTerritorialChangeCandidate(id, body.status, body.reviewNote);
  return NextResponse.json(candidate);
}
