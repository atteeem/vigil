// Duplicate/syndication audit finding: the ingestion dedupe key is (sourceId, externalId), where externalId is
// usually a feed's <guid>. Several real feeds are not stable there across polls of the SAME article — BBC appends a
// "#0"/"#1" revision fragment to the guid; WordPress sites (Times of Israel, Mexico News Daily) emit a
// `?preview=true&preview_id=…` guid before publication and a different one after — while the article's own <link>
// (originalUrl) stays identical. That created real duplicate raw_ingestion_items for one article (confirmed on the
// dev database: 21 pairs, all same-source, exact-identical originalUrl, different externalId).
//
// This computes a normalized identity for a report's own URL, used as a SECOND dedupe key alongside externalId: two
// items from the same source whose original URL normalizes to the same key are the same report, whatever guid the
// feed gave them. Analytics-only query parameters are stripped (never anything that changes which article/page a
// URL points to); anything that fails to parse as a URL is returned unchanged rather than thrown away.

const TRACKING_PARAMS = new Set([
  "at_medium",
  "at_campaign",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "ref",
  "ref_src",
  "traffic_source",
  "spref",
  "ito",
  "cmpid",
  "cid",
  // WordPress preview links: the same article's guid before vs. after publication differs only in these.
  "preview",
  "preview_id",
]);

export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return trimmed; // not a well-formed absolute URL — compare as-is rather than discarding it
  }
  url.hash = "";
  const kept = [...url.searchParams.entries()].filter(([k]) => !TRACKING_PARAMS.has(k.toLowerCase()));
  kept.sort(([a], [b]) => a.localeCompare(b));
  url.search = "";
  for (const [k, v] of kept) url.searchParams.append(k, v);
  const host = url.hostname.toLowerCase();
  let path = url.pathname;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return `${url.protocol}//${host}${path}${url.search}`;
}
