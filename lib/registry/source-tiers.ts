// Source tiers — how a source relates to what it reports. Coverage quality is
// about the MIX of tiers (independent local/specialist voices), never article
// volume; an aggregator is a discovery aid, not an independent confirmation.
//
//   official      governments, UN agencies, humanitarian authorities
//   local_media   local / originating media and community reporters
//   specialist    research and monitoring organisations (think tanks,
//                 conflict monitors, investigative outlets)
//   global_media  international news media
//   aggregator    aggregators, relays and discovery channels

export const SOURCE_TIERS = ["official", "local_media", "specialist", "global_media", "aggregator"] as const;
export type SourceTier = (typeof SOURCE_TIERS)[number];

export const SOURCE_TIER_LABEL: Record<SourceTier, string> = {
  official: "Official",
  local_media: "Local / originating media",
  specialist: "Specialist / research",
  global_media: "Global media",
  aggregator: "Aggregator / discovery",
};

/** Tier from a source's trust-model role (Source.sourceRole). A source with no
 * role is treated as global media: the safest assumption — it earns no
 * specialist credit until an admin classifies it. */
export function sourceTierOf(sourceRole: string | null | undefined): SourceTier {
  switch (sourceRole) {
    case "official":
      return "official";
    case "local_media":
    case "eyewitness_community":
      return "local_media";
    case "specialist_research":
      return "specialist";
    case "aggregator":
    case "relay":
      return "aggregator";
    default:
      return "global_media";
  }
}

/** Tiers whose voice is close to the ground or expert — what "no specialist
 * or local source" means. */
export function isGroundedTier(tier: SourceTier): boolean {
  return tier === "local_media" || tier === "specialist";
}

/** The role a source's REPORTS carry as evidence. A discovery-only source is a lead
 * (treated as an aggregator); a party-claim source (state/official/aligned media
 * speaking for a side) is a claim by that party, not an independent confirmation. */
export function evidenceRoleOf(source: { sourceRole?: string | null; claimPolicy?: string | null }): string | null {
  if (source.claimPolicy === "discovery_only") return "aggregator";
  if (source.claimPolicy === "party_claim") return "party_claim";
  return source.sourceRole ?? null;
}

/** Roles whose reports never count as independent confirmation. */
export function isNonIndependentRole(role: string | null | undefined): boolean {
  return role === "aggregator" || role === "relay" || role === "party_claim";
}

export function isAggregatorRole(sourceRole: string | null | undefined): boolean {
  return sourceRole === "aggregator" || sourceRole === "relay";
}

export type TierCounts = Record<SourceTier, number>;

export function emptyTierCounts(): TierCounts {
  return { official: 0, local_media: 0, specialist: 0, global_media: 0, aggregator: 0 };
}

/** Number of distinct tiers present, aggregators excluded (they add discovery, not diversity). */
export function tierDiversity(counts: TierCounts): number {
  return SOURCE_TIERS.filter((t) => t !== "aggregator" && counts[t] > 0).length;
}
