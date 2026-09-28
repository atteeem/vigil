import { prisma } from "@/lib/db/client";
import { getSource } from "@/lib/db/repositories/sources";
import { extractDraft } from "@/lib/ingestion/draft";
import { listIncomingItems, type IncomingFilters } from "@/lib/ingestion/incoming-queue";
import { PublishError, publishRawItem } from "@/lib/ingestion/publish-item";
import { findCanonicalEventMatch } from "@/lib/ingestion/event-match";
import { evidenceRoleOf, isNonIndependentRole } from "@/lib/registry/source-tiers";
import { CLASSIFICATIONS, type Classification } from "@/lib/ingestion/publish-readiness";
import type { DraftSuggestionDTO, LocationScope } from "@/lib/types/db";
import type { EventType, Severity } from "@/lib/types";

// Report != Event, same-incident corroboration (Final Intelligence Consistency & Map Correctness v1 §1):
// the actual matching now lives in lib/ingestion/publish-item.ts's publishRawItem — the ONE publish path
// shared by the single-item Publish button, the review form and "Publish filtered" — so it applies
// uniformly everywhere, including within one bulk batch (each candidate is published one at a time below;
// by the time candidate N is checked, every earlier candidate in this SAME batch that became an event is
// already committed, so publishRawItem's own fresh check naturally sees same-batch events exactly like it
// sees older published ones). This file no longer runs its own separate matching pass — see
// lib/ingestion/event-match.ts for the one canonical matcher and its thresholds.
//
// The one thing still done HERE is a pre-filter: a report whose cheap, ingestion-time
// `duplicateLikelihood` snapshot says "high" is normally routed to a human (skipped, not published) rather
// than risk a fragmented duplicate Event — UNLESS it also clears the much stricter canonical-merge bar,
// in which case letting it through to publishRawItem is safe (it will attach to the matching event, never
// create a new one). This keeps every genuinely-safe case flowing through, while everything that doesn't
// clear that bar keeps its existing, conservative "let a human look at it" behavior.

export const BULK_PUBLISH_LIMIT = 5000;

export type SkipReason = "not_pending" | "no_draft" | "no_title" | "no_text" | "no_location_or_conflict" | "likely_duplicate" | "source_missing";
export const SKIP_LABEL: Record<SkipReason, string> = {
  not_pending: "Not pending (already published, merged or rejected)",
  no_draft: "Automated processing is disabled for its source",
  no_title: "No usable headline",
  no_text: "No source text to summarise",
  no_location_or_conflict: "No usable location and no conflict association",
  likely_duplicate: "Likely duplicate of a published event (review it individually)",
  source_missing: "Source record not found",
};

export interface BulkItemOutcome {
  id: string;
  title: string;
  status: "publishable" | "published" | "merged" | "skipped" | "failed";
  reason?: string;
  reasonCode?: SkipReason;
  scope?: LocationScope;
}

export interface BulkPlan {
  /** Reports matching the filters right now (all statuses the filter allows). */
  matching: number;
  /** Of those, how many would be published. */
  publishable: number;
  skipped: { code: SkipReason; label: string; count: number; samples: { id: string; title: string }[] }[];
  scopes: Record<LocationScope, number>;
  /** Backlog Triage & Safe Publication v1 §11: classification breakdown of what would actually publish. */
  classifications: Record<Classification, number>;
  warnings: { lowConfidence: number; partyClaimOrAggregator: number; mediumDuplicateRisk: number; noCoordinates: number };
  ids: string[];
  outcomes: BulkItemOutcome[];
}

export interface BulkResult {
  published: number;
  /** Attached to an existing event as an additional source instead of becoming its own Event — see
   * lib/ingestion/event-match.ts / lib/ingestion/publish-item.ts. */
  merged: number;
  skipped: number;
  failed: number;
  outcomes: BulkItemOutcome[];
}

const yieldToLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

interface Candidate {
  id: string;
  title: string;
  draft: DraftSuggestionDTO | null;
  skip?: SkipReason;
  partyClaim: boolean;
  duplicate: "none" | "low" | "medium" | "high";
  classification: Classification;
}

async function evaluate(filters: IncomingFilters, ids?: string[]): Promise<{ matching: number; candidates: Candidate[] }> {
  let items = await listIncomingItems(filters);
  const matching = items.length;
  if (ids) {
    const wanted = new Set(ids);
    items = items.filter((i) => wanted.has(i.id));
  }
  if (items.length > BULK_PUBLISH_LIMIT) throw new PublishError(`Too many reports for one bulk publish (${items.length}); narrow the filters (limit ${BULK_PUBLISH_LIMIT}).`);
  const candidates: Candidate[] = [];
  for (const item of items) {
    await yieldToLoop();
    const source = await getSource(item.sourceId);
    const partyClaim = source ? isNonIndependentRole(evidenceRoleOf(source)) : false;
    const c: Candidate = { id: item.id, title: item.originalTitle ?? "(no title)", draft: null, partyClaim, duplicate: item.duplicateLikelihood, classification: item.finalClassification };
    if (item.processingStatus !== "pending") c.skip = "not_pending";
    else if (!source) c.skip = "source_missing";
    else {
      c.draft = await extractDraft(item, source, { skipDuplicates: true });
      if (!c.draft) c.skip = "no_draft";
      else if (c.draft.titleSource === "none") c.skip = "no_title";
      else if (c.draft.summarySource === "title_only" && !item.originalText?.trim()) c.skip = "no_text";
      else if (c.draft.locationScope === "unknown" && !c.draft.conflictId) c.skip = "no_location_or_conflict";
      else if (item.duplicateLikelihood === "high") {
        // A high raw duplicate score is only safe to let through when it ALSO clears the much stricter
        // canonical-merge bar; otherwise it's exactly the ambiguous case a person should look at.
        const canonical = await findCanonicalEventMatch({
          title: c.draft.title,
          eventType: c.draft.eventType as EventType,
          latitude: c.draft.latitude,
          longitude: c.draft.longitude,
          countryCode: c.draft.countryCode,
          region: c.draft.region,
          conflictId: c.draft.conflictId,
          occurredAt: item.publishedAt ? new Date(item.publishedAt) : new Date(item.receivedAt),
        });
        if (!canonical) c.skip = "likely_duplicate";
      }
    }
    candidates.push(c);
  }
  return { matching, candidates };
}

