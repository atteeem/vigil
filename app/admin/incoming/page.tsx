"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X, GitMerge, Pencil, ExternalLink, Sparkles, Eye, RefreshCw, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LocationScopeFields } from "@/components/admin/location-scope-fields";
import { BulkPublishDialog } from "@/components/admin/bulk-publish-dialog";
import { locationDraftError } from "@/lib/geocoding/scope-rules";
import { EVENT_TYPES, SEVERITY_LEVELS, REGIONS } from "@/lib/types";
import { EVENT_TYPE_LABEL, getEventTypeLabel } from "@/components/events/event-type-icon";
import { EXTRACTED_FACT_FIELD_LABEL } from "@/lib/ingestion/field-labels";
import {
  DB_VERIFICATION_STATUSES,
  PROCESSING_STATUSES,
  DUPLICATE_LIKELIHOODS,
  INCOMING_SORTS,
  EXTRACTED_FACT_FIELDS,
  type RawIngestionItemWithSourceDTO,
  type ConflictDTO,
  type SourceDTO,
  type DraftSuggestionDTO,
  type DuplicateCandidateDTO,
  type ProcessingStatus,
  type DuplicateLikelihood,
  type IncomingSort,
  type ExtractedFactField,
  type ExtractedFactsResponseDTO,
  type LocationScope,
} from "@/lib/types/db";
import { CLASSIFICATIONS, READINESS_STATUSES, type Classification, type ReadinessStatus } from "@/lib/ingestion/publish-readiness";
import { timeAgo } from "@/lib/utils";
import type { ConflictEvent } from "@/lib/types";

interface IncomingFilters {
  status: ProcessingStatus;
  sourceId: string;
  conflictId: string;
  region: string;
  eventType: string;
  duplicateLikelihood: DuplicateLikelihood | "";
  maxAgeHours: string;
  sort: IncomingSort;
  readiness: ReadinessStatus | "";
  classification: Classification | "";
  conflictMatchLevel: "high" | "medium" | "none" | "";
}

const DEFAULT_FILTERS: IncomingFilters = {
  status: "pending",
  sourceId: "",
  conflictId: "",
  region: "",
  eventType: "",
  duplicateLikelihood: "",
  maxAgeHours: "",
  sort: "newest",
  readiness: "",
  classification: "",
  conflictMatchLevel: "",
};

const CLASSIFICATION_LABEL: Record<Classification, string> = {
  CONFLICT_EVENT: "Conflict event",
  COUNTRY_DEVELOPMENT: "Country development",
  GLOBAL_LIVE_EVENT: "Global / live event",
  DUPLICATE: "Duplicate",
  INSUFFICIENT: "Insufficient",
  PARTY_CLAIM: "Party claim",
  OTHER: "Other",
};

const READINESS_LABEL: Record<ReadinessStatus, string> = { READY: "Ready", NEEDS_REVIEW: "Needs review", BLOCKED: "Blocked" };

const AGE_OPTIONS: { label: string; value: string }[] = [
  { label: "Any age", value: "" },
  { label: "Last hour", value: "1" },
  { label: "Last 6 hours", value: "6" },
  { label: "Last 24 hours", value: "24" },
  { label: "Last 7 days", value: "168" },
];

const FACT_FIELD_LABEL = EXTRACTED_FACT_FIELD_LABEL;

// Below this, a fact is visually flagged as low-confidence (spec "make
// low-confidence fields visually distinct") — chosen to match this
// extractor's own honesty-over-guessing scale: ambiguous locations and
// the no-signal severity default both sit at 0.35 and should read as
// "needs a human look", while single-gazetteer-match/keyword-match facts
// (0.65+) should not.
const LOW_CONFIDENCE_THRESHOLD = 0.5;

const SORT_LABEL: Record<IncomingSort, string> = {
  newest: "Newest",
  oldest: "Oldest",
  importance: "Highest importance",
  duplicate: "Highest duplicate probability",
};

function buildIncomingQuery(filters: IncomingFilters): string {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.sourceId) params.set("sourceId", filters.sourceId);
  if (filters.conflictId) params.set("conflictId", filters.conflictId);
  if (filters.region) params.set("region", filters.region);
  if (filters.eventType) params.set("eventType", filters.eventType);
  if (filters.duplicateLikelihood) params.set("duplicateLikelihood", filters.duplicateLikelihood);
  if (filters.maxAgeHours) params.set("maxAgeHours", filters.maxAgeHours);
  if (filters.sort) params.set("sort", filters.sort);
  if (filters.readiness) params.set("readiness", filters.readiness);
  if (filters.classification) params.set("classification", filters.classification);
  if (filters.conflictMatchLevel) params.set("conflictMatchLevel", filters.conflictMatchLevel);
  return params.toString();
}

interface PublishDraft {
  title: string;
  summary: string;
  eventType: string;
  locationName: string;
  latitude: string;
  longitude: string;
  locationPrecision: string;
  locationScope: LocationScope;
  city: string;
  adminRegion: string;
  locationEvidence: string;
  countryCode: string;
  region: string;
  occurredAt: string;
  severity: string;
  importance: string;
  verificationStatus: string;
  conflictId: string;
}

