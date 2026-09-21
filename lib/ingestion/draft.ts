import type { Source } from "@prisma/client";
import type { RawIngestionItemDTO } from "@/lib/db/repositories/raw-ingestion-items";
import type { DraftSuggestionDTO } from "@/lib/types/db";
import { detectEventType, suggestSeverityAndImportance } from "@/lib/ingestion/event-type-keywords";
import { gazetteerPlaceNames, gazetteerLookup } from "@/lib/geocoding/gazetteer";
import { resolveLocationScope, leadOf } from "@/lib/geocoding/location-scope";
import { deriveSummary, deriveTitle, cleanText } from "@/lib/ingestion/text-summary";
import { getCountryRecord } from "@/lib/countries/registry";
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
export async function extractDraft(item: RawIngestionItemDTO, source: Source, opts: { skipDuplicates?: boolean } = {}): Promise<DraftSuggestionDTO | null> {
  if (!source.autoProcessing) return null;

  const titleResult = deriveTitle(item.originalTitle, item.originalText);
  const title = titleResult.title;
  const text = `${title} ${cleanText(item.originalText)}`;
  const eventType = detectEventType(text);
  const { severity, importance } = suggestSeverityAndImportance(text);

  // Hierarchical location (city > region > country > unknown) from the headline and the opening text only.
  // Ambiguous gazetteer names are surfaced as candidates for the reviewer, never auto-picked.
  const loc = resolveLocationScope(title, cleanText(item.originalText));
  const lowerLead = leadOf(title, cleanText(item.originalText)).toLowerCase();
  const ambiguousName = gazetteerPlaceNames().find((n) => gazetteerLookup(n).length > 1 && lowerLead.includes(n));
  const candidates = ambiguousName ? gazetteerLookup(ambiguousName) : loc.scope === "city" ? gazetteerLookup(loc.city!.toLowerCase()) : [];
  const locationSource: DraftSuggestionDTO["locationSource"] = loc.scope === "city" ? "resolved" : ambiguousName && loc.scope !== "region" ? "ambiguous" : "none";

  let conflictId: string | null = null;
  let conflictName: string | null = null;
  if (loc.countryCode) {
    const conflict = await findConflictByCountryCode(loc.countryCode);
    if (conflict) {
      conflictId = conflict.id;
      conflictName = conflict.name;
    }
  }

  const occurredAt = item.publishedAt ?? item.receivedAt;
  const duplicates =
    !opts.skipDuplicates && loc.latitude != null && loc.longitude != null
      ? await findDuplicateCandidates({ title, eventType, latitude: loc.latitude, longitude: loc.longitude, countryCode: loc.countryCode, region: null, conflictId, occurredAt })
      : [];
  const summary = await deriveSummary(title, item.originalText);
  const macroRegion = loc.countryCode ? (getCountryRecord(loc.countryCode)?.region ?? null) : null;

  return {
    eventType,
    countryCode: loc.countryCode,
    countryName: loc.countryName,
    region: macroRegion,
    adminRegion: loc.adminRegion,
    city: loc.city,
    locationName: loc.city ?? loc.adminRegion ?? loc.countryName,
    latitude: loc.latitude,
    longitude: loc.longitude,
    conflictId,
    conflictName,
    title,
    titleSource: titleResult.source,
    summary: summary.summary,
    summarySource: summary.source,
    verificationStatus: "reported",
    importance,
    severity,
    locationSource,
    locationPrecision: loc.precision,
    locationScope: loc.scope,
    locationEvidence: [loc.evidence, ...loc.notes].join(" "),
    locationCandidates: candidates,
    duplicates,
  };
}

function toTitleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}