export async function planBulkPublish(filters: IncomingFilters, ids?: string[]): Promise<BulkPlan> {
  const { matching, candidates } = await evaluate(filters, ids);
  const scopes: BulkPlan["scopes"] = { global: 0, country: 0, region: 0, city: 0, point: 0, unknown: 0 };
  const classifications = Object.fromEntries(CLASSIFICATIONS.map((k) => [k, 0])) as BulkPlan["classifications"];
  const skipped = new Map<SkipReason, BulkPlan["skipped"][number]>();
  const warnings = { lowConfidence: 0, partyClaimOrAggregator: 0, mediumDuplicateRisk: 0, noCoordinates: 0 };
  const outcomes: BulkItemOutcome[] = [];
  const ok: string[] = [];
  for (const c of candidates) {
    if (c.skip) {
      const e = skipped.get(c.skip) ?? { code: c.skip, label: SKIP_LABEL[c.skip], count: 0, samples: [] };
      e.count++;
      if (e.samples.length < 5) e.samples.push({ id: c.id, title: c.title });
      skipped.set(c.skip, e);
      outcomes.push({ id: c.id, title: c.title, status: "skipped", reasonCode: c.skip, reason: SKIP_LABEL[c.skip] });
      continue;
    }
    ok.push(c.id);
    const d = c.draft!;
    scopes[d.locationScope]++;
    classifications[c.classification]++;
    if (d.locationScope === "unknown" || d.verificationStatus === "unverified" || d.titleSource === "text_excerpt") warnings.lowConfidence++;
    if (c.partyClaim) warnings.partyClaimOrAggregator++;
    if (c.duplicate === "medium") warnings.mediumDuplicateRisk++;
    if (d.latitude == null) warnings.noCoordinates++;
    outcomes.push({ id: c.id, title: c.title, status: "publishable", scope: d.locationScope });
  }
  return { matching, publishable: ok.length, skipped: [...skipped.values()], scopes, classifications, warnings, ids: ok, outcomes };
}

export async function runBulkPublish(filters: IncomingFilters, opts: { ids?: string[]; expectedCount?: number; /** Test seam: the function that publishes one report. */ publish?: typeof publishRawItem } = {}): Promise<BulkResult> {
  const publishOne = opts.publish ?? publishRawItem;
  const { matching, candidates } = await evaluate(filters, opts.ids);
  if (opts.expectedCount != null && !opts.ids && opts.expectedCount !== matching) {
    throw new PublishError(`The filtered set changed (${opts.expectedCount} reviewed, ${matching} now match). Review the summary again.`, 409);
  }
  const outcomes: BulkItemOutcome[] = [];
  let published = 0;
  let merged = 0;
  let skipped = 0;
  let failed = 0;
  for (const c of candidates) {
    if (c.skip || !c.draft) {
      skipped++;
      outcomes.push({ id: c.id, title: c.title, status: "skipped", reasonCode: c.skip, reason: c.skip ? SKIP_LABEL[c.skip] : "Skipped" });
      continue;
    }
    const d = c.draft;
    await yieldToLoop();
    try {
      // Re-checked at write time: publishRawItem refuses an item another admin published in the meantime.
      const raw = await prisma.rawIngestionItem.findUnique({ where: { id: c.id }, select: { publishedAt: true, receivedAt: true } });
      await publishOne(c.id, {
        title: d.title,
        summary: d.summary,
        eventType: d.eventType as EventType,
        severity: d.severity as Severity,
        importance: d.importance,
        verificationStatus: d.verificationStatus,
        occurredAt: (raw?.publishedAt ?? raw?.receivedAt ?? new Date()).toISOString(),
        conflictId: d.conflictId,
        locationScope: d.locationScope,
        countryCode: d.countryCode,
        region: d.region,
        adminRegion: d.adminRegion,
        city: d.city,
        locationName: d.locationName,
        latitude: d.latitude,
        longitude: d.longitude,
        locationPrecision: d.locationPrecision,
        locationEvidence: d.locationEvidence,
      });
      // publishRawItem itself decides published vs merged (canonical event matching) — read back which one happened.
      const finalStatus = await prisma.rawIngestionItem.findUnique({ where: { id: c.id }, select: { processingStatus: true } });
      if (finalStatus?.processingStatus === "merged") {
        merged++;
        outcomes.push({ id: c.id, title: c.title, status: "merged", scope: d.locationScope, reason: "Attached to an existing event (same real-world incident) instead of creating a new one" });
      } else {
        published++;
        outcomes.push({ id: c.id, title: c.title, status: "published", scope: d.locationScope });
      }
    } catch (err) {
      failed++;
      outcomes.push({ id: c.id, title: c.title, status: "failed", reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return { published, merged, skipped, failed, outcomes };
}
