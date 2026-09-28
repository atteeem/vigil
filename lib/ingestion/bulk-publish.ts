import { prisma } from "@/lib/db/client";
import { getSource } from "@/lib/db/repositories/sources";
import { extractDraft } from "@/lib/ingestion/draft";
import { listIncomingItems, type IncomingFilters } from "@/lib/ingestion/incoming-queue";
import { PublishError, publishRawItem } from "@/lib/ingestion/publish-item";
import { findDuplicateCandidates } from "@/lib/ingestion/duplicates";
import { mergeReportIntoEvent } from "@/lib/ingestion/merge-report";
import { evidenceRoleOf, isNonIndependentRole } from "@/lib/registry/source-tiers";
import { CLASSIFICATIONS, type Classification } from "@/lib/ingestion/publish-readiness";
import type { DraftSuggestionDTO, DuplicateCandidateDTO, LocationScope } from "@/lib/types/db";
import type { EventType, Severity } from "@/lib/types";

// Report != Event, same-batch corroboration (Pre-Launch Critical Correctness & Security v1 §4): bulk
// publishing used to evaluate the whole batch up front against a STALE, ingestion-time
// duplicateLikelihood snapshot, then have every candidate's publishRawItem unconditionally create a new
// Event — so several wire reports of the SAME real-world incident, submitted in the same bulk batch,
// could never discover each other and each became its own Event (the root cause behind ~1 source per
// published event at scale). The fix runs here, in the per-item PUBLISH loop (not the cheaper
// evaluate/plan preview), one candidate at a time, in order: by the time candidate N is checked, every
// earlier candidate in this SAME batch that became an Event is already committed and published:true in
// the DB, so a plain, fresh findDuplicateCandidates() call naturally sees same-batch events exactly like
// it already sees older published ones — no batch-specific matcher was invented (spec "use the EXISTING
// duplicate/event-matching engine").
//
// Two outcomes, chosen deliberately over full automatic merging at the existing MIN_SCORE(35)/"high"(70)
// advisory thresholds (which are tuned for "worth flagging to a human", not "safe with zero review" —
// e.g. two DIFFERENT incidents in the same city, hours apart, both resolved to the same gazetteer city
// centroid, can already score >=70 on conflict+region+type+time alone with zero real distance signal):
//   - AUTO-CORROBORATE only when the match is specific enough that it is not plausibly two different
//     incidents (isSafeAutoCorroboration below) — the report is attached to the matched event as an
//     additional source (mergeReportIntoEvent, the same logic the admin's manual Merge action uses) and
//     never becomes its own Event. Spec test (A): three wire reports of the same strike land in one Event.
//   - Otherwise, a match at the existing advisory "high" threshold (score >= 70) is left for a human:
//     skipped with reasonCode "likely_duplicate", now correctly computed against the SAME-BATCH state
//     instead of the stale ingestion-time snapshot (spec test (B): two different attacks, hours/locations
//     apart, must remain separate, not merged, not silently published as if unrelated).
// Relay/aggregator reports of an already-corroborated story are attached as "relay", never "corroborating"
// (mergeReportIntoEvent's own rule, spec test (C): a syndicated repeat is never independent confirmation).
// Unrelated same-country/same-conflict reports never reach either path — findDuplicateCandidates' own
// distance/time-gated scoring formula (lib/ingestion/duplicates.ts) keeps them below MIN_SCORE entirely
// (spec test (D)).
const AUTO_CORROBORATE_MIN_SCORE = 80;
const AUTO_CORROBORATE_MAX_MINUTES_APART = 180;
const AUTO_CORROBORATE_MIN_TITLE_SIMILARITY = 0.5;

function isSafeAutoCorroboration(candidate: DuplicateCandidateDTO): boolean {
  return (
    candidate.score >= AUTO_CORROBORATE_MIN_SCORE &&
    candidate.sameEventType &&
    candidate.titleSimilarity >= AUTO_CORROBORATE_MIN_TITLE_SIMILARITY &&
    candidate.minutesApart != null &&
    candidate.minutesApart <= AUTO_CORROBORATE_MAX_MINUTES_APART
  );
}

// "Publish filtered" / "Publish selected": publishes the reports that match the queue's current filters (or a chosen
// subset of them) through the SAME publishRawItem as the single Publish button, using the automatic draft (the
// source's own headline, a neutral excerpt summary, the hierarchical location). Nothing is bypassed:
//   - only pending reports are considered; anything already published/rejected/merged is skipped with a reason;
//   - a report is skipped (not failed) when the draft cannot stand on its own: no usable title or text, automated
//     processing disabled for its source, no location AND no conflict association, or a likely duplicate of a
//     published event (a person should merge or publish those deliberately);
//   - one report failing never stops the rest; the result lists every skip and failure with its reason.
// A country-level report with no coordinates is fully publishable: coordinates are never required for it.

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
  status: "publishable" | "published" | "corroborated" | "skipped" | "failed";
  reason?: string;
  reasonCode?: SkipReason;
  scope?: LocationScope;
  /** Set only when status is "corroborated": the existing event (created earlier in this same batch, or
   * already published) this report was attached to instead of becoming its own Event. */
  mergedIntoEventId?: string;
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
  /** Attached to an existing event (created earlier in this same batch, or already published) as an
   * additional source instead of becoming its own Event — see the module comment above. */
  corroborated: number;
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
      else if (item.duplicateLikelihood === "high") c.skip = "likely_duplicate";
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
  let corroborated = 0;
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
      const occurredAt = raw?.publishedAt ?? raw?.receivedAt ?? new Date();

      // Same-batch corroboration (spec §4): freshly re-checked here, against real DB state — which
      // already includes every event an earlier candidate in THIS batch just created — rather than the
      // evaluate()-phase's stale, skipDuplicates:true snapshot. See the module comment above.
      const duplicateMatches = await findDuplicateCandidates({
        title: d.title,
        eventType: d.eventType,
        latitude: d.latitude,
        longitude: d.longitude,
        countryCode: d.countryCode,
        region: d.region,
        conflictId: d.conflictId,
        occurredAt,
      });
      const topMatch = duplicateMatches[0] ?? null;

      if (topMatch && isSafeAutoCorroboration(topMatch)) {
        const outcome = await mergeReportIntoEvent(c.id, topMatch.eventId);
        corroborated++;
        outcomes.push({ id: c.id, title: c.title, status: "corroborated", scope: d.locationScope, mergedIntoEventId: outcome.eventId, reason: `Attached to an existing event (${Math.round(topMatch.score)}% match: ${topMatch.reasons.join(", ")})` });
        continue;
      }
      if (topMatch && topMatch.score >= 70) {
        skipped++;
        outcomes.push({ id: c.id, title: c.title, status: "skipped", reasonCode: "likely_duplicate", reason: `${SKIP_LABEL.likely_duplicate} (${Math.round(topMatch.score)}% match to an event in this same batch or already published)` });
        continue;
      }

      await publishOne(c.id, {
        title: d.title,
        summary: d.summary,
        eventType: d.eventType as EventType,
        severity: d.severity as Severity,
        importance: d.importance,
        verificationStatus: d.verificationStatus,
        occurredAt: occurredAt.toISOString(),
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
      published++;
      outcomes.push({ id: c.id, title: c.title, status: "published", scope: d.locationScope });
    } catch (err) {
      failed++;
      outcomes.push({ id: c.id, title: c.title, status: "failed", reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return { published, corroborated, skipped, failed, outcomes };
}
