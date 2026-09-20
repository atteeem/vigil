import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";

// Relationships between a structured event (a closure, a blackout) and a conflict or conflict event.
// NEVER created from proximity: only from an explicit source relation (needs a source URL), an admin
// review (needs a note), and only `confirmed` links are public. No deterministic auto-rules are enabled.
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return NextResponse.json(await prisma.globalEventLink.findMany({ where: { globalEventId: id }, orderBy: { createdAt: "desc" } }));
}

interface Body {
  conflictId?: string | null;
  eventId?: string | null;
  basis?: string;
  status?: string;
  note?: string | null;
  sourceName?: string | null;
  sourceUrl?: string | null;
  linkId?: string;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  if (!(await prisma.globalEvent.findUnique({ where: { id }, select: { id: true } }))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Review an existing link.
  if (body.linkId) {
    if (!["confirmed", "rejected", "proposed"].includes(body.status ?? "")) return NextResponse.json({ error: "status must be confirmed, rejected or proposed" }, { status: 400 });
    const link = await prisma.globalEventLink.update({ where: { id: body.linkId }, data: { status: body.status!, reviewedAt: new Date(), ...(body.note ? { note: body.note } : {}) } });
    return NextResponse.json(link);
  }

  if (!body.conflictId && !body.eventId) return NextResponse.json({ error: "conflictId or eventId is required" }, { status: 400 });
  if (body.basis === "proximity" || body.basis === "rule") return NextResponse.json({ error: "Links are never created from proximity or an automatic rule: use source_relation (with a source URL) or admin_review (with a note)." }, { status: 400 });
  if (body.basis === "source_relation" && !body.sourceUrl) return NextResponse.json({ error: "A source_relation link needs the source URL that states the relationship." }, { status: 400 });
  if (body.basis === "admin_review" && !body.note) return NextResponse.json({ error: "An admin_review link needs a note explaining the basis." }, { status: 400 });
  if (body.basis !== "source_relation" && body.basis !== "admin_review") return NextResponse.json({ error: "basis must be source_relation or admin_review" }, { status: 400 });
  if (body.conflictId && !(await prisma.conflict.findUnique({ where: { id: body.conflictId }, select: { id: true } }))) return NextResponse.json({ error: "Unknown conflict" }, { status: 404 });

  const link = await prisma.globalEventLink.create({
    data: { globalEventId: id, conflictId: body.conflictId ?? null, eventId: body.eventId ?? null, basis: body.basis, status: body.status === "confirmed" ? "confirmed" : "proposed", note: body.note ?? null, sourceName: body.sourceName ?? null, sourceUrl: body.sourceUrl ?? null, reviewedAt: body.status === "confirmed" ? new Date() : null },
  });
  return NextResponse.json(link, { status: 201 });
}
