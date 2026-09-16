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
  permissionStatus: PermissionStatus;
  enabled: boolean;
  autoIngest: boolean;
  lastSuccessfulIngestion: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
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
}
