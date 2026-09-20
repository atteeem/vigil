import { NextResponse } from "next/server";
import { alertsForClaim } from "@/lib/alerts/hooks";
import { prisma } from "@/lib/db/client";

// A party statement about an infrastructure/transport state or its cause ("we closed the strait",
// "we destroyed the plant"). Recorded as a CLAIM beside the event. It never changes the event's status,
// prominence or geometry: those move only on operator data, independent observation or corroboration.
export const dynamic = "force-dynamic";

const CLAIM_TYPES = ["closure", "attack", "destruction", "cause_attribution", "other"];

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return NextResponse.json(await prisma.globalEventClaim.findMany({ where: { globalEventId: id }, orderBy: { observedAt: "desc" } }));
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { claimant?: string; claimType?: string; text?: string; sourceName?: string; sourceUrl?: string; observedAt?: string } | null;
  if (!body?.claimant || !body.text) return NextResponse.json({ error: "claimant and text are required" }, { status: 400 });
  const event = await prisma.globalEvent.findUnique({ where: { id }, select: { id: true, entityKey: true } });
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const claim = await prisma.globalEventClaim.create({
    data: { globalEventId: id, entityKey: event.entityKey, claimant: body.claimant, claimType: CLAIM_TYPES.includes(body.claimType ?? "") ? body.claimType! : "other", text: body.text, sourceName: body.sourceName ?? null, sourceUrl: body.sourceUrl ?? null, observedAt: body.observedAt ? new Date(body.observedAt) : new Date(), verification: "unverified" },
  });
  await alertsForClaim(claim.id);
  return NextResponse.json(claim, { status: 201 });
}
