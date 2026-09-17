import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getRawIngestionItem } from "@/lib/db/repositories/raw-ingestion-items";
import { listExtractedFacts, toExtractedFactDTO } from "@/lib/db/repositories/extracted-facts";
import { findDuplicateCandidates } from "@/lib/ingestion/duplicates";
import { pickEffectiveFact, valuesDiffer } from "@/lib/ingestion/fact-diff";
import type { ExtractedFactDTO, ExtractedFactField, ExtractedFactsResponseDTO, MatchedEventFieldDiffDTO } from "@/lib/types/db";

// Fields that also exist as a real column on Event — the only ones a
// "differs from the matched event" comparison can meaningfully answer.
// Casualties/actors/infrastructure damage now DO have Event columns (see
// prisma/schema.prisma's Event model, added by Live Event Updates), but
// comparing against them belongs to the post-merge EventUpdateProposal
// pipeline instead — see MatchedEventFieldDiffDTO's own comment.
const COMPARABLE_FIELDS: ExtractedFactField[] = [
  "eventType",
  "title",
  "countryCode",
  "region",
  "latitude",
  "longitude",
  "severity",
  "conflictId",
];

function effectiveValue(facts: ExtractedFactDTO[], field: ExtractedFactField): string | null {
  return pickEffectiveFact(facts, field)?.value ?? null;
}

// Read-only: returns whatever is currently persisted (see
// lib/db/repositories/extracted-facts.ts) rather than recomputing on
// every call — unlike GET .../draft, extraction results are meant to
// survive across requests so an admin's accept/reject/edit decisions
// aren't lost. POST .../extract is the explicit "(re-)run extraction"
// action.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = await getRawIngestionItem(id);
  if (!item) return NextResponse.json({ error: "Item not found" }, { status: 404 });

  const factRows = await listExtractedFacts(id);
  const facts = factRows.map(toExtractedFactDTO);

  const lat = effectiveValue(facts, "latitude");
  const lng = effectiveValue(facts, "longitude");

  let matchedEvent: ExtractedFactsResponseDTO["matchedEvent"] = null;
  const fieldDiffs: MatchedEventFieldDiffDTO[] = [];

  if (lat !== null && lng !== null) {
    const eventType = effectiveValue(facts, "eventType") ?? "other";
    const candidates = await findDuplicateCandidates({
      title: effectiveValue(facts, "title") ?? item.originalTitle ?? "",
      eventType,
      latitude: Number(lat),
      longitude: Number(lng),
      countryCode: effectiveValue(facts, "countryCode"),
      region: effectiveValue(facts, "region"),
      conflictId: effectiveValue(facts, "conflictId"),
      occurredAt: item.publishedAt ?? item.receivedAt,
    });
    const top = candidates[0];
    if (top) {
      const event = await prisma.event.findUnique({ where: { id: top.eventId } });
      if (event) {
        matchedEvent = { eventId: event.id, slug: event.slug, title: event.title };
        const currentByField: Record<ExtractedFactField, string | null> = {
          eventType: event.eventType,
          title: event.title,
          countryCode: event.countryCode,
          region: event.region,
          latitude: String(event.latitude),
          longitude: String(event.longitude),
          severity: event.severity,
          conflictId: event.conflictId,
          // Fields with no Event column stay null and are filtered out below.
          summary: null,
          locationName: null,
          occurredAt: null,
          actor: null,
          casualtiesKilled: null,
          casualtiesInjured: null,
          infrastructureDamage: null,
        };
        for (const field of COMPARABLE_FIELDS) {
          const extracted = effectiveValue(facts, field);
          if (extracted === null) continue;
          const current = currentByField[field];
          fieldDiffs.push({ field, extractedValue: extracted, currentEventValue: current, differs: valuesDiffer(field, current, extracted) });
        }
      }
    }
  }

  return NextResponse.json({ facts, matchedEvent, fieldDiffs } satisfies ExtractedFactsResponseDTO);
}
