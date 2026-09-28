import type { Source } from "@prisma/client";
import type { RawIngestionItemDTO } from "@/lib/db/repositories/raw-ingestion-items";
import type { DraftSuggestionDTO } from "@/lib/types/db";
import { detectEventType, suggestSeverityAndImportance } from "@/lib/ingestion/event-type-keywords";
import { gazetteerPlaceNames, gazetteerLookup } from "@/lib/geocoding/gazetteer";
import { resolveLocationScope, leadOf } from "@/lib/geocoding/location-scope";
import { deriveSummary, deriveTitle, cleanText } from "@/lib/ingestion/text-summary";
import { getCountryRecord } from "@/lib/countries/registry";
import { matchConflict, disambiguateCountryByConflictGeography } from "@/lib/ingestion/conflict-match";
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
  let loc = resolveLocationScope(title, cleanText(item.originalText));
  // "Russia attacks Ukraine..." named two different countries with nothing to prefer between them — if
  // they're the two sides of ONE tracked conflict, its own fighting geography (not a guess) disambiguates.
  if (loc.scope === "unknown" && loc.ambiguousCountryCodes) {
    const disambiguated = await disambiguateCountryByConflictGeography(loc.ambiguousCountryCodes);
    if (disambiguated) {
      loc = {
        ...loc,
        scope: "country",
        precision: "country",
        countryCode: disambiguated.code,
        countryName: disambiguated.name,
        evidence: `${loc.evidence} "${disambiguated.name}" is where the tracked conflict's fighting actually happens, so the report is kept at that country's level.`,
      };
    }
  }
  const lowerLead = leadOf(title, cleanText(item.originalText)).toLowerCase();
  const ambiguousName = gazetteerPlaceNames().find((n) => gazetteerLookup(n).length > 1 && lowerLead.includes(n));
  const candidates = ambiguousName ? gazetteerLookup(ambiguousName) : loc.scope === "city" ? gazetteerLookup(loc.city!.toLowerCase()) : [];
  const locationSource: DraftSuggestionDTO["locationSource"] = loc.scope === "city" ? "resolved" : ambiguousName && loc.scope !== "region" ? "ambiguous" : "none";

  const match = await matchConflict({ title, bodyText: cleanText(item.originalText), countryCode: loc.countryCode, eventType, sourceId: source.id });
  const conflictId = match.conflictId;
  const conflictName = match.conflictName;

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
    conflictMatchConfidence: match.matchConfidence,
    conflictMatchReasons: match.matchReasons,
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
    locationEvidenceSource: loc.evidenceSource,
    locationCandidates: candidates,
    duplicates,
  };
}

function toTitleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}
