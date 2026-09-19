import type { Source } from "@prisma/client";
import type { RawIngestionItemDTO } from "@/lib/db/repositories/raw-ingestion-items";
import type { DraftSuggestionDTO } from "@/lib/types/db";
import { detectEventType, suggestSeverityAndImportance } from "@/lib/ingestion/event-type-keywords";
import { gazetteerPlaceNames, gazetteerLookup } from "@/lib/geocoding/gazetteer";
import { findConflictByCountryCode } from "@/lib/db/repositories/conflicts";
import { findDuplicateCandidates } from "@/lib/ingestion/duplicates";

/**
 * Automated draft extraction (spec §3) — a deterministic, dependency-free
 * heuristic (keyword matching + a curated gazetteer), deliberately NOT an
 * AI/LLM call: no external processing provider is configured for this
 * project yet, and every field here is explicitly a SUGGESTION the human
 * reviewer in /admin/incoming can freely override or ignore before
 * anything publishes — see app/admin/incoming/page.tsx's "Automated
 * Suggestion" section, kept visually distinct from "Source Data".
 *
 * Returns null when the source has automated processing disabled
 * (`source.autoProcessing`) — the review screen then shows source data
 * only, no suggestion section.
 */
export async function extractDraft(item: RawIngestionItemDTO, source: Source): Promise<DraftSuggestionDTO | null> {
  if (!source.autoProcessing) return null;

  const title = item.originalTitle ?? "";
  const text = `${title} ${item.originalText ?? ""}`;
  const eventType = detectEventType(text);
  const { severity, importance } = suggestSeverityAndImportance(text);

  const lowerText = text.toLowerCase();
  let matchedPlace: string | null = null;
  for (const name of gazetteerPlaceNames()) {
    if (lowerText.includes(name)) {
      matchedPlace = name;
      break;
    }
  }

  const candidates = matchedPlace ? gazetteerLookup(matchedPlace) : [];
  const resolved = candidates.length === 1 ? candidates[0]! : null;
  const locationSource: DraftSuggestionDTO["locationSource"] =
    candidates.length === 0 ? "none" : candidates.length === 1 ? "resolved" : "ambiguous";

  let conflictId: string | null = null;
  let conflictName: string | null = null;
  if (resolved?.countryCode) {
    const conflict = await findConflictByCountryCode(resolved.countryCode);
    if (conflict) {
      conflictId = conflict.id;
      conflictName = conflict.name;
    }
  }

  const occurredAt = item.publishedAt ?? item.receivedAt;
  const duplicates = resolved
    ? await findDuplicateCandidates({
        title,
        eventType,
        latitude: resolved.lat,
        longitude: resolved.lng,
        countryCode: resolved.countryCode ?? null,
        region: resolved.region ?? null,
        conflictId,
        occurredAt,
      })
    : [];

  return {
    eventType,
    countryCode: resolved?.countryCode ?? null,
    region: resolved?.region ?? null,
    locationName: matchedPlace ? toTitleCase(matchedPlace) : null,
    latitude: resolved?.lat ?? null,
    longitude: resolved?.lng ?? null,
    conflictId,
    conflictName,
    title: title || "Untitled report",
    // A starting point, not a finished summary — the review UI keeps this
    // editable and visually marked as a suggestion; publishing with an
    // unedited copy of source text is a human choice this system doesn't
    // prevent, but doesn't default to being safe to leave unedited either.
    summary: item.originalText || title,
    verificationStatus: "reported",
    importance,
    severity,
    locationSource,
    locationPrecision: resolved ? "approximate" : "unknown",
    locationCandidates: candidates,
    duplicates,
  };
}

function toTitleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}
