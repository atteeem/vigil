import { EventCard } from "@/components/events/event-card";
import { EmptyState, LoadingLine } from "@/components/public/data-states";
import type { ConflictEvent } from "@/lib/types";

/** Newest published events (already bounded by the public data layer). */
export function LatestEventsFeed({ events, loading, limit = 6, className }: { events: readonly ConflictEvent[]; loading?: boolean; limit?: number; className?: string }) {
  const recent = events.slice(0, limit);
  return (
    <div className={className} data-testid="latest-events-feed">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-faint">Latest Activity</h2>
      {loading && events.length === 0 ? (
        <LoadingLine />
      ) : recent.length === 0 ? (
        <EmptyState title="No published events yet" detail="Events appear here once reports are reviewed and published." testId="latest-events-empty" />
      ) : (
        <div className="space-y-3">
          {recent.map((e) => (
            <EventCard key={e.id} event={e} compact />
          ))}
        </div>
      )}
    </div>
  );
}
