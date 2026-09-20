"use client";

import Link from "next/link";
import type { Conflict, ConflictEvent } from "@/lib/types";
import { SeverityBadge } from "@/components/ui/severity-badge";
import { RelativeTime } from "@/components/ui/relative-time";
import { EmptyState, LoadingLine } from "@/components/public/data-states";
import { rankMajorConflicts, rankSignificantEvents } from "@/lib/data/priority";
import { useNowMs } from "@/hooks/use-now";

const VERIFIED = new Set(["confirmed", "multiple_sources"]);
const WEEK_MS = 7 * 86_400_000;

/** A concise real-data overview: the conflicts and events that matter most (ranked by severity,
 * significance, recency and evidence — never by article count) and the latest verified updates. */
export function IntelOverview({ conflicts, events, loading, className }: { conflicts: readonly Conflict[]; events: readonly ConflictEvent[]; loading?: boolean; className?: string }) {
  const now = useNowMs(events);
  if (loading && conflicts.length === 0) return <LoadingLine className={className} />;
  const major = rankMajorConflicts(conflicts, events, now, 5);
  const significant = rankSignificantEvents(
    events.filter((e) => now - new Date(e.occurredAt).getTime() <= WEEK_MS),
    now,
    4,
  );
  const verified = events.filter((e) => VERIFIED.has(e.verificationStatus)).sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1)).slice(0, 3);

  return (
    <div className={className} data-testid="intel-overview">
      <section data-testid="major-conflicts">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-faint">Major active conflicts</h2>
        {major.length === 0 ? (
          <EmptyState title="No active conflicts tracked" testId="major-conflicts-empty" />
        ) : (
          <ol className="space-y-2">
            {major.map(({ conflict }) => (
              <li key={conflict.id}>
                <Link href={`/conflict/${conflict.slug}`} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card/60 px-3.5 py-2.5 hover:border-border-strong" data-testid="major-conflict">
                  <span>
                    <span className="block text-sm text-ink">{conflict.shortName}</span>
                    <span className="block text-[11px] text-ink-faint">{conflict.lastEventAt ? <RelativeTime iso={conflict.lastEventAt} prefix="Last event " /> : "No published events"}</span>
                  </span>
                  <SeverityBadge severity={conflict.severity} size="sm" />
                </Link>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="mt-6" data-testid="significant-events">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-faint">Significant recent events</h2>
        {significant.length === 0 ? (
          <EmptyState title="No significant events in the last 7 days" testId="significant-events-empty" />
        ) : (
          <ul className="space-y-2">
            {significant.map(({ event }) => (
              <li key={event.id}>
                <Link href={`/event/${event.slug}`} className="block rounded-xl border border-border bg-card/60 px-3.5 py-2.5 hover:border-border-strong" data-testid="significant-event">
                  <span className="block text-sm text-ink">{event.title}</span>
                  <span className="flex items-center gap-2 text-[11px] text-ink-faint">
                    <SeverityBadge severity={event.severity} size="sm" />
                    <RelativeTime iso={event.occurredAt} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6" data-testid="verified-updates">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-faint">Latest verified updates</h2>
        {verified.length === 0 ? (
          <EmptyState title="No verified updates yet" detail="Events appear here once confirmed or backed by multiple sources." testId="verified-updates-empty" />
        ) : (
          <ul className="space-y-2">
            {verified.map((event) => (
              <li key={event.id} className="text-xs text-ink-dim" data-testid="verified-update">
                <Link href={`/event/${event.slug}`} className="text-accent hover:underline">
                  {event.title}
                </Link>{" "}
                <span className="text-ink-faint">
                  <RelativeTime iso={event.occurredAt} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
