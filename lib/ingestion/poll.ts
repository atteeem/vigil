import type { Source } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { getAdapter } from "@/lib/ingestion/registry";
import { extractDraft } from "@/lib/ingestion/draft";
import {
  createRawIngestionItemIfNew,
  setSuggestionSnapshot,
  type RawIngestionItemDTO,
} from "@/lib/db/repositories/raw-ingestion-items";
import {
  recordIngestionSuccess,
  recordIngestionError,
  recordAttemptStarted,
  scheduleNextPoll,
} from "@/lib/db/repositories/sources";
import { recordIngestionAttempt } from "@/lib/db/repositories/ingestion-logs";

export interface FetchResult {
  fetched: number;
  alreadyKnown: number;
  new: number;
  errors: number;
  error?: string;
}

// A hung external feed must not hang the whole ingestion pass or stall the
// sources behind it in a sequential poll — see lib/ingestion/scheduler.ts's
// per-source isolation via Promise.allSettled, and this per-fetch cutoff.
const FETCH_TIMEOUT_MS = 20_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

// Exponential backoff on repeated failures, capped — "sensible backoff"
// per spec, without a source that's down for a day hammering the network
// every poll interval. consecutiveFailures is read from the row *after*
// recordIngestionError's increment, so failure #1 already backs off 2x.
const MAX_BACKOFF_MULTIPLIER = 8;

function nextPollDelayMinutes(pollIntervalMinutes: number, consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) return pollIntervalMinutes;
  const multiplier = Math.min(2 ** consecutiveFailures, MAX_BACKOFF_MULTIPLIER);
  return pollIntervalMinutes * multiplier;
}

/** Runs the automated draft-extraction heuristic once for a freshly
 * created item and persists the result as a queue-filterable snapshot
 * (spec "Processing") — never blocks/fails the ingestion pass itself; a
 * snapshot failure is logged and left null rather than thrown, since the
 * review screen recomputes fresh regardless (see the schema comment on
 * RawIngestionItem). */
async function computeAndStoreSnapshot(item: RawIngestionItemDTO, source: Source): Promise<void> {
  try {
    const draft = await extractDraft(item, source);
    if (!draft) return; // autoProcessing is off for this source
    await setSuggestionSnapshot(item.id, {
      suggestedEventType: draft.eventType,
      suggestedConflictId: draft.conflictId,
      suggestedRegion: draft.region,
      suggestedCountryCode: draft.countryCode,
      suggestedLocationName: draft.locationName,
      suggestedLat: draft.latitude,
      suggestedLng: draft.longitude,
      suggestedSeverity: draft.severity,
      suggestedImportance: draft.importance,
      locationSource: draft.locationSource,
    });
  } catch (err) {
    console.error(`[ingestion] snapshot computation failed for item ${item.id}:`, err);
  }
}

/** Fetches, normalizes, and dedupes one source's latest items into
 * raw_ingestion_items — never publishes anything. Shared by the scheduler
 * (lib/ingestion/scheduler.ts, enabled+auto-ingest sources only, on their
 * own poll interval) and the admin "Fetch Now" action (any single source,
 * on demand, regardless of its auto-ingest flag). A fetch failure is
 * caught and recorded on the source (lastError, consecutiveFailures)
 * rather than thrown, so the caller always gets a result back instead of
 * an exception — one bad source can never break another (spec "Rate
 * limiting / failure handling"). Every attempt — success or failure —
 * marks lastAttemptedAt, writes an IngestionLog row, and reschedules
 * nextPollAt (with backoff on failure), so this is the single place all
 * of a source's health bookkeeping happens regardless of what triggered it. */
export async function pollSource(source: Source): Promise<FetchResult> {
  await recordAttemptStarted(source.id);
  try {
    const adapter = getAdapter(source.type);
    const rawItems = await withTimeout(adapter.fetchLatest(source), FETCH_TIMEOUT_MS, `Fetching ${source.name}`);
    let created = 0;
    const createdItems: RawIngestionItemDTO[] = [];
    for (const raw of rawItems) {
      const normalized = adapter.normalize(raw, source);
      const result = await createRawIngestionItemIfNew({ sourceId: source.id, ...normalized });
      if (result.created) {
        created++;
        createdItems.push(result.item);
      }
    }

    if (source.autoProcessing) {
      for (const item of createdItems) await computeAndStoreSnapshot(item, source);
    }

    const updated = await recordIngestionSuccess(source.id);
    await recordIngestionAttempt({
      sourceId: source.id,
      fetched: rawItems.length,
      newCount: created,
      alreadyKnown: rawItems.length - created,
      success: true,
    });
    await scheduleNextPoll(
      source.id,
      new Date(Date.now() + nextPollDelayMinutes(updated.pollIntervalMinutes, updated.consecutiveFailures) * 60_000),
    );
    return { fetched: rawItems.length, alreadyKnown: rawItems.length - created, new: created, errors: 0 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const updated = await recordIngestionError(source.id, message);
    await recordIngestionAttempt({ sourceId: source.id, fetched: 0, newCount: 0, alreadyKnown: 0, success: false, errorMessage: message });
    await scheduleNextPoll(
      source.id,
      new Date(Date.now() + nextPollDelayMinutes(updated.pollIntervalMinutes, updated.consecutiveFailures) * 60_000),
    );
    return { fetched: 0, alreadyKnown: 0, new: 0, errors: 1, error: message };
  }
}

/** One-off pass kept for tests/manual use: polls every enabled +
 * auto-ingest source once, regardless of nextPollAt. The real background
 * loop is lib/ingestion/scheduler.ts's schedulerTick(), which only polls
 * sources that are actually due — this is the "poll everything now"
 * building block that schedulerTick is not (and Fetch Now doesn't need,
 * since it targets one source directly via pollSource). */
export async function runIngestionPass(): Promise<{ sourcesPolled: number; itemsCreated: number }> {
  const sources = await prisma.source.findMany({ where: { enabled: true, autoIngest: true } });
  let itemsCreated = 0;
  for (const source of sources) {
    const result = await pollSource(source);
    itemsCreated += result.new;
  }
  return { sourcesPolled: sources.length, itemsCreated };
}
