import { NextResponse } from "next/server";
import { alertsForConflict } from "@/lib/alerts/hooks";
import { updateConflict, deleteConflictIfSafe, toConflictDTO, type ConflictInput } from "@/lib/db/repositories/conflicts";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json()) as Partial<ConflictInput>;
  const conflict = await updateConflict(id, body);
  await alertsForConflict(conflict.id);
  return NextResponse.json(toConflictDTO(conflict));
}

// "delete only when safe" (spec §1) — refuses (409) when any event is
// still linked; archive via PATCH { status: "archived" } instead.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await deleteConflictIfSafe(id);
  if (!result.deleted) {
    return NextResponse.json(
      { error: `Cannot delete: ${result.linkedEventCount} event(s) still linked. Archive it instead.` },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true });
}
