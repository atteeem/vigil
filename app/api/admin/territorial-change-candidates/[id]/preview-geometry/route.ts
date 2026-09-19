import { NextResponse } from "next/server";
import { previewCandidateGeometry } from "@/lib/db/repositories/territorial-changes";

// Read-only old-vs-proposed preview for a drawn area. Writes nothing.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { geometry?: unknown; sourceTerritoryId?: string | null } | null;
  try {
    return NextResponse.json(await previewCandidateGeometry(id, body?.geometry, body?.sourceTerritoryId));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Preview failed";
    return NextResponse.json({ error: message }, { status: message.includes("not found") ? 404 : 400 });
  }
}
