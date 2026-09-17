"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X, GitMerge, Pencil, ExternalLink, Sparkles, Eye, RefreshCw, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LocationPicker } from "@/components/admin/location-picker";
import { EVENT_TYPES, SEVERITY_LEVELS, REGIONS } from "@/lib/types";
import { EVENT_TYPE_LABEL, getEventTypeLabel } from "@/components/events/event-type-icon";
import {
  DB_VERIFICATION_STATUSES,
  PROCESSING_STATUSES,
  DUPLICATE_LIKELIHOODS,
  INCOMING_SORTS,
  type RawIngestionItemWithSourceDTO,
  type ConflictDTO,
  type SourceDTO,
  type DraftSuggestionDTO,
  type DuplicateCandidateDTO,
  type ProcessingStatus,
  type DuplicateLikelihood,
  type IncomingSort,
} from "@/lib/types/db";
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
};

const AGE_OPTIONS: { label: string; value: string }[] = [
  { label: "Any age", value: "" },
  { label: "Last hour", value: "1" },
  { label: "Last 6 hours", value: "6" },
  { label: "Last 24 hours", value: "24" },
  { label: "Last 7 days", value: "168" },
];

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
  return params.toString();
}

interface PublishDraft {
  title: string;
  summary: string;
  eventType: string;
  locationName: string;
  latitude: string;
  longitude: string;
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
    countryCode: s.countryCode ?? "",
    region: s.region ?? "",
    occurredAt: new Date(occurred).toISOString().slice(0, 16),
    severity: s.severity,
    importance: String(s.importance),
    verificationStatus: s.verificationStatus,
    conflictId: s.conflictId ?? "",
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
    if (!willExpand || item.id in suggestions) return;

    const res = await fetch(`/api/admin/incoming/${item.id}/draft`);
    const { draft }: { draft: DraftSuggestionDTO | null } = await res.json();
    setSuggestions((prev) => ({ ...prev, [item.id]: draft }));
    if (draft) {
      setDrafts((prev) => (prev[item.id] ? prev : { ...prev, [item.id]: draftFromSuggestion(item, draft) }));
      setDuplicates((prev) => ({ ...prev, [item.id]: draft.duplicates }));
    }
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

  async function publish(item: RawIngestionItemWithSourceDTO) {
    const draft = getDraft(item);
    if (!draft.title || !draft.summary || !draft.latitude || !draft.longitude) {
      alert("Title, summary, latitude, and longitude are required to publish.");
      return;
    }
    const res = await fetch(`/api/admin/incoming/${item.id}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: draft.title,
        summary: draft.summary,
        eventType: draft.eventType,
        locationName: draft.locationName || undefined,
        latitude: Number(draft.latitude),
        longitude: Number(draft.longitude),
        countryCode: draft.countryCode || undefined,
        region: draft.region || undefined,
        occurredAt: new Date(draft.occurredAt).toISOString(),
        severity: draft.severity,
        importance: Number(draft.importance),
        verificationStatus: draft.verificationStatus,
        conflictId: draft.conflictId || null,
      }),
    });
    if (!res.ok) {
      const err = await res.json();
      alert(err.error ?? "Publish failed");
      return;
    }
    refresh();
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
      <p className="mb-4 text-xs text-ink-faint">
        {items.length} item{items.length === 1 ? "" : "s"} matching filters. Nothing here auto-publishes.
      </p>

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
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-ink-faint">
                    <span className="rounded bg-white/5 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-ink-faint">
                      Source Data
                    </span>
                    <span className="font-medium text-ink-dim">{item.source.name}</span>
                    <span>·</span>
                    <span>{timeAgo(item.receivedAt)}</span>
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
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button size="icon" variant="ghost" onClick={() => setEditing((p) => ({ ...p, [item.id]: !isEditing }))} aria-label="Edit">
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => reject(item.id)} aria-label="Reject">
                    <X className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="accent" onClick={() => toggleReview(item)}>
                    {expanded ? "Close" : "Review"}
                  </Button>
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
                          {suggestion.locationSource === "ambiguous"
                            ? `${suggestion.locationName ?? "?"} (ambiguous)`
                            : suggestion.locationSource === "resolved"
                              ? suggestion.locationName
                              : "not detected"}
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
                      Summary (independently written — never republish source text verbatim)
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

                    <div className="sm:col-span-2">
                      <p className="mb-1 text-xs text-ink-faint">Location</p>
                      <LocationPicker
                        value={{
                          lat: draft.latitude,
                          lng: draft.longitude,
                          locationName: draft.locationName,
                          countryCode: draft.countryCode,
                          region: draft.region,
                        }}
                        ambiguousCandidates={
                          suggestion?.locationSource === "ambiguous" ? suggestion.locationCandidates : undefined
                        }
                        onChange={(patch) =>
                          setDraft(item.id, {
                            ...(patch.lat !== undefined ? { latitude: patch.lat } : {}),
                            ...(patch.lng !== undefined ? { longitude: patch.lng } : {}),
                            ...(patch.locationName !== undefined ? { locationName: patch.locationName } : {}),
                            ...(patch.countryCode !== undefined ? { countryCode: patch.countryCode } : {}),
                            ...(patch.region !== undefined ? { region: patch.region } : {}),
                          })
                        }
                      />
                      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <label className="text-xs text-ink-faint">
                          Latitude
                          <input
                            className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                            value={draft.latitude}
                            onChange={(e) => setDraft(item.id, { latitude: e.target.value })}
                            placeholder="required"
                          />
                        </label>
                        <label className="text-xs text-ink-faint">
                          Longitude
                          <input
                            className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                            value={draft.longitude}
                            onChange={(e) => setDraft(item.id, { longitude: e.target.value })}
                            placeholder="required"
                          />
                        </label>
                        <label className="text-xs text-ink-faint">
                          Country code
                          <input
                            className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                            value={draft.countryCode}
                            onChange={(e) => setDraft(item.id, { countryCode: e.target.value.toUpperCase() })}
                            placeholder="e.g. UA"
                          />
                        </label>
                        <label className="text-xs text-ink-faint">
                          Region
                          <input
                            className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                            value={draft.region}
                            onChange={(e) => setDraft(item.id, { region: e.target.value })}
                            placeholder="Europe / Middle East / …"
                          />
                        </label>
                      </div>
                    </div>

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
    </div>
  );
}
