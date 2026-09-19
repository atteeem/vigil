import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";

// Marks an ingestion source as dedicated/general for a conflict (explicit
// relevance). Country match and contributed events are derived at read time
// and need no row.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { sourceId?: string; conflictId?: string; scope?: string; note?: string } | null;
  if (!body?.sourceId || !body.conflictId) return NextResponse.json({ error: "sourceId and conflictId are required" }, { status: 400 });
  const scope = body.scope === "general" ? "general" : "dedicated";
  const [source, conflict] = await Promise.all([prisma.source.findUnique({ where: { id: body.sourceId } }), prisma.conflict.findUnique({ where: { id: body.conflictId } })]);
  if (!source || !conflict) return NextResponse.json({ error: "Source or conflict not found" }, { status: 404 });
  const link = await prisma.sourceConflictLink.upsert({
    where: { sourceId_conflictId: { sourceId: body.sourceId, conflictId: body.conflictId } },
    update: { scope, note: body.note ?? null },
    create: { sourceId: body.sourceId, conflictId: body.conflictId, scope, note: body.note ?? null },
  });
  return NextResponse.json(link, { status: 201 });
}

export async function DELETE(request: Request) {
  const body = (await request.json().catch(() => null)) as { sourceId?: string; conflictId?: string } | null;
  if (!body?.sourceId || !body.conflictId) return NextResponse.json({ error: "sourceId and conflictId are required" }, { status: 400 });
  await prisma.sourceConflictLink.deleteMany({ where: { sourceId: body.sourceId, conflictId: body.conflictId } });
  return NextResponse.json({ ok: true });
}
