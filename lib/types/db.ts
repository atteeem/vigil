// Type-level boundary for the SQLite/Prisma local-development database.
// SQLite has no native enum type (see prisma/schema.prisma), so every
// enum-shaped column is a plain String there — these unions are what
// validate/constrain those strings at the TypeScript boundary, the same
// "validate at the boundary" pattern the mock-data layer uses with Zod.
//
// These are intentionally separate from lib/types/severity.ts's
// VerificationStatus (used throughout the existing mock-data UI) rather
// than modified in place — this is new, parallel ingestion-pipeline
// infrastructure, not a change to the Phase 1/1.5 mock-data shape.

export const SOURCE_TYPES = ["rss", "telegram", "manual"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const PERMISSION_STATUSES = ["authorized", "unauthorized", "pending"] as const;
export type PermissionStatus = (typeof PERMISSION_STATUSES)[number];

// Source trust model (spec "Source Trust Model" — deliberately not a
// trusted/untrusted boolean). Complements the free-text sourceCategory
// (e.g. "News") and reliabilityTier (e.g. "A") fields with a controlled
// vocabulary describing what KIND of source this is.
export const SOURCE_ROLES = [
  "originating",
  "relay",
  "official",
  "local_media",
  "eyewitness_community",
  "aggregator",
] as const;
export type SourceRole = (typeof SOURCE_ROLES)[number];

export const PROCESSING_STATUSES = ["pending", "published", "rejected", "merged"] as const;
export type ProcessingStatus = (typeof PROCESSING_STATUSES)[number];

// The six verification states from Decisions.md (D:\GLOBAL CONFLICT
// CLAUDE\Decisions.md § Source verification) — note "disputed" is a full
// status here, unlike the mock-data VerificationStatus type where it's a
// separate boolean flag alongside a 5-value status.
export const DB_VERIFICATION_STATUSES = [
  "unverified",
  "reported",
  "official_claim",
  "multiple_sources",
  "confirmed",
  "disputed",
] as const;
export type DbVerificationStatus = (typeof DB_VERIFICATION_STATUSES)[number];

export const EVENT_SOURCE_RELATIONSHIPS = ["originating", "relay", "corroborating"] as const;
export type EventSourceRelationship = (typeof EVENT_SOURCE_RELATIONSHIPS)[number];

// Event lifecycle status (admin event management). Derived, not a stored
// enum column — see lib/data/event-status.ts. "draft" and "unpublished"
// both mean Event.published === false; they're distinguished by whether
// publishedAt has ever been set (Event.publishedAt is set once on first
// publish and is never cleared by Unpublish).
export const EVENT_STATUSES = ["draft", "published", "unpublished"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

// Plain JSON-response shapes for the admin UI (client components fetch
// these from app/api/admin/*, never import @prisma/client directly — the
// UI layer only ever depends on this file, not on Prisma's generated types).
export interface SourceDTO {
  id: string;
  name: string;
  type: SourceType;
  url: string | null;
  telegramHandle: string | null;
  country: string | null;
  region: string | null;
  language: string | null;
  sourceCategory: string | null;
  reliabilityTier: string | null;
  sourceRole: SourceRole | null;
  permissionStatus: PermissionStatus;
  enabled: boolean;
  autoIngest: boolean;
  autoProcessing: boolean;
  pollIntervalMinutes: number;
  nextPollAt: string | null;
  lastAttemptedAt: string | null;
  consecutiveFailures: number;
  lastSuccessfulIngestion: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  /** Raw items received today — only present on the /admin/sources list response. */
  itemsToday?: number;
  /** Sum of IngestionLog.newCount for today's attempts — distinct from
   * itemsToday when a feed re-serves already-known items on most polls. */
  newItemsToday?: number;
  /** Count of failed IngestionLog rows today. */
  errorsToday?: number;
  /** "live" (healthy, recent or no attempts yet) | "error" (lastError set)
   * | "disabled" (enabled: false) — computed by the API, not stored. */
  health?: "live" | "error" | "disabled";
}

export const CONFLICT_STATUSES = ["active", "dormant", "resolved", "archived"] as const;
export type ConflictStatus = (typeof CONFLICT_STATUSES)[number];

export interface ConflictDTO {
  id: string;
  slug: string;
  name: string;
  shortName: string | null;
  region: string;
  status: ConflictStatus;
  severity: string;
  intensity: number;
  startedAt: string | null;
  lat: number | null;
  lng: number | null;
  countries: string[];
  summary: string | null;
  createdAt: string;
  updatedAt: string;
  /** Only present on the /admin/conflicts list response. */
  eventCount?: number;
}

export interface DuplicateCandidateDTO {
  eventId: string;
  slug: string;
  title: string;
  /** For the reviewer's context (spec "Event-Matching UX": "existing
   * event title, event type, location, event time") — not used in
   * scoring beyond what sameEventType/sameRegionOrCountry already
   * summarize. */
  eventType: string;
  region: string | null;
  countryCode: string | null;
  occurredAt: string; // ISO datetime
  score: number; // 0-100
  distanceKm: number | null;
  minutesApart: number | null;
  sameEventType: boolean;
  /** Same event, or an event in the same broad category (e.g. airstrike
   * vs explosion) — as opposed to a genuinely incompatible pairing (e.g.
   * earthquake vs explosion), which actively lowers the score rather
   * than merely not contributing to it (spec "incompatible event types
   * should reduce or eliminate a match"). */
  eventTypeCompatible: boolean;
  sameConflict: boolean;
  sameRegionOrCountry: boolean;
  titleSimilarity: number; // 0-1
  /** Short, human-readable explanations for the score (spec "component
   * scores or matching reasons where practical") — e.g. "0.3 km away",
   * "12 min apart", "same conflict". Always at least one entry. */
  reasons: string[];
}

export interface LocationCandidateDTO {
  label: string;
  lat: number;
  lng: number;
  countryCode?: string;
  region?: string;
}

export interface DraftSuggestionDTO {
  eventType: string;
  countryCode: string | null;
  region: string | null;
  locationName: string | null;
  latitude: number | null;
  longitude: number | null;
  conflictId: string | null;
  conflictName: string | null;
  title: string;
  summary: string;
  verificationStatus: DbVerificationStatus;
  importance: number;
  severity: string;
  /** "resolved": exactly one gazetteer/geocoder match, used to fill lat/lng.
   * "ambiguous": multiple candidates found — never auto-picked, human must
   * choose (spec §4). "none": no place name recognized in the text. */
  locationSource: "resolved" | "ambiguous" | "none";
  locationCandidates: LocationCandidateDTO[];
  duplicates: DuplicateCandidateDTO[];
}

export const DUPLICATE_LIKELIHOODS = ["none", "low", "medium", "high"] as const;
export type DuplicateLikelihood = (typeof DUPLICATE_LIKELIHOODS)[number];

export const INCOMING_SORTS = ["newest", "oldest", "importance", "duplicate"] as const;
export type IncomingSort = (typeof INCOMING_SORTS)[number];

/** Event-level corroboration metadata (spec "Event corroboration
 * metadata"): purely descriptive of how many reports/sources back an
 * already-published event, and from what kinds of sources — NOT a
 * credibility or truth score. Multiple sources corroborating each other
 * doesn't make an event more true, only more independently reported; the
 * admin UI must present these fields as "N sources say this happened",
 * never as a verdict. Computed fresh from Event.sources at read time
 * (same "derive, don't store" pattern as Event.sourceCount) — no new
 * schema needed. */
export interface EventCorroborationDTO {
  /** Every linked report, including relays of the same originating
   * source — "how many times has this been reported," not "by how many
   * independent parties." */
  supportingReportCount: number;
  /** Only originating/corroborating links (mirrors ConflictEvent.sourceCount)
   * — a relay of the same originating report does not add to this. */
  independentSourceCount: number;
  /** Distinct SourceRef.sourceType values represented, e.g. ["Wire", "OSINT"]
   * — powers UI text like "Official + local media". */
  sourceCategories: string[];
  /** ISO timestamp of the earliest linked report (first time this was
   * reported by anyone). */
  earliestSourceAt: string;
  /** ISO timestamp of the most recent linked report — "last corroborated
   * N minutes/hours ago". */
  latestCorroborationAt: string;
}

/** Admin-only view of an event: the same shape the public UI uses
 * (title/type/location/sources/etc., via dbEventToConflictEvent), plus
 * lifecycle fields the public /world and /event/[slug] pages never need.
 * Deliberately NOT merged into ConflictEvent (lib/types/event.ts) — that
 * type is shared by public-facing components and has no business knowing
 * about draft/unpublished state. */
export interface EventAdminDTO {
  id: string;
  slug: string;
  title: string;
  summary: string;
  eventType: string;
  countryCode: string;
  region: string;
  occurredAt: string;
  status: EventStatus;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  conflictId: string | null;
  sourceCount: number;
  supportingReportCount: number;
}

export interface RawIngestionItemWithSourceDTO {
  id: string;
  sourceId: string;
  externalId: string;
  originalUrl: string | null;
  originalTitle: string | null;
  originalText: string | null;
  language: string | null;
  publishedAt: string | null;
  receivedAt: string;
  mediaUrls: string[];
  processingStatus: ProcessingStatus;
  rawMetadata: Record<string, unknown> | null;
  source: SourceDTO;
  /** Suggestion SNAPSHOT taken once at ingestion time (spec "Processing")
   * — for queue filtering/sorting/preview only. The review screen's own
   * `GET .../draft` call always recomputes fresh; never trust this snapshot
   * as the thing a human actually reviewed. Absent (all null) when the
   * source has autoProcessing: false, or not yet processed. */
  suggestedEventType: string | null;
  suggestedConflictId: string | null;
  suggestedRegion: string | null;
  suggestedCountryCode: string | null;
  suggestedLocationName: string | null;
  suggestedLat: number | null;
  suggestedLng: number | null;
  suggestedSeverity: string | null;
  suggestedImportance: number | null;
  locationSource: "resolved" | "ambiguous" | "none" | null;
  processedAt: string | null;
  /** Computed fresh at list-read time (never snapshotted — see
   * prisma/schema.prisma's comment on why), only for pending items with a
   * resolved suggested location. Powers the "prominent" duplicate badge and
   * the duplicate-likelihood filter/sort (spec §7/§8) without requiring
   * Review to be clicked first. */
  topDuplicate: DuplicateCandidateDTO | null;
  duplicateLikelihood: DuplicateLikelihood;
}

// Structured Event Intelligence (spec "Structured Event Intelligence").
// One field per individually-extractable fact; a raw item can have MORE
// THAN ONE ExtractedFactDTO for the same field name at once (see
// EXTRACTED_FACT_FIELDS_MULTI below) — that's how conflicting source
// claims (two different casualty counts, several named actors, an
// ambiguous location's several candidates) coexist instead of one
// silently overwriting another.
export const EXTRACTED_FACT_FIELDS = [
  "eventType",
  "title",
  "summary",
  "countryCode",
  "region",
  "locationName",
  "latitude",
  "longitude",
  "occurredAt",
  "actor",
  "casualtiesKilled",
  "casualtiesInjured",
  "infrastructureDamage",
  "severity",
  "conflictId",
] as const;
export type ExtractedFactField = (typeof EXTRACTED_FACT_FIELDS)[number];

/** Fields where multiple simultaneous rows are the expected, normal case
 * (every actor mentioned; every distinct casualty figure reported) rather
 * than a sign of ambiguity — used only to choose UI copy ("N reported
 * values" vs. "N candidates"), never to change extraction or storage
 * behavior, which already allows any field to have multiple rows. */
export const EXTRACTED_FACT_FIELDS_MULTI: ReadonlySet<ExtractedFactField> = new Set([
  "actor",
  "casualtiesKilled",
  "casualtiesInjured",
  "infrastructureDamage",
]);

export const EXTRACTED_FACT_STATUSES = ["extracted", "accepted", "rejected", "edited"] as const;
export type ExtractedFactStatus = (typeof EXTRACTED_FACT_STATUSES)[number];

export interface ExtractedFactDTO {
  id: string;
  field: ExtractedFactField;
  value: string;
  confidence: number; // 0-1
  source: string; // provenance: what evidence/reasoning produced this claim
  observedAt: string; // ISO — the report's own timestamp, not extraction time
  status: ExtractedFactStatus;
  originalValue: string | null; // set only once a fact has been edited
  extractedAt: string; // ISO — when this row was computed
}

/** Only for fields that also exist on the Event table — casualties,
 * actors, and infrastructure damage have nowhere on Event to compare
 * against (deliberately: this milestone adds no Event columns), so they
 * never appear here even if extracted. */
export interface MatchedEventFieldDiffDTO {
  field: ExtractedFactField;
  extractedValue: string;
  currentEventValue: string | null;
  differs: boolean;
}

export interface ExtractedFactsResponseDTO {
  facts: ExtractedFactDTO[];
  /** The same top duplicate-candidate event this item's Review screen
   * already surfaces (spec "if an existing event match exists, show
   * which fields differ") — null when no candidate clears the existing
   * duplicate-matching threshold. */
  matchedEvent: { eventId: string; slug: string; title: string } | null;
  fieldDiffs: MatchedEventFieldDiffDTO[];
}