function draftFromItem(item: RawIngestionItemWithSourceDTO): PublishDraft {
  const occurred = item.publishedAt ?? item.receivedAt;
  return {
    title: item.originalTitle ?? "",
    summary: item.originalText ?? "",
    eventType: "other",
    locationName: "",
    latitude: "",
    longitude: "",
    locationPrecision: "unknown",
    locationScope: "unknown",
    city: "",
    adminRegion: "",
    locationEvidence: "",
    countryCode: "",
    region: "",
    occurredAt: new Date(occurred).toISOString().slice(0, 16),
    severity: "elevated",
    importance: "50",
    verificationStatus: "reported",
    conflictId: "",
  };
}

function draftFromSuggestion(item: RawIngestionItemWithSourceDTO, s: DraftSuggestionDTO): PublishDraft {
  const occurred = item.publishedAt ?? item.receivedAt;
  return {
    title: s.title,
    summary: s.summary,
    eventType: s.eventType,
    locationName: s.locationName ?? "",
    latitude: s.latitude !== null ? String(s.latitude) : "",
    longitude: s.longitude !== null ? String(s.longitude) : "",
    locationPrecision: s.locationPrecision ?? "unknown",
    locationScope: s.locationScope,
    city: s.city ?? "",
    adminRegion: s.adminRegion ?? "",
    locationEvidence: s.locationEvidence,
    countryCode: s.countryCode ?? "",
    region: s.region ?? "",
    occurredAt: new Date(occurred).toISOString().slice(0, 16),
    severity: s.severity,
    importance: String(s.importance),
    verificationStatus: s.verificationStatus,
    conflictId: s.conflictId ?? "",
  };
}

function buildPublishBody(draft: PublishDraft) {
  const point = draft.latitude.trim() !== "" && draft.longitude.trim() !== "";
  return {
    title: draft.title,
    summary: draft.summary,
    eventType: draft.eventType,
    locationName: draft.locationName || undefined,
    locationScope: draft.locationScope,
    city: draft.city || undefined,
    adminRegion: draft.adminRegion || undefined,
    latitude: point ? Number(draft.latitude) : null,
    longitude: point ? Number(draft.longitude) : null,
    locationPrecision: draft.locationPrecision,
    locationEvidence: draft.locationEvidence || undefined,
    countryCode: draft.countryCode || undefined,
    region: draft.region || undefined,
    occurredAt: new Date(draft.occurredAt).toISOString(),
    severity: draft.severity,
    importance: Number(draft.importance),
    verificationStatus: draft.verificationStatus,
    conflictId: draft.conflictId || null,
  };
}

