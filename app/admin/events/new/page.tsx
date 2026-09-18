"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LocationPicker, type LocationValue } from "@/components/admin/location-picker";
import { EVENT_TYPES, SEVERITY_LEVELS } from "@/lib/types";
import { EVENT_TYPE_LABEL } from "@/components/events/event-type-icon";
import { DB_VERIFICATION_STATUSES, type ConflictDTO } from "@/lib/types/db";

interface FormState {
  title: string;
  summary: string;
  eventType: string;
  severity: string;
  importance: string;
  verificationStatus: string;
  occurredAt: string;
  conflictId: string;
  sourceName: string;
  sourceUrl: string;
  sourceCategory: string;
}

const EMPTY_FORM: FormState = {
  title: "",
  summary: "",
  eventType: EVENT_TYPES[0],
  severity: "elevated",
  importance: "50",
  verificationStatus: "reported",
  occurredAt: "",
  conflictId: "",
  sourceName: "",
  sourceUrl: "",
  sourceCategory: "",
};

// Manual event creation (spec "Manual Event Creation"): the admin supplies
// both the event fields and its source attribution in one form — there is
// no pre-existing incoming report to review here, unlike the
// /admin/incoming Publish flow this reuses conventions from (same
// LocationPicker, same field set).
export default function NewEventPage() {
  const router = useRouter();
  const { data: conflicts = [] } = useQuery({
    queryKey: ["admin", "conflicts", "selectable"],
    queryFn: async (): Promise<ConflictDTO[]> => (await fetch("/api/admin/conflicts?selectable=true")).json(),
  });

  const [form, setForm] = useState<FormState>(() => {
    const now = new Date();
    return { ...EMPTY_FORM, occurredAt: new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16) };
  });
  const [location, setLocation] = useState<LocationValue>({ lat: "", lng: "", locationName: "", countryCode: "", region: "" });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function set(patch: Partial<FormState>) {
    setForm((prev) => ({ ...prev, ...patch }));
  }

  async function submit(published: boolean) {
    setError(null);
    if (!form.title.trim() || !form.summary.trim() || !location.lat.trim() || !location.lng.trim() || !form.sourceName.trim()) {
      setError("Title, summary, latitude, longitude, and source name are required.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title.trim(),
          summary: form.summary.trim(),
          eventType: form.eventType,
          locationName: location.locationName || undefined,
          countryCode: location.countryCode || undefined,
          region: location.region || undefined,
          latitude: Number(location.lat),
          longitude: Number(location.lng),
          occurredAt: new Date(form.occurredAt).toISOString(),
          severity: form.severity,
          importance: Number(form.importance),
          verificationStatus: form.verificationStatus,
          conflictId: form.conflictId || null,
          published,
          sourceName: form.sourceName.trim(),
          sourceUrl: form.sourceUrl.trim() || undefined,
          sourceCategory: form.sourceCategory.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error ?? "Failed to create event.");
        return;
      }
      const created = await res.json();
      router.push(`/admin/events/${created.id}`);
    } catch {
      setError("Could not create the event. Check the fields and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    // Extra bottom room on mobile only: this form embeds its own
    // MapLibre instance (LocationPicker) directly above the Save/Publish
    // row, and that map's own layout settling interacts with the shared
    // scroll-padding-bottom fix (app/globals.css) in a way that can land
    // a scroll-into-view a few pixels short of full clearance from the
    // fixed MobileTabBar — extra real space here is a small, page-local
    // safety margin for that one interaction, not a duplicate of the
    // shared fix itself.
    <div className="pb-12 sm:pb-0">
      <Link href="/admin/events" className="mb-4 inline-flex items-center gap-1 text-xs text-accent hover:underline">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Events
      </Link>
      <h1 className="mb-1 text-lg font-semibold text-ink">Create Event</h1>
      <p className="mb-4 text-xs text-ink-faint">
        Manually authored events are always attributed to a source you provide — this is what labels the event as
        manually created, and keeps corroboration/audit-trail behavior consistent with ingested events.
      </p>

      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="sm:col-span-2 text-xs text-ink-faint">
            Title
            <input
              className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
              value={form.title}
              onChange={(e) => set({ title: e.target.value })}
            />
          </label>
          <label className="sm:col-span-2 text-xs text-ink-faint">
            Summary / description
            <textarea
              rows={3}
              className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
              value={form.summary}
              onChange={(e) => set({ summary: e.target.value })}
            />
          </label>
          <label className="text-xs text-ink-faint">
            Event type
            <select
              aria-label="Event type"
              className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
              value={form.eventType}
              onChange={(e) => set({ eventType: e.target.value })}
            >
              {EVENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {EVENT_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-ink-faint">
            Event date/time
            <input
              type="datetime-local"
              className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
              value={form.occurredAt}
              onChange={(e) => set({ occurredAt: e.target.value })}
            />
          </label>

          <div className="sm:col-span-2">
            <p className="mb-1 text-xs text-ink-faint">Location</p>
            <LocationPicker value={location} onChange={(patch) => setLocation((prev) => ({ ...prev, ...patch }))} />
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <label className="text-xs text-ink-faint">
                Latitude
                <input
                  className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                  value={location.lat}
                  onChange={(e) => setLocation((prev) => ({ ...prev, lat: e.target.value }))}
                  placeholder="required"
                />
              </label>
              <label className="text-xs text-ink-faint">
                Longitude
                <input
                  className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                  value={location.lng}
                  onChange={(e) => setLocation((prev) => ({ ...prev, lng: e.target.value }))}
                  placeholder="required"
                />
              </label>
              <label className="text-xs text-ink-faint">
                Country code
                <input
                  className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                  value={location.countryCode}
                  onChange={(e) => setLocation((prev) => ({ ...prev, countryCode: e.target.value.toUpperCase() }))}
                  placeholder="e.g. UA"
                />
              </label>
              <label className="text-xs text-ink-faint">
                Region / city
                <input
                  className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                  value={location.region}
                  onChange={(e) => setLocation((prev) => ({ ...prev, region: e.target.value }))}
                  placeholder="Europe / Middle East / …"
                />
              </label>
            </div>
          </div>

          <label className="text-xs text-ink-faint">
            Severity
            <select
              className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
              value={form.severity}
              onChange={(e) => set({ severity: e.target.value })}
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
              value={form.importance}
              onChange={(e) => set({ importance: e.target.value })}
            />
          </label>
          <label className="text-xs text-ink-faint">
            Verification status
            <select
              className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
              value={form.verificationStatus}
              onChange={(e) => set({ verificationStatus: e.target.value })}
            >
              {DB_VERIFICATION_STATUSES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-ink-faint">
            Conflict (optional)
            <select
              aria-label="Conflict"
              className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
              value={form.conflictId}
              onChange={(e) => set({ conflictId: e.target.value })}
            >
              <option value="">None</option>
              {conflicts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <div className="sm:col-span-2 mt-2 border-t border-border pt-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Source attribution</p>
          </div>
          <label className="text-xs text-ink-faint">
            Source name
            <input
              className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
              value={form.sourceName}
              onChange={(e) => set({ sourceName: e.target.value })}
              placeholder="e.g. Field report, Local contact"
            />
          </label>
          <label className="text-xs text-ink-faint">
            Source type/category
            <input
              className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
              value={form.sourceCategory}
              onChange={(e) => set({ sourceCategory: e.target.value })}
              placeholder="e.g. Eyewitness, Local media (defaults to “Manual entry”)"
            />
          </label>
          <label className="sm:col-span-2 text-xs text-ink-faint">
            Source URL (optional)
            <input
              className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
              value={form.sourceUrl}
              onChange={(e) => set({ sourceUrl: e.target.value })}
              placeholder="https://…"
            />
          </label>
        </div>

        {error && <p className="mt-3 text-xs text-high">{error}</p>}

        <div className="mt-4 flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="outline" disabled={submitting} onClick={() => submit(false)}>
            Save as Draft
          </Button>
          <Button variant="accent" disabled={submitting} onClick={() => submit(true)}>
            Publish
          </Button>
        </div>
      </Card>
    </div>
  );
}
