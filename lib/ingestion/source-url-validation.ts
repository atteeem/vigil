import { checkUrlStructure } from "@/lib/security/url-safety";
import { isRsshubUrl } from "@/lib/ingestion/rsshub";

// Write-time half of "one central URL-safety function shared by source creation/update/test/fetch"
// (Pre-Launch Critical Correctness & Security v1, SSRF section): rejects a structurally unsafe Source URL
// (wrong protocol, embedded credentials, malformed) at POST/PATCH time, using the exact same
// checkUrlStructure() every real fetch path also runs first. `rsshub://route` values are skipped —
// resolveFeedUrl (lib/ingestion/rsshub.ts) already restricts the route to a URL-safe relative path with no
// scheme/host of its own.
//
// Deliberately NOT a DNS-resolved/IP-range check here: that check is DNS-dependent (a hostname can resolve
// differently — or not at all yet — between save time and fetch time, so it belongs at the fetch itself,
// not the save) and is enforced unconditionally, with no exception, every single time anything actually
// fetches this source's URL — lib/security/safe-fetch.ts's safeFetch(), used by every real fetch path
// (RSS polling, structured-source polling, "Test source", "Fetch now"). A Source can be SAVED with an
// unsafe host; it can never be FETCHED — safeFetch rejects it every time, which is the point that actually
// matters, since saving a URL string causes no outbound request on its own.

const FIELDS = ["url", "feedUrl"] as const;

/** Returns an error message if any fetchable URL field on the input is structurally unsafe, otherwise null. */
export function validateSourceUrlFields(input: Record<string, unknown>): string | null {
  for (const field of FIELDS) {
    const value = input[field];
    if (typeof value !== "string" || !value.trim() || isRsshubUrl(value)) continue;
    const result = checkUrlStructure(value);
    if (!result.safe) return `${field}: ${result.reason ?? "URL is not allowed."}`;
  }
  return null;
}
