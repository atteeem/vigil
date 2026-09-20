import { evidenceRoleOf, isNonIndependentRole } from "@/lib/registry/source-tiers";

// Independent-source counting for an event. An aggregator or relay (Liveuamap's
// Telegram channel, a repost) republishes what someone else reported, so it is
// NOT an independent confirmation — and neither is it a second confirmation
// alongside the upstream report it cites. Only originating links from
// non-aggregator sources count; an event backed only by an aggregator counts as
// ONE (there is still a report behind it, just no independent one).

interface LinkLike {
  isOriginatingSource: boolean;
  rawIngestionItem: { originalUrl?: string | null; source: { id?: string; sourceRole: string | null; claimPolicy?: string | null } };
}

/** Comparable form of an article URL: scheme-less, lower-case host, no fragment,
 * no tracking parameters, no trailing slash. Two links that normalize the same
 * point at the same page. */
export function normalizeSourceUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    for (const key of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|ref$)/i.test(key)) u.searchParams.delete(key);
    const path = u.pathname.replace(/\/+$/, "");
    return `${u.hostname.replace(/^www\./i, "").toLowerCase()}${path}${u.search}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

export function independentSourceCount(links: readonly LinkLike[]): number {
  const originating = links.filter((l) => l.isOriginatingSource);
  // The same article attached twice (two ingested copies, a re-fetch) is ONE
  // piece of evidence, not two independent confirmations.
  const seen = new Set<string>();
  let independent = 0;
  for (const l of originating) {
    if (isNonIndependentRole(evidenceRoleOf(l.rawIngestionItem.source))) continue;
    // Independence groups: one outlet is ONE group however many reports it files, and the
    // same article attached twice is one report. Neither raises the independent count.
    const outlet = l.rawIngestionItem.source.id ? `outlet:${l.rawIngestionItem.source.id}` : null;
    const article = normalizeSourceUrl(l.rawIngestionItem.originalUrl);
    if ((outlet && seen.has(outlet)) || (article && seen.has(`url:${article}`))) continue;
    if (outlet) seen.add(outlet);
    if (article) seen.add(`url:${article}`);
    independent++;
  }
  return independent > 0 ? independent : originating.length > 0 ? 1 : 0;
}
