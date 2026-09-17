"use client";

import { useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ShieldQuestion, Pencil, Globe2, EyeOff, Trash2, X, Check } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LocationPicker, type LocationValue } from "@/components/admin/location-picker";
import { EventTypeIcon, getEventTypeLabel, EVENT_TYPE_LABEL } from "@/components/events/event-type-icon";
import { EventStatusBadge } from "@/components/events/event-status-badge";
import { getEventCorroboration } from "@/lib/data/corroboration";
import { timeAgo } from "@/lib/utils";
import { EVENT_TYPES, SEVERITY_LEVELS } from "@/lib/types";
import { DB_VERIFICATION_STATUSES, type EventStatus } from "@/lib/types/db";
import type { ConflictEvent } from "@/lib/types";

type EventAdminDetail = ConflictEvent & { locationName: string | null; status: EventStatus; publishedAt: string | null; createdAt: string; updatedAt: string };

function formatCategory(raw: string): string {
  return raw
    .replace(/_/g, " ")
    .split(" ")
    .map((word) => (word.length > 0 ? word[0]!.toUpperCase() + word.slice(1) : word))
    .join(" ");
}

interface EditState {
  title: string;
  summary: string;
  eventType: string;
  severity: string;
  importance: string;
  verificationStatus: string;
  occurredAt: string;
}

function toEditState(event: EventAdminDetail): EditState {
  return {
    title: event.title,
    summary: event.summary,
    eventType: event.eventType,
    severity: event.severity,
    importance: String(event.importance),
    verificationStatus: event.disputed ? "disputed" : event.verificationStatus,
    occurredAt: new Date(new Date(event.occurredAt).getTime() - new Date(event.occurredAt).getTimezoneOffset() * 60_000).toISOString().slice(0, 16),
  };
}

