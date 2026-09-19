import { NextResponse } from "next/server";
import { applyCandidateGeometry } from "@/lib/db/repositories/territorial-changes";
import { repositoryErrorResponse } from "@/lib/territory/api-errors";

// Publishes admin-drawn geometry for a candidate. `confirm: true` is required
// — publishing territory is never implicit. Never derives geometry from text.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    geometry?: unknown;
    confirm?: boolean;
    sourceTerritoryId?: string | null;
    validFrom?: string;
  } | null;
  if (!body?.geometry) return NextResponse.json({ error: "geometry is required" }, { status: 400 });
  if (body.confirm !== true) return NextResponse.json({ error: "Explicit confirmation is required to publish territory" }, { status: 400 });
  const validFrom = body.validFrom ? new Date(body.validFrom) : null;
  if (validFrom && Number.isNaN(validFrom.getTime())) return NextResponse.json({ error: "validFrom is not a valid date" }, { status: 400 });
  try {
    return NextResponse.json(await applyCandidateGeometry(id, body.geometry, { confirm: true, sourceTerritoryId: body.sourceTerritoryId, validFrom }));
  } catch (err) {
    return repositoryErrorResponse(err, 409);
  }
}
