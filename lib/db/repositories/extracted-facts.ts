import { prisma } from "@/lib/db/client";
import type { ExtractedFact } from "@prisma/client";
import type { ExtractedFactDTO, ExtractedFactField, ExtractedFactStatus } from "@/lib/types/db";
import type { ExtractedFactDraft } from "@/lib/ingestion/extract-facts";

export function toExtractedFactDTO(fact: ExtractedFact): ExtractedFactDTO {
  return {
    id: fact.id,
    field: fact.field as ExtractedFactField,
    value: fact.value,
    confidence: fact.confidence,
    source: fact.source,
    observedAt: fact.observedAt.toISOString(),
    status: fact.status as ExtractedFactStatus,
    originalValue: fact.originalValue,
    extractedAt: fact.extractedAt.toISOString(),
  };
}

export function listExtractedFacts(rawIngestionItemId: string): Promise<ExtractedFact[]> {
  return prisma.extractedFact.findMany({
    where: { rawIngestionItemId },
    orderBy: [{ field: "asc" }, { confidence: "desc" }],
  });
}

/** Replaces this item's untouched ("extracted") facts with a fresh batch,
 * while leaving any fact the admin already dispositioned (accepted,
 * rejected, or edited) exactly as it is — an admin's decision is durable
 * across re-extraction (e.g. after the admin edits the raw text and
 * re-runs extraction), not silently discarded. Runs as one transaction
 * so a re-extraction is never left half-applied. */
export async function replaceExtractedFacts(
  rawIngestionItemId: string,
  drafts: ExtractedFactDraft[],
  observedAt: Date,
): Promise<ExtractedFact[]> {
  return prisma.$transaction(async (tx) => {
    await tx.extractedFact.deleteMany({ where: { rawIngestionItemId, status: "extracted" } });
    if (drafts.length > 0) {
      await tx.extractedFact.createMany({
        data: drafts.map((d) => ({
          rawIngestionItemId,
          field: d.field,
          value: d.value,
          confidence: d.confidence,
          source: d.source,
          observedAt,
          status: "extracted",
        })),
      });
    }
    return tx.extractedFact.findMany({
      where: { rawIngestionItemId },
      orderBy: [{ field: "asc" }, { confidence: "desc" }],
    });
  });
}

/** Accept or reject a fact as-is — no value change, so originalValue
 * stays untouched. */
export function setExtractedFactStatus(factId: string, status: "accepted" | "rejected"): Promise<ExtractedFact> {
  return prisma.extractedFact.update({ where: { id: factId }, data: { status } });
}

/** Editing a fact's value preserves the value it's replacing in
 * originalValue (unless it's already been edited before, in which case
 * the very first extracted value — the true original — is kept, not
 * overwritten by the most recent edit) — spec "preserve original
 * wording/source evidence... for provenance". */
export async function editExtractedFactValue(factId: string, newValue: string): Promise<ExtractedFact> {
  const existing = await prisma.extractedFact.findUniqueOrThrow({ where: { id: factId } });
  return prisma.extractedFact.update({
    where: { id: factId },
    data: {
      value: newValue,
      status: "edited" satisfies ExtractedFactStatus,
      originalValue: existing.originalValue ?? existing.value,
    },
  });
}
