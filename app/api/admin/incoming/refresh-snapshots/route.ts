import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getSource } from "@/lib/db/repositories/sources";
import { computeAndStoreSnapshot } from "@/lib/ingestion/poll";
import type { RawIngestionItemDTO } from "@/lib/db/repositories/raw-ingestion-items";

// Real-data audit finding: a pending item's suggested_* columns are a SNAPSHOT computed once, right after
// ingestion (lib/ingestion/poll.ts) — never recomputed on their own afterwards. When the draft-extraction
// heuristic improves (e.g. the hierarchical location-scope resolver added after most of the current backlog
// was ingested), every item ingested before that change keeps its OLD suggestion, and the admin queue's own
// country/conflict/region/event-type filters read from exactly that stale snapshot — so "Publish filtered" by
// country could silently miss reports the CURRENT extractor would resolve correctly. This action re-runs the
// same computeAndStoreSnapshot() ingestion already uses for new items, over existing PENDING ones, in bounded
// batches (`limit`, default 500) so one call can't run unbounded across a large backlog. It only ever touches
// the suggestion snapshot, never processingStatus or anything a human already reviewed.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { limit?: number; sourceId?: string };
  const limit = Math.min(Math.max(1, body.limit ?? 500), 2000);
  const items = await prisma.rawIngestionItem.findMany({
    where: { processingStatus: "pending", ...(body.sourceId ? { sourceId: body.sourceId } : {}) },
    orderBy: { receivedAt: "asc" },
    take: limit,
  });

  const sourceCache = new Map<string, Awaited<ReturnType<typeof getSource>>>();
  let refreshed = 0;
  let skippedNoAutoProcessing = 0;
  for (const row of items) {
    await new Promise<void>((resolve) => setImmediate(resolve)); // synchronous DB work per item; yield between items
    let source = sourceCache.get(row.sourceId);
    if (source === undefined) {
      source = await getSource(row.sourceId);
      sourceCache.set(row.sourceId, source);
    }
    if (!source) continue;
    if (!source.autoProcessing) {
      skippedNoAutoProcessing++;
      continue;
    }
    const dto: RawIngestionItemDTO = { ...row, mediaUrls: row.mediaUrls ? (JSON.parse(row.mediaUrls) as string[]) : [], rawMetadata: row.rawMetadata ? (JSON.parse(row.rawMetadata) as Record<string, unknown>) : null };
    await computeAndStoreSnapshot(dto, source);
    refreshed++;
  }
  return NextResponse.json({ considered: items.length, refreshed, skippedNoAutoProcessing, exhausted: items.length < limit });
}
