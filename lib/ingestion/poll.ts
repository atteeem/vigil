import type { Source } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { getAdapter } from "@/lib/ingestion/registry";
import { extractDraft } from "@/lib/ingestion/draft";
import { extractFacts } from "@/lib/ingestion/extract-facts";
import { replaceExtractedFacts } from "@/lib/db/repositories/extracted-facts";
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
import { HttpFetchError } from "@/lib/ingestion/errors";
import { extractUnitMentions, extractCommanderMentions, extractEquipmentMentions } from "@/lib/military/extract-entities";
import {
  findOrCreateMilitaryUnit,
  findOrCreateMilitaryEquipment,
  findOrCreateCommander,
  linkArticleToUnit,
  linkArticleToEquipment,
  linkArticleToCommander,
} from "@/lib/db/repositories/military";

export interface FetchResult {
  fetched: number;
  alreadyKnown: number;
  new: number;
  errors: number;
  error?: string;
}

// A hung external feed must not hang the whole ingestion pass or stall the
// sources behind it — see lib/ingestion/scheduler.ts's bounded-concurrency
// worker pool, and this per-fetch cutoff. Overridable via env so
// tests/ingestion-reliability.spec.ts can exercise an actual timeout in
// well under a second instead of waiting out a real 20s.
const FETCH_TIMEOUT_MS = Number(process.env.INGESTION_FETCH_TIMEOUT_MS) || 20_000;

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

/** A 429/503 response with a Retry-After header is the server telling us
 * exactly when it's safe to come back — that's a floor on the delay, not
 * just a suggestion, so it always wins over a shorter backoff-computed
 * delay (never over a longer one, e.g. after several prior failures). */
function applyRetryAfterFloor(delayMinutes: number, retryAfterSeconds: number | null): number {
  if (retryAfterSeconds === null) return delayMinutes;
  return Math.max(delayMinutes, retryAfterSeconds / 60);
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

/** Structured Event Intelligence (spec "Automatically extract structured
 * facts from incoming reports"): runs alongside the suggestion snapshot
 * above, same never-block-ingestion error handling. Kept as a fully
 * separate call (not folded into computeAndStoreSnapshot) since it
 * writes to a different table via a different module — extraction stays
 * decoupled from the pre-existing suggestion-snapshot pipeline. */
async function computeAndStoreFacts(item: RawIngestionItemDTO): Promise<void> {
  try {
    const drafts = await extractFacts(item);
    await replaceExtractedFacts(item.id, drafts, item.publishedAt ?? item.receivedAt);
  } catch (err) {
    console.error(`[ingestion] fact extraction failed for item ${item.id}:`, err);
  }
}

/** MilitaryLand Phase 1 (spec "article/report -> referenced unit/
 * equipment/commander... route its articles through ingestion -> incoming
 * report -> extraction -> matching/corroboration"): runs the deterministic
 * unit/commander/equipment mention extraction against a freshly created
 * item's title+text and links whatever it finds, creating reference
 * entities on first mention and reusing them on every later one (spec "do
 * not duplicate entities when later articles mention them again"). Not
 * gated to any particular source — any article's text can mention a known
 * unit/commander/equipment, not just MilitaryLand's — same
 * never-block-ingestion error handling as the other extraction steps. */
async function computeAndStoreMilitaryEntities(item: RawIngestionItemDTO): Promise<void> {
  try {
    const text = [item.originalTitle, item.originalText].filter(Boolean).join("\n");
    if (!text) return;
    const provenance = { sourceName: item.originalTitle ?? undefined, sourceUrl: item.originalUrl ?? undefined };

    for (const mention of extractUnitMentions(text)) {
      const unit = await findOrCreateMilitaryUnit({ name: mention.name, unitType: mention.unitType, ...provenance });
      await linkArticleToUnit(item.id, unit.id);
    }
    for (const mention of extractEquipmentMentions(text)) {
      const equipment = await findOrCreateMilitaryEquipment({ name: mention.name, category: mention.category, ...provenance });
      await linkArticleToEquipment(item.id, equipment.id);
    }
    for (const mention of extractCommanderMentions(text)) {
      const commander = await findOrCreateCommander({ name: mention.name, rank: mention.rank, ...provenance });
      await linkArticleToCommander(item.id, commander.id);
    }
  } catch (err) {
    console.error(`[ingestion] military entity extraction failed for item ${item.id}:`, err);
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
      for (const item of createdItems) {
        await computeAndStoreSnapshot(item, source);
        await computeAndStoreFacts(item);
        await computeAndStoreMilitaryEntities(item);
      }
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
    const backoffMinutes = nextPollDelayMinutes(updated.pollIntervalMinutes, updated.consecutiveFailures);
    const retryAfterSeconds = err instanceof HttpFetchError ? err.retryAfterSeconds : null;
    await scheduleNextPoll(
      source.id,
      new Date(Date.now() + applyRetryAfterFloor(backoffMinutes, retryAfterSeconds) * 60_000),
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
