"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { EventTypeIcon, getEventTypeLabel } from "@/components/events/event-type-icon";
import { timeAgo } from "@/lib/utils";
import type { ConflictEvent } from "@/lib/types";

export default function AdminEventsPage() {
  const { data: events = [], isLoading: loading } = useQuery({
    queryKey: ["events"],
    queryFn: async (): Promise<ConflictEvent[]> => (await fetch("/api/events")).json(),
  });

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-ink">Events</h1>
        <p className="text-xs text-ink-faint">
          Published events with their corroboration — how many reports and independent sources back each one.
        </p>
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[800px] text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wide text-ink-faint">
              <th className="px-4 py-3">Title</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Location</th>
              <th className="px-4 py-3">Occurred</th>
              <th className="px-4 py-3">Sources</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-ink-faint">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && events.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-ink-faint">
                  No published events yet.
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
                <td className="px-4 py-3 text-ink-dim">
                  <span className="inline-flex items-center gap-1.5">
                    <EventTypeIcon eventType={event.eventType} className="h-3.5 w-3.5" />
                    {getEventTypeLabel(event.eventType)}
                  </span>
                </td>
                <td className="px-4 py-3 text-ink-dim">{event.countryCode ?? event.region}</td>
                <td className="px-4 py-3 text-ink-dim">{timeAgo(event.occurredAt)}</td>
                <td className="px-4 py-3 text-ink-dim">{event.sourceCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
