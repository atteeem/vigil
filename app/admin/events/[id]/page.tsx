"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ShieldQuestion } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EventTypeIcon, getEventTypeLabel } from "@/components/events/event-type-icon";
import { getEventCorroboration } from "@/lib/data/corroboration";
import { timeAgo } from "@/lib/utils";
import type { ConflictEvent } from "@/lib/types";

function formatCategory(raw: string): string {
  return raw
    .replace(/_/g, " ")
    .split(" ")
    .map((word) => (word.length > 0 ? word[0]!.toUpperCase() + word.slice(1) : word))
    .join(" ");
}

export default function AdminEventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: events = [], isLoading: loading } = useQuery({
    queryKey: ["events"],
    queryFn: async (): Promise<ConflictEvent[]> => (await fetch("/api/events")).json(),
  });

  const event = events.find((e) => e.id === id);

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
      <Link href="/admin/events" className="mb-4 inline-flex items-center gap-1 text-xs text-accent hover:underline">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Events
      </Link>

      <Card className="mb-4 p-4">
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
