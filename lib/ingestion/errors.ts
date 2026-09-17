// A dedicated error type for HTTP-level fetch failures (spec "HTTP
// Failure Handling": 403/406/429/5xx/timeout) — carries the status code
// and, when present, a parsed Retry-After so lib/ingestion/poll.ts can
// make retry-scheduling decisions (respecting a server's own requested
// delay) without every adapter re-implementing that parsing itself.
export class HttpFetchError extends Error {
  readonly status: number;
  /** Seconds to wait before retrying, parsed from a `Retry-After` header
   * (either a delta-seconds integer or an HTTP-date) — null when the
   * response didn't send one. */
  readonly retryAfterSeconds: number | null;

  constructor(status: number, statusText: string, retryAfterSeconds: number | null) {
    super(`HTTP ${status} ${statusText}`);
    this.name = "HttpFetchError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** Parses a `Retry-After` header value per RFC 9110 §10.2.3 — either a
 * non-negative integer (delta-seconds) or an HTTP-date. Returns null for
 * anything absent or unparseable rather than throwing, since a malformed
 * header should degrade to "no hint", not break the fetch. */
export function parseRetryAfter(headerValue: string | null): number | null {
  if (!headerValue) return null;
  const trimmed = headerValue.trim();
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }
  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, Math.round((dateMs - Date.now()) / 1000));
  }
  return null;
}
