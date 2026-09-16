import type { Source } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { getAdapter } from "@/lib/ingestion/registry";
import { createRawIngestionItemIfNew } from "@/lib/db/repositories/raw-ingestion-items";
import { recordIngestionSuccess, recordIngestionError } from "@/lib/db/repositories/sources";

export interface FetchResult {
  fetched: number;
  alreadyKnown: number;
  new: number;
  errors: number;
  error?: string;
}

/** Fetches, normalizes, and dedupes one source's latest items into
 * raw_ingestion_items — never publishes anything. Shared by the
 * background poller (runIngestionPass, enabled+auto-ingest sources only)
 * and the admin "Fetch Now" action (any single source, on demand,
 * regardless of its auto-ingest flag). A fetch failure is caught and
 * recorded on the source (lastError) rather than thrown, so the caller
 * always gets a result back instead of an exception. */
export async function pollSource(source: Source): Promise<FetchResult> {
  try {
    const adapter = getAdapter(source.type);
    const rawItems = await adapter.fetchLatest(source);
    let created = 0;
    for (const raw of rawItems) {
      const normalized = adapter.normalize(raw, source);
      const result = await createRawIngestionItemIfNew({ sourceId: source.id, ...normalized });
      if (result.created) created++;
    }
    await recordIngestionSuccess(source.id);
    return { fetched: rawItems.length, alreadyKnown: rawItems.length - created, new: created, errors: 0 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordIngestionError(source.id, message);
    return { fetched: 0, alreadyKnown: 0, new: 0, errors: 1, error: message };
  }
}

/** One ingestion pass: every enabled + auto-ingest source is polled once
 * via pollSource. Safe to call concurrently/repeatedly. */
export async function runIngestionPass(): Promise<{ sourcesPolled: number; itemsCreated: number }> {
  const sources = await prisma.source.findMany({ where: { enabled: true, autoIngest: true } });
  let itemsCreated = 0;
  for (const source of sources) {
    const result = await pollSource(source);
    itemsCreated += result.new;
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
