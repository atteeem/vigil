// Provenance for aggregator/relay posts: who the post cites as its origin.
//
// An aggregator (e.g. Liveuamap's Telegram channel) republishes what others
// reported. We keep the aggregator's own permalink AND, where the text names it,
// the upstream source — so the item can be traced back, and so an aggregator
// post plus the upstream report it cites are never counted as two independent
// confirmations. Deterministic patterns only; nothing is guessed.

export interface UpstreamInfo {
  /** Name of the upstream source, when the post names one ("Source: X"). */
  upstreamSource?: string;
  /** Link to the upstream report, when the post links one. */
  upstreamUrl?: string;
  /** The aggregator's own page for the item (e.g. a liveuamap.com link). */
  aggregatorUrl?: string;
}

const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;
// Hosts that are the aggregator itself, not an upstream origin.
const AGGREGATOR_HOSTS = [/(^|\.)liveuamap\.com$/i];
// Telegram links back to the channel/message we are already reading are not upstream either.
const SELF_HOSTS = [/^t\.me$/i, /^telegram\.me$/i];

const SOURCE_LINE = /(?:^|\n|\s)(?:(?:sources?|credit)\s*[:—-]|(?:via|h\/t)\s*[:—-]?)\s*([^\n.;|]{2,80})/i;

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function extractUpstreamSource(text: string | null | undefined): UpstreamInfo {
  if (!text) return {};
  const info: UpstreamInfo = {};
  const urls = (text.match(URL_RE) ?? []).map((u) => u.replace(/[.,;]+$/, ""));
  for (const url of urls) {
    const h = host(url);
    if (AGGREGATOR_HOSTS.some((re) => re.test(h))) info.aggregatorUrl ??= url;
    else if (!SELF_HOSTS.some((re) => re.test(h))) info.upstreamUrl ??= url;
  }
  const line = SOURCE_LINE.exec(text);
  if (line?.[1]) {
    // "Source: https://…" names a URL, not a source — leave that to upstreamUrl.
    const name = line[1].split(/https?:\/\//i)[0]!.trim().replace(/^@/, "");
    if (name.length >= 2) info.upstreamSource = name;
  }
  return info;
}

/** Metadata to merge into an item's rawMetadata: only the fields found. */
export function upstreamMetadata(text: string | null | undefined): Record<string, string> {
  const info = extractUpstreamSource(text);
  const out: Record<string, string> = {};
  if (info.upstreamSource) out.upstreamSource = info.upstreamSource;
  if (info.upstreamUrl) out.upstreamUrl = info.upstreamUrl;
  if (info.aggregatorUrl) out.aggregatorUrl = info.aggregatorUrl;
  return out;
}
