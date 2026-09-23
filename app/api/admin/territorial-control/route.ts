import { NextResponse } from "next/server";
import {
  listAllTerritoriesAdmin,
  createTerritoryDraft,
  getTerritory,
  type TerritoryInput,
} from "@/lib/db/repositories/territorial-control";
import { geometryErrorResponse, repositoryErrorResponse } from "@/lib/territory/api-errors";
import { ASSIGNABLE_TERRITORIAL_STATUSES } from "@/lib/types/territorial-control";

export async function GET() {
  const territories = await listAllTerritoriesAdmin();
  return NextResponse.json(territories);
}

interface CreateBody {
  conflictId?: string;
  actorId?: string | null;
  status?: string;
  confidence?: number;
  geometry?: unknown;
  sourceName?: string | null;
  sourceUrl?: string | null;
  validFrom?: string;
  validTo?: string | null;
  /** Partial change: the active version this draft carves its area out of when published. */
  splitFromId?: string | null;
  territoryKind?: string;
  datasetId?: string | null;
}

export async function POST(request: Request) {
  const body = (await request.json()) as CreateBody;
  if (!body.conflictId || !body.status || body.confidence === undefined || !body.geometry || !body.validFrom) {
    return NextResponse.json(
      { error: "conflictId, status, confidence, geometry, and validFrom are required" },
      { status: 400 },
    );
  }
  if (!ASSIGNABLE_TERRITORIAL_STATUSES.includes(body.status as never)) {
    return NextResponse.json({ error: `status must be one of ${ASSIGNABLE_TERRITORIAL_STATUSES.join(", ")}` }, { status: 400 });
  }
  const geometryError = geometryErrorResponse(body.geometry);
  if (geometryError) return geometryError;
  const validFrom = new Date(body.validFrom);
  if (Number.isNaN(validFrom.getTime())) {
    return NextResponse.json({ error: "validFrom is not a valid timestamp" }, { status: 400 });
  }
  const validTo = body.validTo ? new Date(body.validTo) : null;
  if (validTo && Number.isNaN(validTo.getTime())) {
    return NextResponse.json({ error: "validTo is not a valid timestamp" }, { status: 400 });
  }

  const input: TerritoryInput = {
    conflictId: body.conflictId,
    actorId: body.actorId ?? null,
    status: body.status as TerritoryInput["status"],
    confidence: body.confidence,
    geometry: body.geometry as TerritoryInput["geometry"],
    sourceName: body.sourceName ?? null,
    sourceUrl: body.sourceUrl ?? null,
    validFrom,
    validTo,
    splitFromId: body.splitFromId ?? null,
    territoryKind: ["control", "influence", "presence"].includes(body.territoryKind ?? "") ? (body.territoryKind as TerritoryInput["territoryKind"]) : "control",
    datasetId: body.datasetId ?? null,
  };
  try {
    const created = await createTerritoryDraft(input);
    return NextResponse.json(await getTerritory(created.id), { status: 201 });
  } catch (err) {
    return repositoryErrorResponse(err);
  }
}
