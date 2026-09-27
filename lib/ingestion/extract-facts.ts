import type { RawIngestionItemDTO } from "@/lib/db/repositories/raw-ingestion-items";
import type { ExtractedFactField } from "@/lib/types/db";
import { detectEventType, suggestSeverityAndImportance, NON_CONFLICT_EVENT_TYPES } from "@/lib/ingestion/event-type-keywords";
import type { EventType } from "@/lib/types";
import { gazetteerPlaceNames, gazetteerLookup } from "@/lib/geocoding/gazetteer";
import { detectActors } from "@/lib/ingestion/actors";
import { extractKilled, extractInjured } from "@/lib/ingestion/casualties";
import { detectInfrastructureDamage } from "@/lib/ingestion/infrastructure-damage";
import { findConflictByCountryCode } from "@/lib/db/repositories/conflicts";

/**
 * Structured Event Intelligence (spec "Structured Event Intelligence") —
 * a deterministic, dependency-free heuristic extractor, deliberately NOT
 * an AI/LLM call (same reasoning as lib/ingestion/draft.ts: no external
 * processing provider is configured, and every fact here is an explicit,
 * individually reviewable SUGGESTION, never applied automatically).
 *
 * Distinct from draft.ts in three ways:
 *  1. Field-level granularity with confidence/provenance/observedAt per
 *     fact, not one flat suggestion object.
 *  2. A field can have MULTIPLE simultaneous facts — every actor named,
 *     every distinct casualty figure reported, every candidate for an
 *     ambiguous location — coexisting rather than the extractor picking
 *     a winner (spec "conflicting source values must coexist").
 *  3. "Unknown stays unknown": a field with no supporting evidence in
 *     the text produces NO fact at all, never a guessed or defaulted
 *     value — e.g. eventType is omitted entirely (not defaulted to
 *     "other") when no keyword matches, unlike draft.ts's
 *     always-fill-every-field DraftSuggestionDTO (which feeds a
 *     required publish form and has to default something).
 *
 * Pure with one exception: conflict-association lookup needs
 * findConflictByCountryCode, so this isn't a fully synchronous function
 * — but it never writes anything (see lib/db/repositories/extracted-
 * facts.ts for persistence, kept in a separate module on purpose).
 */
export interface ExtractedFactDraft {
  field: ExtractedFactField;
  value: string;
  confidence: number;
  source: string;
}

