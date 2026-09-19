import { NextResponse } from "next/server";
import { deleteSourceCandidate, updateSourceCandidate, validateCandidateInput } from "@/lib/db/repositories/source-candidates";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const result = validateCandidateInput(body, false);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  try {
    return NextResponse.json(await updateSourceCandidate(id, result.value));
  } catch {
    return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await deleteSourceCandidate(id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
  }
}
