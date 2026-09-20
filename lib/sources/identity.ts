// Source identity: what a source IS (organisation site, feed, social account) kept
// apart from what it publishes (each item's own original URL). Nothing here guesses:
// a handle or URL is only ever parsed out of a string somebody supplied.

export const SOURCE_VERIFICATION_STATUSES = ["verified", "needs_verification", "inaccessible", "inactive", "rejected"] as const;
export type SourceVerificationStatus = (typeof SOURCE_VERIFICATION_STATUSES)[number];

export const INDEPENDENCE_CLASSES = [
  "independent_high",
  "independent_standard",
  "advocacy_independent",
  "representative_advocacy",
  "international_media",
  "specialist_reference",
  "official_government",
  "official_military",
  "state_media",
  "aligned_media",
  "osint_aggregator",
] as const;
export type IndependenceClass = (typeof INDEPENDENCE_CLASSES)[number];

/** party_claim: the source speaks for a side; discovery_only: a lead to corroborate, never evidence. */
export const CLAIM_POLICIES = ["party_claim", "discovery_only"] as const;
export type ClaimPolicy = (typeof CLAIM_POLICIES)[number];

export const SOURCE_PLATFORMS = ["website", "rss", "telegram", "x", "manual"] as const;
export type SourcePlatform = (typeof SOURCE_PLATFORMS)[number];

const TRACKING_PARAM = /^(utm_[a-z]+|fbclid|gclid|mc_cid|mc_eid|igshid|ref|ref_src|s|t)$/i;

/** Canonical form of a URL as supplied: https/http kept as given, lower-case host, default
 * port and fragment dropped, tracking parameters removed. The path is left exactly as
 * supplied (no case-folding, no rewriting) so the stored URL still points at the same page. */
export function canonicalizeUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
  url.hostname = url.hostname.toLowerCase();
  const text = url.toString();
  return text;
}

/** Comparison key: scheme-less, no `www.`, no trailing slash, no query for bare site roots. Two
 * supplied URLs with the same key are the same page/site. */
export function urlKey(input: string | null | undefined): string | null {
  if (!input) return null;
  const canonical = canonicalizeUrl(input);
  if (!canonical) return null;
  const u = new URL(canonical);
  const host = u.hostname.replace(/^www\./, "");
  const path = u.pathname.replace(/\/+$/, "");
  return `${host}${path}${path === "" ? "" : u.search}`;
}

/** Host without `www.`, for "same site" checks. */
export function siteHost(input: string | null | undefined): string | null {
  const canonical = input ? canonicalizeUrl(input) : null;
  return canonical ? new URL(canonical).hostname.replace(/^www\./, "") : null;
}

/** Handle from a public Telegram URL (t.me/handle, t.me/s/handle, telegram.me/handle, @handle). */
export function parseTelegramHandle(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (/^@[A-Za-z0-9_]{4,}$/.test(trimmed)) return trimmed.slice(1);
  const canonical = canonicalizeUrl(trimmed);
  if (!canonical) return null;
  const u = new URL(canonical);
  if (!/^(www\.)?(t|telegram)\.me$/i.test(u.hostname)) return null;
  const parts = u.pathname.split("/").filter(Boolean);
  const handle = parts[0] === "s" ? parts[1] : parts[0];
  return handle && /^[A-Za-z0-9_]{4,}$/.test(handle) ? handle : null;
}

/** Handle (and status id, when the URL is a single post) from an x.com / twitter.com URL. */
export function parseXUrl(input: string | null | undefined): { handle: string; statusId: string | null } | null {
  if (!input) return null;
  const canonical = canonicalizeUrl(input);
  if (!canonical) return null;
  const u = new URL(canonical);
  if (!/^(www\.|mobile\.)?(x|twitter)\.com$/i.test(u.hostname)) return null;
  const parts = u.pathname.split("/").filter(Boolean);
  const handle = parts[0];
  if (!handle || !/^[A-Za-z0-9_]{1,15}$/.test(handle)) return null;
  const statusId = parts[1] === "status" && parts[2] && /^\d+$/.test(parts[2]) ? parts[2] : null;
  return { handle, statusId };
}

export interface SourceIdentityFields {
  canonicalSourceUrl: string | null;
  feedUrl: string | null;
  socialProfileUrl: string | null;
  platform: SourcePlatform | null;
  platformHandle: string | null;
}

/** Every key under which two source records would be "the same source": exact URLs
 * (canonical site, feed, social profile) and platform+handle. */
export function identityKeys(f: Partial<SourceIdentityFields> & { telegramHandle?: string | null }): string[] {
  const keys: string[] = [];
  const add = (prefix: string, value: string | null) => value && keys.push(`${prefix}:${value}`);
  add("site", urlKey(f.canonicalSourceUrl));
  add("feed", urlKey(f.feedUrl));
  add("social", urlKey(f.socialProfileUrl));
  const handle = (f.platformHandle ?? f.telegramHandle ?? "").replace(/^@/, "").toLowerCase();
  if (handle && f.platform) add("handle", `${f.platform}/${handle}`);
  else if (handle && f.telegramHandle) add("handle", `telegram/${handle}`);
  return keys;
}
