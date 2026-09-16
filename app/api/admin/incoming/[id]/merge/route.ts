import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { linkEventSource } from "@/lib/db/repositories/event-sources";
import { setProcessingStatus } from "@/lib/db/repositories/raw-ingestion-items";
import type { EventSourceRelationship } from "@/lib/types/db";

interface MergeBody {
  eventId: string;
  relationship?: EventSourceRelationship;
}

// MERGE: attaches this raw item to an EXISTING event as an additional
// source rather than creating a new one — for a duplicate/corroborating
// report of something already published. Per Decisions.md, a relay of the
// same originating source still counts as one underlying source, so the
// caller is expected to pass relationship: "relay" for that case (default
// here is "corroborating", i.e. a genuinely independent second source).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json()) as MergeBody;
  if (!body.eventId) return NextResponse.json({ error: "eventId is required" }, { status: 400 });

  const event = await prisma.event.findUnique({ where: { id: body.eventId } });
  if (!event) return NextResponse.json({ error: "Target event not found" }, { status: 404 });

  const relationship = body.relationship ?? "corroborating";
  await linkEventSource(body.eventId, id, relationship, relationship !== "relay");
  const item = await setProcessingStatus(id, "merged");
  return NextResponse.json(item);
}
