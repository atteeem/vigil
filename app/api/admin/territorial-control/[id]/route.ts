import { NextResponse } from "next/server";
import { updateTerritoryDraft, deleteTerritoryDraft, getTerritory, type TerritoryInput } from "@/lib/db/repositories/territorial-control";
import { geometryErrorResponse, repositoryErrorResponse } from "@/lib/territory/api-errors";
import { ASSIGNABLE_TERRITORIAL_STATUSES } from "@/lib/types/territorial-control";

interface PatchBody {
  actorId?: string | null;
  status?: string;
  confidence?: number;
  geometry?: unknown;
  sourceName?: string | null;
  sourceUrl?: string | null;
  validFrom?: string;
  validTo?: string | null;
}

// Draft-only edit (see updateTerritoryDraft's own comment — a published
// row is immutable). Returns 409, not 500, when the row is already
// published, since that's an expected/recoverable caller state, not a
// server error.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json()) as PatchBody;

  if (body.status !== undefined && !ASSIGNABLE_TERRITORIAL_STATUSES.includes(body.status as never)) {
    return NextResponse.json({ error: `status must be one of ${ASSIGNABLE_TERRITORIAL_STATUSES.join(", ")}` }, { status: 400 });
  }
  if (body.geometry !== undefined) {
    const geometryError = geometryErrorResponse(body.geometry);
    if (geometryError) return geometryError;
  }

  const input: Partial<TerritoryInput> = {};
  if (body.actorId !== undefined) input.actorId = body.actorId;
  if (body.status !== undefined) input.status = body.status as TerritoryInput["status"];
  if (body.confidence !== undefined) input.confidence = body.confidence;
  if (body.geometry !== undefined) input.geometry = body.geometry as TerritoryInput["geometry"];
  if (body.sourceName !== undefined) input.sourceName = body.sourceName;
  if (body.sourceUrl !== undefined) input.sourceUrl = body.sourceUrl;
  if (body.validFrom !== undefined) input.validFrom = new Date(body.validFrom);
  if (body.validTo !== undefined) input.validTo = body.validTo ? new Date(body.validTo) : null;

  try {
    await updateTerritoryDraft(id, input);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("Cannot edit")) return NextResponse.json({ error: message }, { status: 409 });
    return repositoryErrorResponse(err, 404);
  }
  return NextResponse.json(await getTerritory(id));
}

// Draft-only delete — see deleteTerritoryDraft's own comment.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await deleteTerritoryDraft(id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: message.includes("Cannot delete") ? 409 : 404 });
  }
  return NextResponse.json({ ok: true });
}