export default function AdminIncomingPage() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<IncomingFilters>(DEFAULT_FILTERS);
  const incomingQuery = buildIncomingQuery(filters);
  const { data: items = [], isLoading: loading } = useQuery({
    queryKey: ["admin", "incoming", filters],
    queryFn: async (): Promise<RawIngestionItemWithSourceDTO[]> =>
      (await fetch(`/api/admin/incoming?${incomingQuery}`)).json(),
  });
  const { data: publishedEvents = [] } = useQuery({
    queryKey: ["events", "published"],
    queryFn: async (): Promise<ConflictEvent[]> => (await fetch("/api/events")).json(),
  });
  const { data: conflicts = [] } = useQuery({
    queryKey: ["admin", "conflicts", "selectable"],
    queryFn: async (): Promise<ConflictDTO[]> => (await fetch("/api/admin/conflicts?selectable=true")).json(),
  });
  const { data: sources = [] } = useQuery({
    queryKey: ["admin", "sources"],
    queryFn: async (): Promise<SourceDTO[]> => (await fetch("/api/admin/sources")).json(),
  });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, PublishDraft>>({});
  const [suggestions, setSuggestions] = useState<Record<string, DraftSuggestionDTO | null | undefined>>({});
  const [duplicates, setDuplicates] = useState<Record<string, DuplicateCandidateDTO[]>>({});
  const [ignoredDuplicates, setIgnoredDuplicates] = useState<Record<string, Set<string>>>({});
  const [checkingDuplicates, setCheckingDuplicates] = useState<string | null>(null);
  const [mergeTargets, setMergeTargets] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  const [facts, setFacts] = useState<Record<string, ExtractedFactsResponseDTO | undefined>>({});
  const [extractingFacts, setExtractingFacts] = useState<string | null>(null);
  const [editingFactId, setEditingFactId] = useState<string | null>(null);
  const [factEdits, setFactEdits] = useState<Record<string, string>>({});
  const [publishing, setPublishing] = useState<Record<string, boolean>>({});
  const [publishErrors, setPublishErrors] = useState<Record<string, string | undefined>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<null | { ids?: string[] }>(null);

  const refresh = () =>
    queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === "admin" || q.queryKey[0] === "events" });

  function getDraft(item: RawIngestionItemWithSourceDTO): PublishDraft {
    return drafts[item.id] ?? draftFromItem(item);
  }

  function setDraft(id: string, patch: Partial<PublishDraft>) {
    setDrafts((prev) => ({ ...prev, [id]: { ...(prev[id] ?? draftFromItem(items.find((i) => i.id === id)!)), ...patch } }));
  }

  async function toggleReview(item: RawIngestionItemWithSourceDTO) {
    const willExpand = expandedId !== item.id;
    setExpandedId(willExpand ? item.id : null);
    if (!willExpand) return;

    if (!(item.id in suggestions)) {
      const res = await fetch(`/api/admin/incoming/${item.id}/draft`);
      const { draft }: { draft: DraftSuggestionDTO | null } = await res.json();
      setSuggestions((prev) => ({ ...prev, [item.id]: draft }));
      if (draft) {
        setDrafts((prev) => (prev[item.id] ? prev : { ...prev, [item.id]: draftFromSuggestion(item, draft) }));
        setDuplicates((prev) => ({ ...prev, [item.id]: draft.duplicates }));
      }
    }

    if (!(item.id in facts)) {
      let data = await fetchFacts(item.id);
      // Sources with autoProcessing off (or an item ingested before this
      // feature existed) have nothing persisted yet — extract on demand
      // rather than showing an empty panel forever.
      if (data.facts.length === 0) {
        await fetch(`/api/admin/incoming/${item.id}/extract`, { method: "POST" });
        data = await fetchFacts(item.id);
      }
    }
  }

  async function fetchFacts(itemId: string): Promise<ExtractedFactsResponseDTO> {
    const res = await fetch(`/api/admin/incoming/${itemId}/facts`);
    const data: ExtractedFactsResponseDTO = await res.json();
    setFacts((prev) => ({ ...prev, [itemId]: data }));
    return data;
  }

  async function reextractFacts(itemId: string) {
    setExtractingFacts(itemId);
    await fetch(`/api/admin/incoming/${itemId}/extract`, { method: "POST" });
    await fetchFacts(itemId);
    setExtractingFacts(null);
  }

  async function patchFact(itemId: string, factId: string, action: "accept" | "reject" | "edit", value?: string) {
    await fetch(`/api/admin/incoming/${itemId}/facts/${factId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, value }),
    });
    await fetchFacts(itemId);
  }

  async function recheckDuplicates(item: RawIngestionItemWithSourceDTO) {
    const draft = getDraft(item);
    if (!draft.latitude || !draft.longitude) return;
    setCheckingDuplicates(item.id);
    const res = await fetch(`/api/admin/incoming/${item.id}/duplicates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: draft.title,
        eventType: draft.eventType,
        latitude: Number(draft.latitude),
        longitude: Number(draft.longitude),
        countryCode: draft.countryCode || null,
        region: draft.region || null,
        conflictId: draft.conflictId || null,
        occurredAt: new Date(draft.occurredAt).toISOString(),
      }),
    });
    const nextCandidates = await res.json();
    setDuplicates((prev) => ({ ...prev, [item.id]: nextCandidates }));
    setCheckingDuplicates(null);
  }

  function ignoreDuplicate(itemId: string, eventId: string) {
    setIgnoredDuplicates((prev) => {
      const next = new Set(prev[itemId] ?? []);
      next.add(eventId);
      return { ...prev, [itemId]: next };
    });
  }

  async function mergeIntoEvent(itemId: string, eventId: string) {
    await fetch(`/api/admin/incoming/${itemId}/merge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId, relationship: "corroborating" }),
    });
    refresh();
  }

  /** Validates the draft against its geographic scope, then publishes through the one publish route. Returns an error
   * message (shown inline on the report) or null on success. */
  async function submitPublish(item: RawIngestionItemWithSourceDTO, draft: PublishDraft): Promise<string | null> {
    if (!draft.title.trim() || !draft.summary.trim()) return "A title and a summary are required to publish.";
    const locationError = locationDraftError(draft);
    if (locationError) return locationError;
    const res = await fetch(`/api/admin/incoming/${item.id}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildPublishBody(draft)),
    });
    if (!res.ok) return ((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Publish failed";
    return null;
  }

  // Review form's Publish: the draft the reviewer has been editing.
  async function publish(item: RawIngestionItemWithSourceDTO) {
    setPublishErrors((p) => ({ ...p, [item.id]: undefined }));
    const error = await submitPublish(item, getDraft(item));
    if (error) {
      setPublishErrors((p) => ({ ...p, [item.id]: error }));
      return;
    }
    refresh();
  }

  // Quick Publish next to Review: the same automatic draft the review form would open with (source headline, neutral
  // summary, hierarchical location), through the same validation and publish route.
  async function quickPublish(item: RawIngestionItemWithSourceDTO) {
    setPublishing((p) => ({ ...p, [item.id]: true }));
    setPublishErrors((p) => ({ ...p, [item.id]: undefined }));
    try {
      let draft = drafts[item.id];
      if (!draft) {
        const res = await fetch(`/api/admin/incoming/${item.id}/draft`);
        const { draft: suggestion }: { draft: DraftSuggestionDTO | null } = await res.json();
        if (suggestion) {
          setSuggestions((prev) => ({ ...prev, [item.id]: suggestion }));
          draft = draftFromSuggestion(item, suggestion);
        } else draft = draftFromItem(item); // automated processing is off: publish from source data only
      }
      const error = await submitPublish(item, draft);
      if (error) setPublishErrors((p) => ({ ...p, [item.id]: error }));
      else refresh();
    } finally {
      setPublishing((p) => ({ ...p, [item.id]: false }));
    }
  }

  async function reject(id: string) {
    await fetch(`/api/admin/incoming/${id}/reject`, { method: "POST" });
    refresh();
  }

  async function merge(id: string) {
    const eventId = mergeTargets[id];
    if (!eventId) {
      alert("Pick an existing event to merge into first.");
      return;
    }
    await mergeIntoEvent(id, eventId);
  }

  async function saveEdit(item: RawIngestionItemWithSourceDTO, title: string, text: string) {
    await fetch(`/api/admin/incoming/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ originalTitle: title, originalText: text }),
    });
    setEditing((prev) => ({ ...prev, [item.id]: false }));
    refresh();
  }

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold text-ink">Incoming Reports</h1>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="incoming-actions">
        <p className="text-sm text-ink-dim" data-testid="incoming-count">
          <strong className="text-ink" data-testid="incoming-count-number">{loading ? "…" : items.length}</strong> item{items.length === 1 ? "" : "s"} matching filters
          <span className="text-xs text-ink-faint"> · nothing here auto-publishes</span>
        </p>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-1.5 text-xs text-ink-faint">
            <input
              type="checkbox"
              data-testid="select-all-visible"
              checked={items.length > 0 && items.every((i) => selectedIds.has(i.id))}
              onChange={(e) => setSelectedIds(e.target.checked ? new Set(items.map((i) => i.id)) : new Set())}
            />
            Select all visible
          </label>
          <Button size="sm" variant="outline" disabled={selectedIds.size === 0} onClick={() => setBulk({ ids: [...selectedIds] })} data-testid="publish-selected">
            Publish selected ({selectedIds.size})
          </Button>
          <Button size="sm" variant="primary" disabled={loading || items.length === 0} onClick={() => setBulk({})} data-testid="publish-filtered">
            <Check className="h-3.5 w-3.5" /> Publish filtered ({loading ? "…" : items.length})
          </Button>
        </div>
      </div>

      <Card className="mb-4 flex flex-wrap items-end gap-3 p-3" data-testid="incoming-filters">
        <label className="text-xs text-ink-faint">
          Source
          <select
            className="mt-1 rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-ink"
            value={filters.sourceId}
            onChange={(e) => setFilters((f) => ({ ...f, sourceId: e.target.value }))}
          >
            <option value="">All sources</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-ink-faint">
          Conflict
          <select
            className="mt-1 rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-ink"
            value={filters.conflictId}
            onChange={(e) => setFilters((f) => ({ ...f, conflictId: e.target.value }))}
          >
            <option value="">All conflicts</option>
            {conflicts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-ink-faint">
          Region
          <select
            className="mt-1 rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-ink"
            value={filters.region}
            onChange={(e) => setFilters((f) => ({ ...f, region: e.target.value }))}
          >
            <option value="">All regions</option>
            {REGIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-ink-faint">
          Event type
          <select
            className="mt-1 rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-ink"
            value={filters.eventType}
            onChange={(e) => setFilters((f) => ({ ...f, eventType: e.target.value }))}
          >
            <option value="">All types</option>
            {EVENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {EVENT_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-ink-faint">
          Status
          <select
            className="mt-1 rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-ink"
            value={filters.status}
            onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value as ProcessingStatus }))}
          >
            {PROCESSING_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-ink-faint">
          Duplicate likelihood
          <select
            className="mt-1 rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-ink"
            value={filters.duplicateLikelihood}
            onChange={(e) => setFilters((f) => ({ ...f, duplicateLikelihood: e.target.value as DuplicateLikelihood | "" }))}
          >
            <option value="">Any</option>
            {DUPLICATE_LIKELIHOODS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-ink-faint">
          Readiness
          <select
            className="mt-1 rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-ink"
            value={filters.readiness}
            onChange={(e) => setFilters((f) => ({ ...f, readiness: e.target.value as ReadinessStatus | "" }))}
          >
            <option value="">Any</option>
            {READINESS_STATUSES.map((r) => (
              <option key={r} value={r}>
                {READINESS_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-ink-faint">
          Classification
          <select
            className="mt-1 rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-ink"
            value={filters.classification}
            onChange={(e) => setFilters((f) => ({ ...f, classification: e.target.value as Classification | "" }))}
          >
            <option value="">Any</option>
            {CLASSIFICATIONS.map((c) => (
              <option key={c} value={c}>
                {CLASSIFICATION_LABEL[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-ink-faint">
          Conflict-match confidence
          <select
            className="mt-1 rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-ink"
            value={filters.conflictMatchLevel}
            onChange={(e) => setFilters((f) => ({ ...f, conflictMatchLevel: e.target.value as "high" | "medium" | "none" | "" }))}
          >
            <option value="">Any</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="none">None</option>
          </select>
        </label>
        <label className="text-xs text-ink-faint">
          Age
          <select
            className="mt-1 rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-ink"
            value={filters.maxAgeHours}
            onChange={(e) => setFilters((f) => ({ ...f, maxAgeHours: e.target.value }))}
          >
            {AGE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-ink-faint">
          Sort
          <select
            className="mt-1 rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-ink"
            value={filters.sort}
            onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value as IncomingSort }))}
          >
            {INCOMING_SORTS.map((s) => (
              <option key={s} value={s}>
                {SORT_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        {JSON.stringify(filters) !== JSON.stringify(DEFAULT_FILTERS) && (
          <Button size="sm" variant="ghost" onClick={() => setFilters(DEFAULT_FILTERS)}>
            Reset filters
          </Button>
        )}
      </Card>

      {loading && <p className="text-sm text-ink-faint">Loading…</p>}
      {!loading && items.length === 0 && (
        <Card className="p-8 text-center text-sm text-ink-faint">
          No reports match these filters. Enable an RSS source with auto-ingest in Source Manager, or submit a manual
          report via the API to populate this queue.
        </Card>
      )}

      <div className="space-y-3">
        {items.map((item) => {
          const draft = getDraft(item);
          const expanded = expandedId === item.id;
          const isEditing = editing[item.id];
          const suggestion = suggestions[item.id];
          const itemDuplicates = (
            duplicates[item.id] ?? (item.topDuplicate ? [item.topDuplicate] : [])
          ).filter((d) => !ignoredDuplicates[item.id]?.has(d.eventId));
          const showDuplicateBadge = item.duplicateLikelihood !== "none" && itemDuplicates.length > 0;

          return (
            <Card key={item.id} className="p-4" data-testid={`incoming-item-${item.id}`}>
              {/* ---------- SOURCE DATA (always shown, never auto-generated) ---------- */}
              <div className="flex items-start gap-3">
                {item.processingStatus === "pending" && (
                  <input
                    type="checkbox"
                    className="mt-1 shrink-0"
                    aria-label={`Select ${item.originalTitle ?? "report"}`}
                    data-testid={`select-${item.id}`}
                    checked={selectedIds.has(item.id)}
                    onChange={(e) =>
                      setSelectedIds((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(item.id);
                        else next.delete(item.id);
                        return next;
                      })
                    }
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-ink-faint">
                    <span className="rounded bg-white/5 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-ink-faint">
                      Source Data
                    </span>
                    <span className="font-medium text-ink-dim">{item.source.name}</span>
                    <span>·</span>
                    <span>{timeAgo(item.receivedAt)}</span>
                    {item.processingStatus === "pending" && (
                      <span
                        data-testid={`readiness-badge-${item.id}`}
                        title={item.finalReadinessReasons.join("; ")}
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          item.finalReadiness === "READY" ? "bg-stable/10 text-stable" : item.finalReadiness === "BLOCKED" ? "bg-high/10 text-high" : "bg-white/5 text-ink-faint"
                        }`}
                      >
                        {READINESS_LABEL[item.finalReadiness as ReadinessStatus]} · {CLASSIFICATION_LABEL[item.finalClassification as Classification]}
                      </span>
                    )}
                    {showDuplicateBadge && (
                      <span
                        data-testid={`duplicate-badge-${item.id}`}
                        className="inline-flex items-center gap-1 rounded-full bg-high/10 px-2 py-0.5 text-[10px] font-medium text-high"
                      >
                        <AlertTriangle className="h-3 w-3" /> Possible duplicate — {itemDuplicates[0]!.score}%
                      </span>
                    )}
                    {item.source.type === "telegram" && item.source.permissionStatus !== "authorized" && (
                      <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-ink-faint">
                        relay — not independent confirmation
                      </span>
                    )}
                  </div>
                  {isEditing ? (
                    <div className="space-y-2">
                      <input
                        className="w-full rounded-lg border border-border bg-surface px-2 py-1 text-sm text-ink"
                        defaultValue={item.originalTitle ?? ""}
                        id={`title-${item.id}`}
                      />
                      <textarea
                        className="w-full rounded-lg border border-border bg-surface px-2 py-1 text-sm text-ink"
                        rows={2}
                        defaultValue={item.originalText ?? ""}
                        id={`text-${item.id}`}
                      />
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => {
                          const title = (document.getElementById(`title-${item.id}`) as HTMLInputElement).value;
                          const text = (document.getElementById(`text-${item.id}`) as HTMLTextAreaElement).value;
                          saveEdit(item, title, text);
                        }}
                      >
                        Save
                      </Button>
                    </div>
                  ) : (
                    <>
                      <p className="font-medium text-ink">{item.originalTitle || "(no title)"}</p>
                      <p className="mt-0.5 line-clamp-2 text-sm text-ink-dim">{item.originalText}</p>
                    </>
                  )}
                  {item.originalUrl && (
                    <a
                      href={item.originalUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-flex items-center gap-1 text-xs text-accent hover:underline"
                    >
                      Original source <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1" data-testid={`row-actions-${item.id}`}>
                  <div className="flex items-center gap-1.5">
                    <Button size="icon" variant="ghost" onClick={() => setEditing((p) => ({ ...p, [item.id]: !isEditing }))} aria-label="Edit">
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => reject(item.id)} aria-label="Reject">
                      <X className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="accent" onClick={() => toggleReview(item)}>
                      {expanded ? "Close" : "Review"}
                    </Button>
                    {/* Hidden while the review form is open: the form has its own Publish (one Publish per card). */}
                    {!expanded && item.processingStatus === "pending" && (
                      <Button size="sm" variant="primary" onClick={() => quickPublish(item)} disabled={publishing[item.id]} data-testid={`quick-publish-${item.id}`}>
                        <Check className="h-3.5 w-3.5" /> {publishing[item.id] ? "Publishing…" : "Publish"}
                      </Button>
                    )}
                  </div>
                  {publishErrors[item.id] && !expanded && (
                    <p role="alert" className="max-w-xs text-right text-xs text-high" data-testid={`publish-error-${item.id}`}>
                      {publishErrors[item.id]}
                    </p>
                  )}
                </div>
              </div>

              {expanded && (
                <div className="mt-4 border-t border-border pt-4">
                  {/* ---------- AUTOMATED SUGGESTION (clearly distinct from source data above) ---------- */}
                  {suggestion === undefined ? (
                    <p className="mb-4 text-xs text-ink-faint">Generating automated suggestion…</p>
                  ) : suggestion === null ? (
                    <p className="mb-4 text-xs text-ink-faint">
                      Automated processing is disabled for this source — review from source data only.
                    </p>
                  ) : (
                    <div className="mb-4 rounded-lg border border-accent/25 bg-accent-dim/40 p-3">
                      <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                        <Sparkles className="h-3 w-3" /> Automated Suggestion — not source data, review before publishing
                      </p>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-ink-dim sm:grid-cols-3">
                        <span>Event type: {EVENT_TYPE_LABEL[suggestion.eventType as keyof typeof EVENT_TYPE_LABEL] ?? suggestion.eventType}</span>
                        <span>
                          Location:{" "}
                          {suggestion.locationScope === "unknown"
                            ? suggestion.locationSource === "ambiguous"
                              ? `${suggestion.locationName ?? "?"} (ambiguous)`
                              : "not detected"
                            : `${suggestion.locationName ?? suggestion.countryName} (${suggestion.locationScope})`}
                        </span>
                        <span>Conflict: {suggestion.conflictName ?? "none detected"}</span>
                        <span>Verification: {suggestion.verificationStatus}</span>
                        <span>Severity: {suggestion.severity}</span>
                        <span>
                          Duplicate probability:{" "}
                          {suggestion.duplicates[0] ? `${suggestion.duplicates[0].score}%` : "none found"}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* ---------- STRUCTURED FACTS (spec "Structured Event Intelligence") ---------- */}
                  {(() => {
                    const itemFacts = facts[item.id];
                    if (!itemFacts) return null;
                    const grouped = new Map<ExtractedFactField, typeof itemFacts.facts>();
                    for (const f of itemFacts.facts) {
                      const arr = grouped.get(f.field) ?? [];
                      arr.push(f);
                      grouped.set(f.field, arr);
                    }
                    const diffByField = new Map(itemFacts.fieldDiffs.map((d) => [d.field, d]));
                    return (
                      <div
                        className="mb-4 rounded-lg border border-border p-3"
                        data-testid={`structured-facts-${item.id}`}
                      >
                        <div className="mb-2 flex items-center justify-between">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                            Structured Facts — extracted, not verified
                          </p>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => reextractFacts(item.id)}
                            disabled={extractingFacts === item.id}
                          >
                            <RefreshCw className={`h-3.5 w-3.5 ${extractingFacts === item.id ? "animate-spin" : ""}`} />{" "}
                            Re-extract
                          </Button>
                        </div>

                        {itemFacts.matchedEvent && (
                          <p className="mb-2 text-[11px] text-ink-faint">
                            Compared against matched event:{" "}
                            <a
                              href={`/event/${itemFacts.matchedEvent.slug}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-accent hover:underline"
                            >
                              {itemFacts.matchedEvent.title}
                            </a>
                          </p>
                        )}

                        {itemFacts.facts.length === 0 ? (
                          <p className="text-xs text-ink-faint">No structured facts extracted from this report.</p>
                        ) : (
                          <div className="space-y-2">
                            {EXTRACTED_FACT_FIELDS.filter((field) => grouped.has(field)).map((field) => {
                              const fieldFacts = grouped.get(field)!;
                              const diff = diffByField.get(field);
                              return (
                                <div key={field} className="rounded-lg border border-border/60 px-2.5 py-2">
                                  <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                                    <span>{FACT_FIELD_LABEL[field]}</span>
                                    {diff && (
                                      <span
                                        data-testid={`fact-diff-${item.id}-${field}`}
                                        className={`rounded-full px-1.5 py-0.5 text-[9px] normal-case ${
                                          diff.differs ? "bg-high/15 text-high" : "bg-white/5 text-ink-faint"
                                        }`}
                                      >
                                        {diff.differs
                                          ? `differs from event (currently: ${diff.currentEventValue ?? "unset"})`
                                          : "matches event"}
                                      </span>
                                    )}
                                  </div>
                                  <div className="space-y-1">
                                    {fieldFacts.map((fact) => {
                                      const lowConfidence = fact.confidence < LOW_CONFIDENCE_THRESHOLD;
                                      return (
                                        <div
                                          key={fact.id}
                                          data-testid={`fact-${fact.id}`}
                                          className={`flex flex-wrap items-center gap-1.5 rounded-md px-2 py-1 text-xs ${
                                            lowConfidence ? "border border-high/30 bg-high/10" : "bg-white/5"
                                          } ${fact.status === "rejected" ? "opacity-50" : ""}`}
                                        >
                                          {editingFactId === fact.id ? (
                                            <>
                                              <input
                                                className="min-w-0 flex-1 rounded border border-border bg-surface px-2 py-1 text-xs text-ink"
                                                value={factEdits[fact.id] ?? fact.value}
                                                onChange={(e) =>
                                                  setFactEdits((prev) => ({ ...prev, [fact.id]: e.target.value }))
                                                }
                                              />
                                              <Button
                                                size="sm"
                                                variant="primary"
                                                onClick={() => {
                                                  patchFact(item.id, fact.id, "edit", factEdits[fact.id] ?? fact.value);
                                                  setEditingFactId(null);
                                                }}
                                              >
                                                Save
                                              </Button>
                                              <Button size="sm" variant="ghost" onClick={() => setEditingFactId(null)}>
                                                Cancel
                                              </Button>
                                            </>
                                          ) : (
                                            <>
                                              <span
                                                className="max-w-[16rem] truncate font-medium text-ink"
                                                title={fact.originalValue ? `Originally extracted as: ${fact.originalValue}` : fact.value}
                                              >
                                                {fact.value}
                                              </span>
                                              <span
                                                data-testid={`fact-confidence-${fact.id}`}
                                                className={`rounded-full px-1.5 py-0.5 text-[9px] ${
                                                  lowConfidence ? "bg-high/20 text-high" : "bg-white/10 text-ink-faint"
                                                }`}
                                              >
                                                {Math.round(fact.confidence * 100)}% confidence
                                              </span>
                                              <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[9px] text-ink-faint">
                                                {fact.status}
                                              </span>
                                              <span
                                                className="max-w-[14rem] truncate text-ink-faint"
                                                title={fact.source}
                                              >
                                                {fact.source}
                                              </span>
                                              <div className="ml-auto flex shrink-0 gap-1">
                                                {fact.status !== "accepted" && (
                                                  <Button
                                                    size="icon"
                                                    variant="ghost"
                                                    aria-label="Accept fact"
                                                    onClick={() => patchFact(item.id, fact.id, "accept")}
                                                  >
                                                    <Check className="h-3 w-3" />
                                                  </Button>
                                                )}
                                                {fact.status !== "rejected" && (
                                                  <Button
                                                    size="icon"
                                                    variant="ghost"
                                                    aria-label="Reject fact"
                                                    onClick={() => patchFact(item.id, fact.id, "reject")}
                                                  >
                                                    <X className="h-3 w-3" />
                                                  </Button>
                                                )}
                                                <Button
                                                  size="icon"
                                                  variant="ghost"
                                                  aria-label="Edit fact"
                                                  onClick={() => {
                                                    setEditingFactId(fact.id);
                                                    setFactEdits((prev) => ({ ...prev, [fact.id]: fact.value }));
                                                  }}
                                                >
                                                  <Pencil className="h-3 w-3" />
                                                </Button>
                                              </div>
                                            </>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-xs text-ink-faint">
                      Title
                      <input
                        className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                        value={draft.title}
                        onChange={(e) => setDraft(item.id, { title: e.target.value })}
                      />
                    </label>
                    <label className="text-xs text-ink-faint">
                      Event type
                      <select
                        aria-label="Event type"
                        className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                        value={draft.eventType}
                        onChange={(e) => setDraft(item.id, { eventType: e.target.value })}
                      >
                        {EVENT_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {EVENT_TYPE_LABEL[t]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="sm:col-span-2 text-xs text-ink-faint">
                      Summary (neutral; taken from the source excerpt unless edited)
                      <textarea
                        rows={2}
                        className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                        value={draft.summary}
                        onChange={(e) => setDraft(item.id, { summary: e.target.value })}
                      />
                    </label>
                    <label className="text-xs text-ink-faint">
                      Conflict
                      <select
                        aria-label="Conflict"
                        className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                        value={draft.conflictId}
                        onChange={(e) => setDraft(item.id, { conflictId: e.target.value })}
                      >
                        <option value="">None</option>
                        {conflicts.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs text-ink-faint">
                      Occurred at
                      <input
                        type="datetime-local"
                        className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                        value={draft.occurredAt}
                        onChange={(e) => setDraft(item.id, { occurredAt: e.target.value })}
                      />
                    </label>

                    <LocationScopeFields draft={draft} onChange={(patch) => setDraft(item.id, patch)} suggestion={suggestion} />

                    <label className="text-xs text-ink-faint">
                      Severity
                      <select
                        className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                        value={draft.severity}
                        onChange={(e) => setDraft(item.id, { severity: e.target.value })}
                      >
                        {SEVERITY_LEVELS.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs text-ink-faint">
                      Importance (0–100)
                      <input
                        type="number"
                        min={0}
                        max={100}
                        className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                        value={draft.importance}
                        onChange={(e) => setDraft(item.id, { importance: e.target.value })}
                      />
                    </label>
                    <label className="text-xs text-ink-faint">
                      Verification status
                      <select
                        className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                        value={draft.verificationStatus}
                        onChange={(e) => setDraft(item.id, { verificationStatus: e.target.value })}
                      >
                        {DB_VERIFICATION_STATUSES.map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  {/* ---------- Duplicate candidates ---------- */}
                  <div className="mt-4 border-t border-border pt-4">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                        Possible Duplicates
                      </p>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => recheckDuplicates(item)}
                        disabled={checkingDuplicates === item.id}
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${checkingDuplicates === item.id ? "animate-spin" : ""}`} />{" "}
                        Re-check
                      </Button>
                    </div>
                    {itemDuplicates.length === 0 ? (
                      <p className="text-xs text-ink-faint">No likely duplicates found.</p>
                    ) : (
                      <ul className="space-y-2">
                        {itemDuplicates.map((d) => (
                          <li
                            key={d.eventId}
                            data-testid={`duplicate-candidate-${d.eventId}`}
                            className="rounded-lg border border-border px-3 py-2 text-xs"
                          >
                            <p className="font-medium text-ink">Likely existing event — {d.score}%</p>
                            <p className="mt-0.5 text-ink-dim">{d.title}</p>
                            <p className="mt-0.5 text-ink-faint">
                              {getEventTypeLabel(d.eventType)}
                              {d.countryCode || d.region ? ` · ${d.countryCode ?? d.region}` : ""}
                              {" · "}
                              {timeAgo(d.occurredAt)}
                            </p>
                            {d.reasons.length > 0 && (
                              <div className="mt-1.5 flex flex-wrap gap-1">
                                {d.reasons.map((reason, i) => (
                                  <span
                                    key={i}
                                    className="rounded-full bg-white/5 px-1.5 py-0.5 text-[10px] text-ink-faint"
                                  >
                                    {reason}
                                  </span>
                                ))}
                              </div>
                            )}
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                              <a
                                href={`/event/${d.slug}`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 rounded-full border border-border-strong px-2 py-1 text-ink-dim hover:text-ink"
                              >
                                <Eye className="h-3 w-3" /> View existing event
                              </a>
                              <button
                                onClick={() => mergeIntoEvent(item.id, d.eventId)}
                                className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent-dim px-2 py-1 text-accent hover:bg-accent/20"
                              >
                                <GitMerge className="h-3 w-3" /> Attach to this event
                              </button>
                              <button
                                onClick={() => ignoreDuplicate(item.id, d.eventId)}
                                className="inline-flex items-center gap-1 rounded-full border border-border-strong px-2 py-1 text-ink-dim hover:text-ink"
                              >
                                Ignore suggestion
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
                    <Button size="sm" variant="primary" onClick={() => publish(item)}>
                      <Check className="h-3.5 w-3.5" /> Publish
                    </Button>
                    {publishErrors[item.id] && (
                      <p role="alert" className="text-xs text-high" data-testid={`review-publish-error-${item.id}`}>
                        {publishErrors[item.id]}
                      </p>
                    )}

                    <select
                      className="rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-ink"
                      value={mergeTargets[item.id] ?? ""}
                      onChange={(e) => setMergeTargets((prev) => ({ ...prev, [item.id]: e.target.value }))}
                    >
                      <option value="">Merge into existing event…</option>
                      {publishedEvents.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.title}
                        </option>
                      ))}
                    </select>
                    <Button size="sm" variant="outline" onClick={() => merge(item.id)}>
                      <GitMerge className="h-3.5 w-3.5" /> Merge
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {bulk && (
        <BulkPublishDialog
          filters={incomingQuery}
          ids={bulk.ids}
          onClose={() => setBulk(null)}
          onDone={() => {
            setSelectedIds(new Set());
            refresh();
          }}
        />
      )}
    </div>
  );
}
