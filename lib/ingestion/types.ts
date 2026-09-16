import type { Source } from "@prisma/client";

// Source-agnostic ingestion interface (Implementation Order #9 / Map
// Requirements spec §5). Adapters never touch map/UI components directly —
// they only ever produce NormalizedItem[], which route handlers hand to
// lib/db/repositories/raw-ingestion-items.ts. Flow: source → adapter →
// raw_ingestion_items → admin review → event → map.

export interface NormalizedItem {
  externalId: string;
  originalUrl?: string;
  originalTitle?: string;
  originalText?: string;
  language?: string;
  publishedAt?: Date;
  mediaUrls?: string[];
  rawMetadata?: Record<string, unknown>;
}

export interface HealthCheckResult {
  ok: boolean;
  message?: string;
}

export interface SourceAdapter {
  /** Fetches raw items from the external source. Adapter-specific shape,
   * passed straight into normalize(). Never throws for "no new items" —
   * returns an empty array instead; throws only for a genuine fetch
   * failure (network error, bad response), which callers record via
   * recordIngestionError(). */
  fetchLatest(source: Source): Promise<unknown[]>;
  normalize(raw: unknown, source: Source): NormalizedItem;
  healthCheck(source: Source): Promise<HealthCheckResult>;
}
