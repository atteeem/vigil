import { isAggregatorRole } from "@/lib/registry/source-tiers";

// Independent-source counting for an event. An aggregator or relay (Liveuamap's
// Telegram channel, a repost) republishes what someone else reported, so it is
// NOT an independent confirmation — and neither is it a second confirmation
// alongside the upstream report it cites. Only originating links from
// non-aggregator sources count; an event backed only by an aggregator counts as
// ONE (there is still a report behind it, just no independent one).

interface LinkLike {
  isOriginatingSource: boolean;
  rawIngestionItem: { source: { sourceRole: string | null } };
}

export function independentSourceCount(links: readonly LinkLike[]): number {
  const originating = links.filter((l) => l.isOriginatingSource);
  const independent = originating.filter((l) => !isAggregatorRole(l.rawIngestionItem.source.sourceRole)).length;
  return independent > 0 ? independent : originating.length > 0 ? 1 : 0;
}
