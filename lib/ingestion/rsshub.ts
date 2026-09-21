// Optional RSSHub support (see docs/RSSHUB_INTEGRATION.md). RSSHub is AGPL-3.0 software: Vigil never copies
// or links it. An operator MAY run it as a separate service and point Vigil at it; a source then uses a feed
// URL of the form `rsshub://<route>` (for example `rsshub://kyodonews/en`), which is resolved against
// RSSHUB_BASE_URL at fetch time and consumed as ordinary RSS by the existing RSSAdapter.
//
// Disabled unless RSSHUB_BASE_URL is set: nothing else in Vigil depends on it. This module never fetches
// anything itself and never helps bypass authentication, paywalls or bot protection.

export const RSSHUB_SCHEME = "rsshub://";

export class RsshubNotConfiguredError extends Error {
  constructor() {
    super("RSSHub is not configured (set RSSHUB_BASE_URL to enable rsshub:// feeds).");
    this.name = "RsshubNotConfiguredError";
  }
}

export class InvalidRsshubRouteError extends Error {
  constructor(route: string) {
    super(`Invalid RSSHub route "${route}".`);
    this.name = "InvalidRsshubRouteError";
  }
}

export const isRsshubUrl = (url: string | null | undefined): boolean => !!url && url.trim().toLowerCase().startsWith(RSSHUB_SCHEME);

/** The configured RSSHub base URL without a trailing slash, or null when the feature is disabled/invalid. */
export function rsshubBaseUrl(env: Record<string, string | undefined> = process.env): string | null {
  const raw = env.RSSHUB_BASE_URL?.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

// A route is a relative path (optionally with a query string) made of URL-safe characters. It can never
// carry a scheme, a host, a protocol-relative prefix or a path traversal, so `rsshub://` can only ever
// address the configured RSSHub instance.
const ROUTE = /^[A-Za-z0-9][A-Za-z0-9._~!$&'()*+,;=:@%/-]*(\?[A-Za-z0-9._~!$&'()*+,;=:@%/?-]*)?$/;

/**
 * Resolves a source URL for fetching. Ordinary URLs pass through unchanged; `rsshub://route` becomes
 * `${RSSHUB_BASE_URL}/route` (with `RSSHUB_ACCESS_KEY` appended as `key` when set).
 * Throws RsshubNotConfiguredError when the base URL is missing, InvalidRsshubRouteError for a bad route.
 */
export function resolveFeedUrl(url: string, env: Record<string, string | undefined> = process.env): string {
  if (!isRsshubUrl(url)) return url;
  const base = rsshubBaseUrl(env);
  if (!base) throw new RsshubNotConfiguredError();
  const route = url.trim().slice(RSSHUB_SCHEME.length).replace(/^\/+/, "");
  if (!ROUTE.test(route) || route.includes("..") || route.includes("://") || route.startsWith("//")) throw new InvalidRsshubRouteError(route);
  const resolved = `${base}/${route}`;
  const key = env.RSSHUB_ACCESS_KEY?.trim();
  return key ? `${resolved}${resolved.includes("?") ? "&" : "?"}key=${encodeURIComponent(key)}` : resolved;
}
