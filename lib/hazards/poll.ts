import type { Source } from "@prisma/client";
import { getHazardProvider, missingCredentials } from "./registry";
import { ingestGlobalEvents, runHazardRetention, runLifecycleRetention } from "./store";
import { HttpFetchError, parseRetryAfter } from "@/lib/ingestion/errors";
import { nextPollDelayMinutes, applyRetryAfterFloor } from "@/lib/ingestion/backoff";
import { recordAttemptStarted, recordIngestionSuccess, recordIngestionError, scheduleNextPoll } from "@/lib/db/repositories/sources";
import { recordIngestionAttempt } from "@/lib/db/repositories/ingestion-logs";
import type { FetchResult } from "@/lib/ingestion/poll";

// Polls one structured source (earthquakes, thermal detections, alerts...). Shares the news
// pipeline's bookkeeping exactly: an IngestionLog row per attempt, lastAttemptedAt / lastError /
// consecutiveFailures on the Source, exponential backoff, and a Retry-After floor — one provider
// failing never affects another.

const FETCH_TIMEOUT_MS = Number(process.env.INGESTION_FETCH_TIMEOUT_MS) || 60_000;
const DEFAULT_HEADERS = { "User-Agent": "Vigil/1.0 (public intelligence map)", Accept: "application/json, text/csv, */*" };

async function fetchText(url: string, init?: { headers?: Record<string, string> }): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { ...DEFAULT_HEADERS, ...init?.headers }, signal: controller.signal });
    if (!res.ok) throw new HttpFetchError(res.status, res.statusText, parseRetryAfter(res.headers.get("retry-after")));
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

let lastRetention = 0;
const RETENTION_EVERY_MS = 6 * 3_600_000;

export async function pollStructuredSource(source: Source): Promise<FetchResult> {
  await recordAttemptStarted(source.id);
  try {
    const provider = getHazardProvider(source.platform);
    // A provider that needs a key/token stays idle (and says why) until it is configured: never attempted
    // unauthenticated, never bypassed.
    const missing = missingCredentials(provider);
    if (missing.length) throw new Error(`Credentials not configured: set ${missing.join(", ")} (${provider.credentials!.signup})`);
    const url = source.feedUrl ?? source.url ?? provider.defaultUrl;
    const result = await provider.fetch({ url, now: new Date(), fetchText });
    const stats = await ingestGlobalEvents(provider.key, source.id, result);
    if (Date.now() - lastRetention > RETENTION_EVERY_MS) {
      lastRetention = Date.now();
      await runHazardRetention().catch((err) => console.error("[hazards] retention failed:", err));
      await runLifecycleRetention().catch((err) => console.error("[hazards] lifecycle retention failed:", err));
    }
    const updated = await recordIngestionSuccess(source.id);
    const fetched = result.events.length;
    await recordIngestionAttempt({ sourceId: source.id, fetched, newCount: stats.created, alreadyKnown: fetched - stats.created, success: true });
    await scheduleNextPoll(source.id, new Date(Date.now() + nextPollDelayMinutes(updated.pollIntervalMinutes, updated.consecutiveFailures) * 60_000));
    return { fetched, alreadyKnown: fetched - stats.created, new: stats.created, errors: 0 };
  } catch (err) {
    const message = err instanceof Error ? (err.name === "AbortError" ? `Fetching ${source.name} timed out` : err.message) : String(err);
    const updated = await recordIngestionError(source.id, message);
    await recordIngestionAttempt({ sourceId: source.id, fetched: 0, newCount: 0, alreadyKnown: 0, success: false, errorMessage: message });
    const backoff = nextPollDelayMinutes(updated.pollIntervalMinutes, updated.consecutiveFailures);
    const retryAfter = err instanceof HttpFetchError ? err.retryAfterSeconds : null;
    await scheduleNextPoll(source.id, new Date(Date.now() + applyRetryAfterFloor(backoff, retryAfter) * 60_000));
    return { fetched: 0, alreadyKnown: 0, new: 0, errors: 1, error: message };
  }
}
