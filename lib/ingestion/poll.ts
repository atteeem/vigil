import { prisma } from "@/lib/db/client";
import { getAdapter } from "@/lib/ingestion/registry";
import { createRawIngestionItemIfNew } from "@/lib/db/repositories/raw-ingestion-items";
import { recordIngestionSuccess, recordIngestionError } from "@/lib/db/repositories/sources";

/** One ingestion pass: every enabled + auto-ingest source is polled once,
 * new items are written to raw_ingestion_items (deduplicated on
 * source+externalId — see createRawIngestionItemIfNew), nothing is
 * auto-published. Safe to call concurrently/repeatedly; a source with a
 * fetch error is recorded on the source (lastError) and skipped, not
 * thrown, so one broken feed can't stop the rest of the pass. */
export async function runIngestionPass(): Promise<{ sourcesPolled: number; itemsCreated: number }> {
  const sources = await prisma.source.findMany({ where: { enabled: true, autoIngest: true } });
  let itemsCreated = 0;

  for (const source of sources) {
    try {
      const adapter = getAdapter(source.type);
      const rawItems = await adapter.fetchLatest(source);
      for (const raw of rawItems) {
        const normalized = adapter.normalize(raw, source);
        const { created } = await createRawIngestionItemIfNew({ sourceId: source.id, ...normalized });
        if (created) itemsCreated++;
      }
      await recordIngestionSuccess(source.id);
    } catch (err) {
      await recordIngestionError(source.id, err instanceof Error ? err.message : String(err));
    }
  }

  return { sourcesPolled: sources.length, itemsCreated };
}

const DEFAULT_POLL_INTERVAL_MS = 60_000;

/** Starts the server-side poll loop once per server process. Guarded by a
 * global flag the same way lib/db/client.ts guards the PrismaClient
 * singleton, so a dev-mode hot reload never stacks up duplicate intervals.
 * Called from instrumentation.ts on server startup. */
export function startIngestionPolling(intervalMs = DEFAULT_POLL_INTERVAL_MS) {
  const g = globalThis as unknown as { __vigilIngestionPolling?: boolean };
  if (g.__vigilIngestionPolling) return;
  g.__vigilIngestionPolling = true;

  console.log(`[ingestion] poller started (interval ${intervalMs}ms)`);
  const tick = () => {
    runIngestionPass()
      .then(({ sourcesPolled, itemsCreated }) => {
        if (sourcesPolled > 0) console.log(`[ingestion] pass: ${sourcesPolled} source(s) polled, ${itemsCreated} new item(s)`);
      })
      .catch((err) => console.error("[ingestion] poll pass failed:", err));
  };
  tick();
  setInterval(tick, intervalMs);
}
