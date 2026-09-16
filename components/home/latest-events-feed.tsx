import { EventCard } from "@/components/events/event-card";
import { getRecentEvents } from "@/lib/data/mock-events";

export function LatestEventsFeed({ limit = 6, className }: { limit?: number; className?: string }) {
  const events = getRecentEvents(limit);
  return (
    <div className={className}>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-faint">
        Latest Activity
      </h2>
      <div className="space-y-3">
        {events.map((e) => (
          <EventCard key={e.id} event={e} compact />
        ))}
      </div>
    </div>
  );
}
