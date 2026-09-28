import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { mergeReportIntoEvent } from "@/lib/ingestion/merge-report";
import type { EventSourceRelationship } from "@/lib/types/db";

interface MergeBody {
  eventId: string;
  relationship?: EventSourceRelationship;
}

// MERGE: attaches this raw item to an EXISTING event as an additional
// source rather than creating a new one — for a duplicate/corroborating
// report of something already published.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json()) as MergeBody;
  if (!body.eventId) return NextResponse.json({ error: "eventId is required" }, { status: 400 });

  const event = await prisma.event.findUnique({ where: { id: body.eventId } });
  if (!event) return NextResponse.json({ error: "Target event not found" }, { status: 404 });

  const outcome = await mergeReportIntoEvent(id, body.eventId, body.relationship);
  const item = await prisma.rawIngestionItem.findUnique({ where: { id } });
  return NextResponse.json({ ...item, proposalsCreated: outcome.proposalsCreated });
}
