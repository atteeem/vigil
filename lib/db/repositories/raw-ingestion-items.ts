import { prisma } from "@/lib/db/client";
import type { RawIngestionItem } from "@prisma/client";
import type { ProcessingStatus } from "@/lib/types/db";

// SQLite has no array/json column type, so mediaUrls/rawMetadata are
// stored as JSON-encoded strings (see prisma/schema.prisma) and this
// repository is the one place that (de)serializes them — every caller
// works with real arrays/objects, never raw JSON strings.

export interface RawIngestionItemDTO extends Omit<RawIngestionItem, "mediaUrls" | "rawMetadata"> {
  mediaUrls: string[];
  rawMetadata: Record<string, unknown> | null;
}

export interface RawIngestionItemInput {
  sourceId: string;
  externalId: string;
  originalUrl?: string | null;
  originalTitle?: string | null;
  originalText?: string | null;
  language?: string | null;
  publishedAt?: Date | null;
  mediaUrls?: string[];
  rawMetadata?: Record<string, unknown> | null;
}

function toDTO(row: RawIngestionItem): RawIngestionItemDTO {
  return {
    ...row,
    mediaUrls: row.mediaUrls ? (JSON.parse(row.mediaUrls) as string[]) : [],
    rawMetadata: row.rawMetadata ? (JSON.parse(row.rawMetadata) as Record<string, unknown>) : null,
  };
}

export async function listRawIngestionItems(filter?: {
  processingStatus?: ProcessingStatus;
}): Promise<RawIngestionItemDTO[]> {
  const rows = await prisma.rawIngestionItem.findMany({
    where: filter?.processingStatus ? { processingStatus: filter.processingStatus } : undefined,
    orderBy: { receivedAt: "desc" },
  });
  return rows.map(toDTO);
}

export async function getRawIngestionItem(id: string): Promise<RawIngestionItemDTO | null> {
  const row = await prisma.rawIngestionItem.findUnique({ where: { id } });
  return row ? toDTO(row) : null;
}

/**
 * Creates a raw ingestion item unless one already exists for this
 * source+externalId (the ingestion-side "do not duplicate existing items"
 * requirement — see Map Requirements.md / the source-ingestion spec).
 * Returns the existing row (unchanged) on a duplicate rather than erroring,
 * since adapters call this unconditionally on every poll.
 */
export async function createRawIngestionItemIfNew(input: RawIngestionItemInput): Promise<{
  item: RawIngestionItemDTO;
  created: boolean;
}> {
  const existing = await prisma.rawIngestionItem.findUnique({
    where: { sourceId_externalId: { sourceId: input.sourceId, externalId: input.externalId } },
  });
  if (existing) return { item: toDTO(existing), created: false };

  const row = await prisma.rawIngestionItem.create({
    data: {
      sourceId: input.sourceId,
      externalId: input.externalId,
      originalUrl: input.originalUrl,
      originalTitle: input.originalTitle,
      originalText: input.originalText,
      language: input.language,
      publishedAt: input.publishedAt,
      mediaUrls: input.mediaUrls ? JSON.stringify(input.mediaUrls) : null,
      rawMetadata: input.rawMetadata ? JSON.stringify(input.rawMetadata) : null,
    },
  });
  return { item: toDTO(row), created: true };
}

export async function setProcessingStatus(id: string, status: ProcessingStatus): Promise<RawIngestionItemDTO> {
  const row = await prisma.rawIngestionItem.update({ where: { id }, data: { processingStatus: status } });
  return toDTO(row);
}
