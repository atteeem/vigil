"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Eye, Globe2, EyeOff, Trash2, Pencil } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EventTypeIcon, getEventTypeLabel } from "@/components/events/event-type-icon";
import { EventStatusBadge } from "@/components/events/event-status-badge";
import { timeAgo } from "@/lib/utils";
import type { EventAdminDTO } from "@/lib/types/db";

export default function AdminEventsPage() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const { data: events = [], isLoading: loading } = useQuery({
    queryKey: ["admin", "events"],
    queryFn: async (): Promise<EventAdminDTO[]> => (await fetch("/api/admin/events")).json(),
  });

  const refresh = () => queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === "admin" || q.queryKey[0] === "events" });

  async function changeLifecycle(event: EventAdminDTO, action: "publish" | "unpublish" | "delete") {
    if (action === "delete" && !confirm(`Delete "${event.title}"? This cannot be undone. Reports without other event links will return to the incoming queue.`)) return;
    setError(null);
    try {
      const res = await fetch(`/api/admin/events/${event.id}${action === "delete" ? "" : `/${action}`}`, { method: action === "delete" ? "DELETE" : "POST" });
      if (!res.ok) throw new Error("Request failed");
      await refresh();
    } catch {
      setError(`Could not ${action} the event. Please try again.`);
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-ink">Events</h1>
          <p className="text-xs text-ink-faint">
            Manage every event&rsquo;s lifecycle and see its corroboration — how many reports and independent sources back it.
          </p>
        </div>
        <Link href="/admin/events/new" className="inline-flex">
          <Button size="sm" variant="accent">
            <Plus className="h-3.5 w-3.5" /> Create Event
          </Button>
        </Link>
      </div>

      {error && <p role="alert" className="mb-3 text-xs text-high">{error}</p>}
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wide text-ink-faint">
              <th className="px-4 py-3">Title</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Location</th>
              <th className="px-4 py-3">Occurred</th>
              <th className="px-4 py-3">Sources</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-ink-faint">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && events.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-ink-faint">
                  No events yet.
                </td>
              </tr>
            )}
            {events.map((event) => (
              <tr key={event.id} data-testid={`admin-event-row-${event.id}`} className="border-b border-border/60 align-top">
                <td className="px-4 py-3">
                  <Link href={`/admin/events/${event.id}`} className="font-medium text-ink hover:underline">
                    {event.title}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <EventStatusBadge status={event.status} />
                </td>
                <td className="px-4 py-3 text-ink-dim">
                  <span className="inline-flex items-center gap-1.5">
                    <EventTypeIcon eventType={event.eventType} className="h-3.5 w-3.5" />
                    {getEventTypeLabel(event.eventType)}
                  </span>
                </td>
                <td className="px-4 py-3 text-ink-dim">{event.countryCode ?? event.region}</td>
                <td className="px-4 py-3 text-ink-dim">{timeAgo(event.occurredAt)}</td>
                <td className="px-4 py-3 text-ink-dim">{event.sourceCount}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1.5">
                    <Link href={`/admin/events/${event.id}`}>
                      <Button size="icon" variant="ghost" aria-label={`View ${event.title}`}>
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                    </Link>
                    <Link href={`/admin/events/${event.id}?edit=1`}>
                      <Button size="icon" variant="ghost" aria-label={`Edit ${event.title}`}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </Link>
                    {event.status === "published" ? (
                      <Button size="icon" variant="ghost" aria-label={`Unpublish ${event.title}`} onClick={() => changeLifecycle(event, "unpublish")}>
                        <EyeOff className="h-3.5 w-3.5" />
                      </Button>
                    ) : (
                      <Button size="icon" variant="ghost" aria-label={`Publish ${event.title}`} onClick={() => changeLifecycle(event, "publish")}>
                        <Globe2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button size="icon" variant="ghost" aria-label={`Delete ${event.title}`} onClick={() => changeLifecycle(event, "delete")}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
