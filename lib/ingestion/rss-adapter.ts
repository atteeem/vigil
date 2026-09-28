import type { Source } from "@prisma/client";
import type { SourceAdapter, NormalizedItem, HealthCheckResult } from "@/lib/ingestion/types";
import { HttpFetchError, parseRetryAfter } from "@/lib/ingestion/errors";
import { resolveFeedUrl } from "@/lib/ingestion/rsshub";
import { safeFetch } from "@/lib/security/safe-fetch";

interface RssItem {
  title?: string;
  link?: string;
  guid?: string;
  pubDate?: string;
  description?: string;
  /** <dc:creator> — byline/author, where a feed provides one (spec "author
   * where available", Myanmar Now Integration milestone). Optional: most
   * seeded feeds omit it. */
  creator?: string;
  /** All <category> values on the item — used generically (not just by
   * Myanmar Now) to detect a WordPress "paid content"-style category so
   * paywalled items are never treated as if their RSS excerpt were the
   * full article (spec "do not bypass paywalls/subscriber restrictions"). */
  categories: string[];
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
    // Numeric character references ("&#233;" -> "é") — real non-English feeds
    // (French, Spanish) use them heavily.
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeFromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => safeFromCodePoint(parseInt(dec, 10)))
    .replace(/&nbsp;/g, " ")
    .trim();
}

function safeFromCodePoint(code: number): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

function extractAllTags(block: string, tag: string): string[] {
  const matches = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "gi")) ?? [];
  return matches
    .map((m) => {
      const inner = m.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
      if (!inner) return "";
      const raw = inner[1]!.trim();
      const cdata = raw.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
      return (cdata ? cdata[1]! : raw).trim();
    })
    .filter(Boolean);
}

function parseRss(xml: string): RssItem[] {
  const items = xml.match(/<item[^>]*>[\s\S]*?<\/item>/gi) ?? [];
  return items.map((block) => ({
    title: extractTag(block, "title"),
    link: extractTag(block, "link"),
    guid: extractTag(block, "guid"),
    // RSS 2.0 <pubDate>, else the Dublin Core / Atom-style date some feeds use.
    pubDate: extractTag(block, "pubDate") ?? extractTag(block, "dc:date") ?? extractTag(block, "published") ?? extractTag(block, "updated"),
    description: extractTag(block, "description"),
    creator: extractTag(block, "dc:creator"),
    categories: extractAllTags(block, "category"),
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

/** A valid Date or undefined — never an "Invalid Date" stored as a timestamp. */
function parsePublishedAt(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export const RSSAdapter: SourceAdapter = {
  async fetchLatest(source: Source): Promise<unknown[]> {
    if (!source.url) return [];
    // `rsshub://route` resolves against the optional RSSHUB_BASE_URL sidecar; ordinary URLs are unchanged.
    // The signal covers connecting AND reading the body, and actually cancels the request (poll.ts's withTimeout only
    // stops waiting for it), so a hung feed cannot keep a socket open after it has been given up on.
    const timeoutMs = Number(process.env.INGESTION_FETCH_TIMEOUT_MS) || 20_000;
    try {
      const res = await safeFetch(resolveFeedUrl(source.url), { headers: RSS_REQUEST_HEADERS, timeoutMs });
      if (!res.ok) throw new HttpFetchError(res.status, res.statusText, parseRetryAfter(res.headers.get("retry-after")));
      return parseRss(await res.text());
    } catch (err) {
      if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) throw new Error(`Fetching ${source.name} timed out after ${timeoutMs}ms`);
      throw err;
    }
  },

  normalize(raw: unknown, source: Source): NormalizedItem {
    const item = raw as RssItem;
    // `||`, not `??`: some feeds (Rappler) emit an EMPTY <guid>, which must fall
    // through to the link — otherwise every item shares the id "" and dedup
    // collapses the whole feed to one item.
    const externalId = item.guid || item.link || `${source.id}:${item.title ?? ""}`;
    // "paid content" is the exact WordPress category several seeded/
    // candidate feeds (e.g. Myanmar Now) use to mark a paywalled article —
    // stored as a flag, never used to fetch/scrape beyond what the feed's
    // own description already provides (spec "do not bypass paywalls").
    const paidContent = item.categories.some((c) => c.toLowerCase().includes("paid content"));
    return {
      externalId,
      originalUrl: item.link,
      originalTitle: item.title,
      originalText: item.description,
      language: source.language ?? undefined,
      publishedAt: parsePublishedAt(item.pubDate),
      rawMetadata: {
        ...(item.creator ? { author: item.creator } : {}),
        ...(item.categories.length > 0 ? { categories: item.categories } : {}),
        ...(paidContent ? { paidContent: true } : {}),
      },
    };
  },

  async healthCheck(source: Source): Promise<HealthCheckResult> {
    if (!source.url) return { ok: false, message: "No feed URL configured." };
    try {
      const res = await safeFetch(resolveFeedUrl(source.url), { method: "GET", headers: RSS_REQUEST_HEADERS });
      if (!res.ok) return { ok: false, message: `HTTP ${res.status}` };
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : "Fetch failed" };
    }
  },
};
