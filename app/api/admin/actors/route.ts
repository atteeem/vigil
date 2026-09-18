import { NextResponse } from "next/server";
import { listActorsForConflict, createActor, toActorDTO } from "@/lib/db/repositories/territorial-control";

// ?conflictId=<id> (required) — actors are scoped per-conflict, never a
// global registry (see prisma/schema.prisma's ConflictActor comment).
export async function GET(request: Request) {
  const conflictId = new URL(request.url).searchParams.get("conflictId");
  if (!conflictId) return NextResponse.json({ error: "conflictId is required" }, { status: 400 });
  const actors = await listActorsForConflict(conflictId);
  return NextResponse.json(actors.map(toActorDTO));
}

export async function POST(request: Request) {
  const body = (await request.json()) as { conflictId?: string; name?: string };
  if (!body.conflictId || !body.name?.trim()) {
    return NextResponse.json({ error: "conflictId and name are required" }, { status: 400 });
  }
  try {
    const actor = await createActor(body.conflictId, body.name);
    return NextResponse.json(toActorDTO(actor), { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("Unique constraint") ? 409 : 500;
    return NextResponse.json({ error: status === 409 ? "This actor name already exists for this conflict." : message }, { status });
  }
}