export default function AdminEventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const { data: event, isLoading: loading } = useQuery({
    queryKey: ["admin", "events", id],
    queryFn: async (): Promise<EventAdminDetail> => {
      const res = await fetch(`/api/admin/events/${id}`);
      if (!res.ok) throw new Error("Event not found");
      return res.json();
    },
  });

  const [editing, setEditing] = useState(searchParams.get("edit") === "1");
  const [edit, setEdit] = useState<EditState | null>(null);
  const [location, setLocation] = useState<LocationValue | null>(null);
  const [initializedFor, setInitializedFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Adjusting state when data arrives (React's recommended pattern for
  // this, not an effect: https://react.dev/learn/you-might-not-need-an-effect)
  // — seeds the editable form fields from the loaded event exactly once
  // per event id, so typing in the form doesn't get clobbered by refetches.
  if (event && initializedFor !== event.id) {
    setEdit(toEditState(event));
    setLocation({
      lat: String(event.lat),
      lng: String(event.lng),
      locationName: event.locationName ?? "",
      countryCode: event.countryCode,
      region: event.region,
    });
    setInitializedFor(event.id);
  }

  const refresh = () => queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === "admin" || q.queryKey[0] === "events" });

  async function changeLifecycle(action: "publish" | "unpublish" | "delete") {
    if (action === "delete" && (!event || !confirm(`Delete "${event.title}"? This cannot be undone. Reports without other event links will return to the incoming queue.`))) return;
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/events/${id}${action === "delete" ? "" : `/${action}`}`, { method: action === "delete" ? "DELETE" : "POST" });
      if (!res.ok) throw new Error("Request failed");
      if (action === "delete") {
        router.push("/admin/events");
        void refresh();
      } else {
        await refresh();
      }
    } catch {
      setError(`Could not ${action} the event. Please try again.`);
    } finally {
      setSaving(false);
    }
  }

  async function save() {
    if (!edit || !location) return;
    setError(null);
    if (!edit.title.trim() || !edit.summary.trim() || !location.lat.trim() || !location.lng.trim()) {
      setError("Title, summary, latitude, and longitude are required.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/events/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: edit.title.trim(),
          summary: edit.summary.trim(),
          eventType: edit.eventType,
          latitude: Number(location.lat),
          longitude: Number(location.lng),
          locationName: location.locationName || null,
          countryCode: location.countryCode || null,
          region: location.region || null,
          occurredAt: event && edit.occurredAt === toEditState(event).occurredAt ? event.occurredAt : new Date(edit.occurredAt).toISOString(),
          severity: edit.severity,
          importance: Number(edit.importance),
          verificationStatus: edit.verificationStatus,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error ?? "Save failed.");
        return;
      }
      setEditing(false);
      router.replace(`/admin/events/${id}`);
      refresh();
    } catch {
      setError("Could not save the event. Check the fields and try again.");
    } finally {
      setSaving(false);
    }
  }

  function cancelEdit() {
    if (event) {
      setEdit(toEditState(event));
      setLocation({ lat: String(event.lat), lng: String(event.lng), locationName: event.locationName ?? "", countryCode: event.countryCode, region: event.region });
    }
    setEditing(false);
    router.replace(`/admin/events/${id}`);
  }

  if (loading) {
    return <p className="text-sm text-ink-faint">Loading…</p>;
  }

  if (!event) {
    return (
      <div>
        <Link href="/admin/events" className="mb-4 inline-flex items-center gap-1 text-xs text-accent hover:underline">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Events
        </Link>
        <p className="text-sm text-ink-faint">Event not found.</p>
      </div>
    );
  }

  const corroboration = getEventCorroboration(event);

  return (
    <div data-testid="admin-event-detail">
      <div className="mb-4 flex items-center justify-between">
        <Link href="/admin/events" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Events
        </Link>
        {!editing && (
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)} data-testid="edit-event-button">
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Button>
            {event.status === "published" ? (
              <Button size="sm" variant="ghost" disabled={saving} onClick={() => changeLifecycle("unpublish")} data-testid="unpublish-event-button">
                <EyeOff className="h-3.5 w-3.5" /> Unpublish
              </Button>
            ) : (
              <Button size="sm" variant="accent" disabled={saving} onClick={() => changeLifecycle("publish")} data-testid="publish-event-button">
                <Globe2 className="h-3.5 w-3.5" /> Publish
              </Button>
            )}
            <Button size="sm" variant="ghost" disabled={saving} onClick={() => changeLifecycle("delete")} data-testid="delete-event-button">
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </Button>
          </div>
        )}
      </div>

      {!editing && error && <p role="alert" className="mb-3 text-xs text-high">{error}</p>}
      <Card className="mb-4 p-4">
        <div className="mb-2 flex items-center gap-2">
          <EventStatusBadge status={event.status} />
        </div>

        {!editing ? (
          <>
            <div className="mb-1 flex items-center gap-2 text-xs text-ink-faint">
              <EventTypeIcon eventType={event.eventType} className="h-3.5 w-3.5" />
              <span>{getEventTypeLabel(event.eventType)}</span>
              <span>·</span>
              <span>{event.countryCode ?? event.region}</span>
              <span>·</span>
              <span>{timeAgo(event.occurredAt)}</span>
            </div>
            <h1 className="text-lg font-semibold text-ink">{event.title}</h1>
            <p className="mt-1 text-sm text-ink-dim">{event.summary}</p>
          </>
        ) : (
          edit &&
          location && (
            <div data-testid="edit-event-form">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="sm:col-span-2 text-xs text-ink-faint">
                  Title
                  <input
                    className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                    value={edit.title}
                    onChange={(e) => setEdit({ ...edit, title: e.target.value })}
                  />
                </label>
                <label className="sm:col-span-2 text-xs text-ink-faint">
                  Summary
                  <textarea
                    rows={3}
                    className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                    value={edit.summary}
                    onChange={(e) => setEdit({ ...edit, summary: e.target.value })}
                  />
                </label>
                <label className="text-xs text-ink-faint">
                  Event type
                  <select
                    aria-label="Event type"
                    className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                    value={edit.eventType}
                    onChange={(e) => setEdit({ ...edit, eventType: e.target.value })}
                  >
                    {EVENT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {EVENT_TYPE_LABEL[t]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-ink-faint">
                  Occurred at
                  <input
                    type="datetime-local"
                    className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                    value={edit.occurredAt}
                    onChange={(e) => setEdit({ ...edit, occurredAt: e.target.value })}
                  />
                </label>

                <div className="sm:col-span-2">
                  <p className="mb-1 text-xs text-ink-faint">Location</p>
                  <LocationPicker value={location} onChange={(patch) => setLocation({ ...location, ...patch })} />
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <label className="text-xs text-ink-faint">
                      Latitude
                      <input
                        className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                        value={location.lat}
                        onChange={(e) => setLocation({ ...location, lat: e.target.value })}
                      />
                    </label>
                    <label className="text-xs text-ink-faint">
                      Longitude
                      <input
                        className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                        value={location.lng}
                        onChange={(e) => setLocation({ ...location, lng: e.target.value })}
                      />
                    </label>
                    <label className="text-xs text-ink-faint">
                      Country code
                      <input
                        className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                        value={location.countryCode}
                        onChange={(e) => setLocation({ ...location, countryCode: e.target.value.toUpperCase() })}
                      />
                    </label>
                    <label className="text-xs text-ink-faint">
                      Region
                      <input
                        className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                        value={location.region}
                        onChange={(e) => setLocation({ ...location, region: e.target.value })}
                      />
                    </label>
                  </div>
                </div>

                <label className="text-xs text-ink-faint">
                  Severity
                  <select
                    className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                    value={edit.severity}
                    onChange={(e) => setEdit({ ...edit, severity: e.target.value })}
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
                    value={edit.importance}
                    onChange={(e) => setEdit({ ...edit, importance: e.target.value })}
                  />
                </label>
                <label className="text-xs text-ink-faint">
                  Verification status
                  <select
                    className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                    value={edit.verificationStatus}
                    onChange={(e) => setEdit({ ...edit, verificationStatus: e.target.value })}
                  >
                    {DB_VERIFICATION_STATUSES.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {error && <p className="mt-3 text-xs text-high">{error}</p>}

              <div className="mt-4 flex justify-end gap-2 border-t border-border pt-4">
                <Button size="sm" variant="ghost" onClick={cancelEdit} disabled={saving}>
                  <X className="h-3.5 w-3.5" /> Cancel
                </Button>
                <Button size="sm" variant="accent" onClick={save} disabled={saving} data-testid="save-event-button">
                  <Check className="h-3.5 w-3.5" /> Save
                </Button>
              </div>
            </div>
          )
        )}
      </Card>

      <Card className="p-4" data-testid="corroboration-panel">
        <div className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-faint">
          <ShieldQuestion className="h-3.5 w-3.5" />
          Corroboration
        </div>
        <ul className="space-y-1.5 text-sm text-ink-dim">
          <li data-testid="corroboration-source-count">
            <span className="font-medium text-ink">{corroboration.independentSourceCount}</span>{" "}
            independent source{corroboration.independentSourceCount === 1 ? "" : "s"}
          </li>
          <li data-testid="corroboration-report-count">
            <span className="font-medium text-ink">{corroboration.supportingReportCount}</span>{" "}
            supporting report{corroboration.supportingReportCount === 1 ? "" : "s"}
          </li>
          <li data-testid="corroboration-categories">{corroboration.sourceCategories.map(formatCategory).join(" + ")}</li>
          <li data-testid="corroboration-last-updated">
            Last corroborated {timeAgo(corroboration.latestCorroborationAt)}
          </li>
          <li className="text-xs text-ink-faint" data-testid="corroboration-first-reported">
            First reported {timeAgo(corroboration.earliestSourceAt)}
          </li>
        </ul>
        <p className="mt-3 text-xs text-ink-faint">
          Corroboration describes how many reports and sources exist for this event — it is not a truth or
          credibility score. Multiple sources reporting the same thing does not by itself prove it happened.
        </p>
      </Card>
    </div>
  );
}
