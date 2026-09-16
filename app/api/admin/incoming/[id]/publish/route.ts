import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import type { EventType, Severity } from "@/lib/types";
import type { DbVerificationStatus } from "@/lib/types/db";

interface PublishBody {
  title: string;
  summary: string;
  eventType: EventType;
  locationName?: string;
  latitude: number;
  longitude: number;
  countryCode?: string;
  region?: string;
  conflictId?: string | null;
  occurredAt: string;
  severity: Severity;
  importance?: number;
  verificationStatus?: DbVerificationStatus;
}

function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
  return `${base || "event"}-${Date.now().toString(36)}`;
}

// PUBLISH: creates a real Event from a reviewed raw_ingestion_item, links
// it as the event's originating source, and marks the raw item published.
// Never runs automatically — a human always submits this from
// /admin/incoming (spec §9: "Do NOT auto-publish initially.").
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json()) as PublishBody;

  if (!body.title || !body.summary || !body.eventType || body.latitude === undefined || body.longitude === undefined) {
    return NextResponse.json({ error: "title, summary, eventType, latitude, longitude are required" }, { status: 400 });
  }

  const rawItem = await prisma.rawIngestionItem.findUnique({ where: { id } });
  if (!rawItem) return NextResponse.json({ error: "Raw item not found" }, { status: 404 });
  if (rawItem.processingStatus === "published") {
    return NextResponse.json({ error: "This item has already been published." }, { status: 409 });
  }

  const event = await prisma.$transaction(async (tx) => {
    const created = await tx.event.create({
      data: {
        slug: slugify(body.title),
        title: body.title,
        summary: body.summary,
        eventType: body.eventType,
        locationName: body.locationName,
        latitude: body.latitude,
        longitude: body.longitude,
        countryCode: body.countryCode,
        region: body.region,
        conflictId: body.conflictId ?? null,
        occurredAt: new Date(body.occurredAt),
        severity: body.severity,
        importance: body.importance ?? 50,
        verificationStatus: body.verificationStatus ?? "reported",
        published: true,
      },
    });
    await tx.eventSource.create({
      data: {
        eventId: created.id,
        rawIngestionItemId: rawItem.id,
        relationship: "originating",
        isOriginatingSource: true,
      },
    });
    await tx.rawIngestionItem.update({ where: { id: rawItem.id }, data: { processingStatus: "published" } });
    return created;
  });

  return NextResponse.json(event, { status: 201 });
}
