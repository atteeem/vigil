// Exponential backoff on repeated failures, capped — "sensible backoff"
// per spec, without a source that's down for a day hammering the network
// every poll interval. consecutiveFailures is read from the row *after*
// recordIngestionError's increment, so failure #1 already backs off 2x.
const MAX_BACKOFF_MULTIPLIER = 8;

export function nextPollDelayMinutes(pollIntervalMinutes: number, consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) return pollIntervalMinutes;
  const multiplier = Math.min(2 ** consecutiveFailures, MAX_BACKOFF_MULTIPLIER);
  return pollIntervalMinutes * multiplier;
}

/** A 429/503 response with a Retry-After header is the server telling us
 * exactly when it's safe to come back — that's a floor on the delay, not
 * just a suggestion, so it always wins over a shorter backoff-computed
 * delay (never over a longer one, e.g. after several prior failures). */
export function applyRetryAfterFloor(delayMinutes: number, retryAfterSeconds: number | null): number {
  if (retryAfterSeconds === null) return delayMinutes;
  return Math.max(delayMinutes, retryAfterSeconds / 60);
}
