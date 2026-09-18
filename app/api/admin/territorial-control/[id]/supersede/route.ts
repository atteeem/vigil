import { NextResponse } from "next/server";
import { supersedeTerritory, getTerritory } from "@/lib/db/repositories/territorial-control";
import { isValidTerritorialGeometry } from "@/lib/data/territorial-control";
import { ASSIGNABLE_TERRITORIAL_STATUSES } from "@/lib/types/territorial-control";

interface SupersedeBody {
  actorId?: string | null;
  status?: string;
  confidence?: number;
  geometry?: unknown;
  sourceName?: string | null;
  sourceUrl?: string | null;
  validFrom?: string;
}

// "Changing control must preserve previous historical state rather than
// overwriting it" (spec §6) — creates a new published version and closes
// out the current one, both in one transaction (supersedeTerritory).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json()) as SupersedeBody;

  if (!body.status || body.confidence === undefined || !body.geometry || !body.validFrom) {
    return NextResponse.json({ error: "status, confidence, geometry, and validFrom are required" }, { status: 400 });
  }
  if (!ASSIGNABLE_TERRITORIAL_STATUSES.includes(body.status as never)) {
    return NextResponse.json({ error: `status must be one of ${ASSIGNABLE_TERRITORIAL_STATUSES.join(", ")}` }, { status: 400 });
  }
  if (!isValidTerritorialGeometry(body.geometry)) {
    return NextResponse.json({ error: "geometry must be a valid GeoJSON Polygon or MultiPolygon" }, { status: 400 });
  }
  const validFrom = new Date(body.validFrom);
  if (Number.isNaN(validFrom.getTime())) {
    return NextResponse.json({ error: "validFrom is not a valid timestamp" }, { status: 400 });
  }

  try {
    const { next } = await supersedeTerritory(id, {
      actorId: body.actorId ?? null,
      status: body.status as never,
      confidence: body.confidence,
      geometry: body.geometry as never,
      sourceName: body.sourceName ?? null,
      sourceUrl: body.sourceUrl ?? null,
      validFrom,
    });
    return NextResponse.json(await getTerritory(next.id), { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: message.includes("not found") ? 404 : 400 });
  }
}
