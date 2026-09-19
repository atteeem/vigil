import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { listAllEventsWithSources } from "@/lib/db/repositories/events";
import { toEventAdminDTO } from "@/lib/data/world-events";
import { createEventInput } from "@/lib/data/event-input";

// Admin event list (spec "event management in admin"): every event
// regardless of lifecycle status, unlike the public GET /api/events
// (published: true only) — an admin needs to see and manage drafts and
// unpublished events too.
export async function GET() {
  const events = await listAllEventsWithSources();
  return NextResponse.json(events.map(toEventAdminDTO));
}

function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
  return `${base || "event"}-${Date.now().toString(36)}`;
}

// Manual event creation (spec "Manual Event Creation"): unlike the
// incoming-queue Publish flow, there is no pre-existing RawIngestionItem
// to review — the admin supplies both the event fields AND the source
// attribution directly. Attribution is required (a manual Source +
// RawIngestionItem is always created), the "clean manual-source path"
// alternative the spec allows for when a schema-enforced sourceless event
// would need special-casing everywhere else (corroboration math,
// event-detail Sources list, etc. all assume >=1 EventSource). The source
// itself is created with type: "manual", which is how the app already
// labels manually-obtained reports (see lib/ingestion/manual-adapter.ts).
export async function POST(request: Request) {
  const parsed = createEventInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid event fields or source attribution." }, { status: 400 });
  const body = parsed.data;

  const event = await prisma.$transaction(async (tx) => {
    let source = await tx.source.findFirst({ where: { name: body.sourceName.trim(), type: "manual" } });
    if (!source) {
      source = await tx.source.create({
        data: {
          name: body.sourceName.trim(),
          type: "manual",
          sourceCategory: body.sourceCategory?.trim() || "Manual entry",
          autoIngest: false,
        },
      });
    }

    const rawItem = await tx.rawIngestionItem.create({
      data: {
        sourceId: source.id,
        externalId: `manual-event-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        originalUrl: body.sourceUrl?.trim() || null,
        originalTitle: body.title,
        originalText: body.summary,
        publishedAt: new Date(body.occurredAt),
        processingStatus: "published",
      },
    });

    const created = await tx.event.create({
      data: {
        slug: slugify(body.title),
        title: body.title,
        summary: body.summary,
        eventType: body.eventType,
        locationName: body.locationName || null,
        latitude: body.latitude,
        longitude: body.longitude,
        locationPrecision: body.locationPrecision ?? null,
        countryCode: body.countryCode || null,
        region: body.region || null,
        conflictId: body.conflictId || null,
        occurredAt: new Date(body.occurredAt),
        severity: body.severity,
        importance: body.importance ?? 50,
        verificationStatus: body.verificationStatus ?? "reported",
        published: body.published,
        publishedAt: body.published ? new Date() : null,
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

    return created;
  });

  return NextResponse.json(event, { status: 201 });
}
