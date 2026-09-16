import type { Source } from "@prisma/client";
import type { SourceAdapter, NormalizedItem, HealthCheckResult } from "@/lib/ingestion/types";

/**
 * Manual sources never auto-fetch — a human submits an item directly
 * (e.g. via /admin/sources "Test Source" or a future "Add Report" form),
 * which route handlers normalize through this adapter for a consistent
 * shape before writing to raw_ingestion_items.
 */
export const ManualSourceAdapter: SourceAdapter = {
  async fetchLatest(): Promise<unknown[]> {
    return [];
  },

  normalize(raw: unknown, source: Source): NormalizedItem {
    const input = raw as Partial<NormalizedItem> & { externalId?: string };
    return {
      externalId: input.externalId ?? crypto.randomUUID(),
      originalUrl: input.originalUrl,
      originalTitle: input.originalTitle,
      originalText: input.originalText,
      language: input.language ?? source.language ?? undefined,
      publishedAt: input.publishedAt ?? new Date(),
      mediaUrls: input.mediaUrls,
      rawMetadata: input.rawMetadata,
    };
  },

  async healthCheck(): Promise<HealthCheckResult> {
    return { ok: true, message: "Manual source — no automated fetch." };
  },
};