export async function extractFacts(item: RawIngestionItemDTO): Promise<ExtractedFactDraft[]> {
  const title = item.originalTitle ?? "";
  const body = item.originalText ?? "";
  const text = `${title} ${body}`;
  const facts: ExtractedFactDraft[] = [];

  // --- title: directly observed, not inferred ---
  if (title.trim()) {
    facts.push({ field: "title", value: title.trim(), confidence: 1, source: "original report title" });
  }

  // --- summary: verbatim source text, honestly labeled as such — this
  // heuristic extractor cannot genuinely paraphrase; the admin UI must
  // still require a human-paraphrased summary before publish (spec
  // "public summaries must remain paraphrased" — enforced at the review/
  // publish step, not here, since this module only proposes facts). ---
  if (body.trim()) {
    facts.push({
      field: "summary",
      value: body.trim(),
      confidence: 1,
      source: "verbatim original report text — must be independently paraphrased before publishing",
    });
  }

  // --- event type: omitted entirely when no keyword matches, never
  // defaulted to "other" (spec "unknown stays unknown"). ---
  const eventType = detectEventTypeIfMatched(text);
  if (eventType) {
    facts.push({ field: "eventType", value: eventType, confidence: 0.75, source: `keyword match in report text` });
  }

  // --- severity: always has a value (this heuristic has no "unknown"
  // severity concept, matching draft.ts), but confidence honestly
  // reflects whether real escalation language was found or it's just
  // the generic default. ---
  const { severity, importance, matchedEscalationLanguage } = suggestSeverityWithConfidence(text);
  facts.push({
    field: "severity",
    value: severity,
    confidence: matchedEscalationLanguage ? 0.7 : 0.35,
    source: matchedEscalationLanguage ? "casualty/escalation language in report text" : "no strong signal — generic default",
  });
  void importance; // importance isn't part of EXTRACTED_FACT_FIELDS; severity carries the signal

  // --- location: every gazetteer candidate becomes its own fact set
  // (locationName/countryCode/region/lat/lng), confidence lowered when
  // the match is ambiguous (spec "low-confidence geolocation"). ---
  const lowerText = text.toLowerCase();
  let matchedPlace: string | null = null;
  for (const name of gazetteerPlaceNames()) {
    if (lowerText.includes(name)) {
      matchedPlace = name;
      break;
    }
  }
  const locationCandidates = matchedPlace ? gazetteerLookup(matchedPlace) : [];
  const locationConfidence = locationCandidates.length === 1 ? 0.85 : locationCandidates.length > 1 ? 0.35 : 0;
  for (const candidate of locationCandidates) {
    const provenance =
      locationCandidates.length > 1
        ? `gazetteer match on "${matchedPlace}" — ambiguous, ${locationCandidates.length} possible locations`
        : `gazetteer match on "${matchedPlace}"`;
    facts.push({ field: "locationName", value: candidate.label, confidence: locationConfidence, source: provenance });
    facts.push({ field: "latitude", value: String(candidate.lat), confidence: locationConfidence, source: provenance });
    facts.push({ field: "longitude", value: String(candidate.lng), confidence: locationConfidence, source: provenance });
    if (candidate.countryCode) {
      facts.push({ field: "countryCode", value: candidate.countryCode, confidence: locationConfidence, source: provenance });
    }
    if (candidate.region) {
      facts.push({ field: "region", value: candidate.region, confidence: locationConfidence, source: provenance });
    }
  }

  // --- actors/organizations: every distinct actor named. ---
  for (const actor of detectActors(text)) {
    facts.push({
      field: "actor",
      value: actor.name,
      confidence: 0.7,
      source: `named in report text as "${actor.matchedText}"`,
    });
  }

  // --- casualties: every distinct figure reported, explicit numbers only. ---
  for (const killed of extractKilled(text)) {
    facts.push({
      field: "casualtiesKilled",
      value: String(killed.count),
      confidence: 0.75,
      source: `explicit figure in report text: "${killed.matchedText}"`,
    });
  }
  for (const injured of extractInjured(text)) {
    facts.push({
      field: "casualtiesInjured",
      value: String(injured.count),
      confidence: 0.75,
      source: `explicit figure in report text: "${injured.matchedText}"`,
    });
  }

  // --- infrastructure/damage: every distinct kind of damage named. ---
  for (const damage of detectInfrastructureDamage(text)) {
    facts.push({
      field: "infrastructureDamage",
      value: damage.phrase,
      confidence: 0.65,
      source: `keyword match in report text: "${damage.phrase}"`,
    });
  }

  // --- occurred at: from the source's own metadata, not inferred from
  // text — high confidence when the source provided a publish time,
  // lower when only our own receipt time is available. ---
  if (item.publishedAt) {
    facts.push({
      field: "occurredAt",
      value: item.publishedAt.toISOString(),
      confidence: 0.9,
      source: "source-provided publication timestamp",
    });
  } else {
    facts.push({
      field: "occurredAt",
      value: item.receivedAt.toISOString(),
      confidence: 0.5,
      source: "source did not provide a timestamp — using ingestion receipt time",
    });
  }

  // --- conflict association: only when a single, unambiguous country
  // resolved AND a matching seeded conflict exists — never guessed. ---
  const resolved = locationCandidates.length === 1 ? locationCandidates[0]! : null;
  if (resolved?.countryCode && eventType && !NON_CONFLICT_EVENT_TYPES.has(eventType as EventType)) {
    const conflict = await findConflictByCountryCode(resolved.countryCode);
    if (conflict) {
      facts.push({
        field: "conflictId",
        value: conflict.id,
        confidence: 0.7,
        source: `resolved location's country (${resolved.countryCode}) matches an active tracked conflict`,
      });
    }
  }

  return facts;
}

function detectEventTypeIfMatched(text: string): string | null {
  const detected = detectEventType(text);
  return detected === "other" ? null : detected;
}

function suggestSeverityWithConfidence(text: string): { severity: string; importance: number; matchedEscalationLanguage: boolean } {
  const { severity, importance } = suggestSeverityAndImportance(text);
  // suggestSeverityAndImportance's own default is "elevated"/50 for both
  // "nothing matched" and "explicit negation found" — only the "high"
  // branch reflects a genuine textual signal being present.
  return { severity, importance, matchedEscalationLanguage: severity === "high" };
}
