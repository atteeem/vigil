import { normalizeSourceUrl } from "@/lib/data/independence";

// Public source-trust presentation. The stored classification (independenceClass +
// claimPolicy) is an internal vocabulary; the public site shows three human labels:
//
//   A  Independent / Strong Verification
//   B  Independent / Perspective
//   C  Party / Aligned Claim            (a side speaking for itself — never independent evidence)
//
// plus "Discovery lead" (aggregators/OSINT: a pointer to check, not evidence) and, for
// sources that predate classification, an honest "not yet classified" (counted as
// independent as before, but never dressed up as strongly verified).

export type TrustCategory = "strong" | "perspective" | "party_claim" | "discovery" | "unclassified";

export interface SourceTrust {
  category: TrustCategory;
  /** Public label. */
  label: string;
  /** Short badge text, only for categories that need to stand out. */
  badge: string | null;
  /** Who/what the source is, when recorded ("Israeli military"). */
  perspective: string | null;
  /** Does a report from this source count toward independent confirmation? */
  countsAsIndependent: boolean;
}

export interface TrustInput {
  independenceClass?: string | null;
  claimPolicy?: string | null;
  sourceRole?: string | null;
  perspective?: string | null;
}

const PARTY_CLASSES = new Set(["state_media", "aligned_media", "official_government", "official_military", "representative_advocacy"]);
const PERSPECTIVE_CLASSES = new Set(["independent_standard", "advocacy_independent", "international_media", "specialist_reference"]);

export const TRUST_LABEL: Record<TrustCategory, string> = {
  strong: "Independent / Strong Verification",
  perspective: "Independent / Perspective",
  party_claim: "Party / Aligned Claim",
  discovery: "Discovery lead",
  unclassified: "Source (not yet classified)",
};

export function sourceTrust(input: TrustInput): SourceTrust {
  const perspective = input.perspective?.trim() || null;
  const make = (category: TrustCategory, badge: string | null = null): SourceTrust => ({
    category,
    label: TRUST_LABEL[category],
    badge,
    perspective,
    countsAsIndependent: category === "strong" || category === "perspective" || category === "unclassified",
  });
  if (input.claimPolicy === "discovery_only" || input.independenceClass === "osint_aggregator") return make("discovery", "DISCOVERY LEAD");
  if (input.claimPolicy === "party_claim" || (input.independenceClass && PARTY_CLASSES.has(input.independenceClass))) return make("party_claim", "PARTY CLAIM");
  if (input.independenceClass === "independent_high") return make("strong");
  if (input.independenceClass && PERSPECTIVE_CLASSES.has(input.independenceClass)) return make("perspective");
  if (input.sourceRole === "aggregator" || input.sourceRole === "relay") return make("discovery", "DISCOVERY LEAD");
  return make("unclassified");
}

export interface EvidenceReport {
  /** The outlet (Source) the report came from; reports from one outlet are ONE independence group. */
  sourceId: string;
  url: string | null;
  trust: SourceTrust;
  /** A relay link ("also carried by") is provenance, not confirmation. */
  relay?: boolean;
}

export interface EvidenceSummary {
  /** Distinct outlets whose reports independently support the event (deduplicated by outlet and by article URL). */
  independentSources: number;
  strongVerification: number;
  perspectives: number;
  unclassified: number;
  /** Distinct party-claim reports (by outlet and article). */
  partyClaims: number;
  discoveryLeads: number;
  /** Reports counted for nothing: repeats of an article/outlet already counted, and relays. */
  dependentRepeats: number;
}

/** Independence groups: an outlet counts once however many times it reports; the same
 * article attached twice counts once; relays and discovery leads never add to the count. */
export function summarizeEvidence(reports: readonly EvidenceReport[]): EvidenceSummary {
  const groups = new Map<string, TrustCategory>();
  const claims = new Set<string>();
  const leads = new Set<string>();
  const seenUrls = new Set<string>();
  let repeats = 0;
  for (const r of reports) {
    const urlKey = normalizeSourceUrl(r.url);
    if (urlKey) {
      if (seenUrls.has(urlKey)) {
        repeats++;
        continue;
      }
      seenUrls.add(urlKey);
    }
    if (r.relay) {
      repeats++;
      continue;
    }
    const c = r.trust.category;
    if (c === "party_claim") claims.add(`${r.sourceId}|${urlKey ?? claims.size}`);
    else if (c === "discovery") leads.add(`${r.sourceId}|${urlKey ?? leads.size}`);
    else if (groups.has(r.sourceId)) repeats++;
    else groups.set(r.sourceId, c);
  }
  const cats = [...groups.values()];
  return {
    independentSources: groups.size,
    strongVerification: cats.filter((c) => c === "strong").length,
    perspectives: cats.filter((c) => c === "perspective").length,
    unclassified: cats.filter((c) => c === "unclassified").length,
    partyClaims: claims.size,
    discoveryLeads: leads.size,
    dependentRepeats: repeats,
  };
}

/** "4 independent sources · 2 perspectives · 1 party claim" — never a raw source tally. */
export function describeEvidence(s: EvidenceSummary, options: { claims?: boolean } = {}): string {
  const parts: string[] = [];
  parts.push(`${s.independentSources} independent source${s.independentSources === 1 ? "" : "s"}`);
  if (s.strongVerification > 0 && s.perspectives > 0) parts.push(`${s.strongVerification} strongly verified · ${s.perspectives} perspective${s.perspectives === 1 ? "" : "s"}`);
  else if (s.perspectives > 0) parts.push(`${s.perspectives} perspective${s.perspectives === 1 ? "" : "s"}`);
  else if (s.strongVerification > 0) parts.push(`${s.strongVerification} strongly verified`);
  if (options.claims !== false && s.partyClaims > 0) parts.push(`${s.partyClaims} party claim${s.partyClaims === 1 ? "" : "s"}`);
  if (s.discoveryLeads > 0) parts.push(`${s.discoveryLeads} discovery lead${s.discoveryLeads === 1 ? "" : "s"}`);
  return parts.join(" · ");
}
