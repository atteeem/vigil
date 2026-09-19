import { NextResponse } from "next/server";
import {
  approveCandidate,
  getReviewCandidate,
  markCandidateUncertain,
  mergeCandidate,
  rejectCandidate,
} from "@/lib/db/repositories/territorial-changes";
import { LOCATION_PRECISIONS, type LocationPrecision } from "@/lib/types/db";

// Explicit review actions. "approve" is the ONLY action that can change
// territorial control, and only through supersede/versioning (or a
// pending-geometry record) — see approveCandidate.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    action?: string;
    note?: string;
    mergeIntoId?: string;
    geometryMode?: "reuse" | "record_only";
    validFrom?: string;
    precision?: string;
    lat?: number | null;
    lng?: number | null;
    confidence?: number;
  } | null;
  if (!body?.action) return NextResponse.json({ error: "action is required" }, { status: 400 });
  if (!(await getReviewCandidate(id))) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });

  try {
    switch (body.action) {
      case "approve": {
        const validFrom = body.validFrom ? new Date(body.validFrom) : null;
        if (validFrom && Number.isNaN(validFrom.getTime())) return NextResponse.json({ error: "validFrom is not a valid date" }, { status: 400 });
        const precision = LOCATION_PRECISIONS.includes(body.precision as LocationPrecision) ? (body.precision as LocationPrecision) : undefined;
        // An area-level/unknown correction never carries a point.
        const keepPoint = precision === undefined || precision === "exact" || precision === "approximate";
        return NextResponse.json(
          await approveCandidate(id, {
            note: body.note,
            geometryMode: body.geometryMode,
            validFrom,
            precision,
            lat: keepPoint ? body.lat : null,
            lng: keepPoint ? body.lng : null,
            confidence: typeof body.confidence === "number" ? Math.max(0, Math.min(1, body.confidence)) : undefined,
          }),
        );
      }
      case "reject":
        return NextResponse.json(await rejectCandidate(id, body.note));
      case "uncertain":
        return NextResponse.json(await markCandidateUncertain(id, body.note));
      case "merge":
        if (!body.mergeIntoId) return NextResponse.json({ error: "mergeIntoId is required" }, { status: 400 });
        return NextResponse.json(await mergeCandidate(id, body.mergeIntoId, body.note));
      default:
        return NextResponse.json({ error: "action must be approve, reject, uncertain or merge" }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Review failed" }, { status: 409 });
  }
}
