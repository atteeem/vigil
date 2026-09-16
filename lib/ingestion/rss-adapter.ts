import type { Source } from "@prisma/client";
import type { SourceAdapter, NormalizedItem, HealthCheckResult } from "@/lib/ingestion/types";

interface RssItem {
  title?: string;
  link?: string;
  guid?: string;
  pubDate?: string;
  description?: string;
}

// Deliberately dependency-free: a small regex-based extractor covering
// standard RSS 2.0 <item> blocks, not a full/strict XML parser. Sufficient
// for local-development ingestion against typical news/wire feeds; a real
// XML parser (e.g. fast-xml-parser) would be the Phase 2+ upgrade if a feed
// needs Atom support or turns out to be malformed enough to trip this up.
function extractTag(block: string, tag: string): string | undefined {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  if (!match) return undefined;
  const raw = match[1]!.trim();
  const cdata = raw.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  const text = cdata ? cdata[1]! : raw;
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function parseRss(xml: string): RssItem[] {
  const items = xml.match(/<item[^>]*>[\s\S]*?<\/item>/gi) ?? [];
  return items.map((block) => ({
    title: extractTag(block, "title"),
    link: extractTag(block, "link"),
    guid: extractTag(block, "guid"),
    pubDate: extractTag(block, "pubDate"),
    description: extractTag(block, "description"),
  }));
}

// Some real feeds (found seeding this project's ReliefWeb source) do
// content negotiation and reject a request with no explicit Accept header
// (406 Not Acceptable) even though the identical request with one
// succeeds — an explicit Accept header is the correct fix, not a
// per-host special case, since it's what any real RSS reader sends.
const RSS_REQUEST_HEADERS = {
  "User-Agent": "VigilLocalDev/1.0",
  Accept: "application/rss+xml, application/xml, text/xml, */*",
};

export const RSSAdapter: SourceAdapter = {
  async fetchLatest(source: Source): Promise<unknown[]> {
    if (!source.url) return [];
    const res = await fetch(source.url, { headers: RSS_REQUEST_HEADERS });
    if (!res.ok) throw new Error(`RSS fetch failed: ${res.status} ${res.statusText}`);
    const xml = await res.text();
    return parseRss(xml);
  },

  normalize(raw: unknown, source: Source): NormalizedItem {
    const item = raw as RssItem;
    const externalId = item.guid ?? item.link ?? `${source.id}:${item.title ?? ""}`;
    return {
      externalId,
      originalUrl: item.link,
      originalTitle: item.title,
      originalText: item.description,
      language: source.language ?? undefined,
      publishedAt: item.pubDate ? new Date(item.pubDate) : undefined,
    };
  },

  async healthCheck(source: Source): Promise<HealthCheckResult> {
    if (!source.url) return { ok: false, message: "No feed URL configured." };
    try {
      const res = await fetch(source.url, { method: "GET", headers: RSS_REQUEST_HEADERS });
      if (!res.ok) return { ok: false, message: `HTTP ${res.status}` };
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : "Fetch failed" };
    }
  },
};
