"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X, GitMerge, Pencil, ExternalLink } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EVENT_TYPES, SEVERITY_LEVELS } from "@/lib/types";
import { EVENT_TYPE_LABEL } from "@/components/events/event-type-icon";
import { DB_VERIFICATION_STATUSES, type RawIngestionItemWithSourceDTO } from "@/lib/types/db";
import { timeAgo } from "@/lib/utils";
import type { ConflictEvent } from "@/lib/types";

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
  };
}

export default function AdminIncomingPage() {
  const queryClient = useQueryClient();
  const { data: items = [], isLoading: loading } = useQuery({
    queryKey: ["admin", "incoming", "pending"],
    queryFn: async (): Promise<RawIngestionItemWithSourceDTO[]> =>
      (await fetch("/api/admin/incoming?status=pending")).json(),
  });
  const { data: publishedEvents = [] } = useQuery({
    queryKey: ["events", "published"],
    queryFn: async (): Promise<ConflictEvent[]> => (await fetch("/api/events")).json(),
  });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, PublishDraft>>({});
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
    await fetch(`/api/admin/incoming/${id}/merge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId, relationship: "corroborating" }),
    });
    refresh();
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
        {items.length} pending item{items.length === 1 ? "" : "s"}. Nothing here auto-publishes.
      </p>

      {loading && <p className="text-sm text-ink-faint">Loading…</p>}
      {!loading && items.length === 0 && (
        <Card className="p-8 text-center text-sm text-ink-faint">
          No pending reports. Enable an RSS source with auto-ingest in Source Manager, or submit a manual report via
          the API to populate this queue.
        </Card>
      )}

      <div className="space-y-3">
        {items.map((item) => {
          const draft = getDraft(item);
          const expanded = expandedId === item.id;
          const isEditing = editing[item.id];
          return (
            <Card key={item.id} className="p-4" data-testid={`incoming-item-${item.id}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-2 text-xs text-ink-faint">
                    <span className="font-medium text-ink-dim">{item.source.name}</span>
                    <span>·</span>
                    <span>{timeAgo(item.receivedAt)}</span>
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
                  <Button size="sm" variant="accent" onClick={() => setExpandedId(expanded ? null : item.id)}>
                    {expanded ? "Close" : "Review"}
                  </Button>
                </div>
              </div>

              {expanded && (
                <div className="mt-4 border-t border-border pt-4">
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
                      Summary
                      <textarea
                        rows={2}
                        className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                        value={draft.summary}
                        onChange={(e) => setDraft(item.id, { summary: e.target.value })}
                      />
                    </label>
                    <label className="text-xs text-ink-faint">
                      Location name
                      <input
                        className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                        value={draft.locationName}
                        onChange={(e) => setDraft(item.id, { locationName: e.target.value })}
                      />
                    </label>
                    <div className="grid grid-cols-2 gap-2">
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
                    </div>
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
                    <label className="text-xs text-ink-faint">
                      Occurred at
                      <input
                        type="datetime-local"
                        className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                        value={draft.occurredAt}
                        onChange={(e) => setDraft(item.id, { occurredAt: e.target.value })}
                      />
                    </label>
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
