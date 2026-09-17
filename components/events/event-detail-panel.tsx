"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, MapPin } from "lucide-react";
import type { ConflictEvent } from "@/lib/types";
import { EventTypeIcon, getEventTypeLabel } from "./event-type-icon";
import { SourceRoleIcon, getSourceRoleLabel } from "./source-role-icon";
import { VerificationBadge } from "@/components/ui/verification-badge";
import { SeverityBadge } from "@/components/ui/severity-badge";
import { buttonVariants } from "@/components/ui/button";
import { timeAgo, formatAbsoluteTime, cn } from "@/lib/utils";
import { MOCK_NOW } from "@/lib/data/constants";
import { getCountryByCode } from "@/lib/data/mock-countries";
import { getConflictById } from "@/lib/data/mock-conflicts";
import { useAppStore } from "@/hooks/use-app-store";

export function EventDetailPanel({
  event,
  linkToFullPage = true,
}: {
  event: ConflictEvent;
  /** Hide the "Open full event page" link when this panel IS the full event page (avoids a self-referential link). */
  linkToFullPage?: boolean;
}) {
  const country = getCountryByCode(event.countryCode);
  const conflict = event.conflictId ? getConflictById(event.conflictId) : undefined;
  const timezone = useAppStore((s) => s.timezone);

  // formatAbsoluteTime(..., "auto") resolves to the *runtime's* local
  // timezone via Intl.DateTimeFormat(undefined, ...) — the server
  // (Node.js process) and the browser client are different runtimes with
  // different local timezones, so the "auto" case renders different text
  // in each, which is a hydration mismatch (this component is server-
  // rendered on first load via app/event/[slug]/page.tsx). Server render
  // and the client's pre-hydration render both use a fixed "UTC" instead;
  // the real device timezone (if "auto") only takes effect after mount,
  // which is always a safe post-hydration update, never a mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // One-time client-only mount flag for the hydration-safe timezone
    // fallback above — the same pattern conflict-globe.tsx uses for its
    // client-only WebGL capability probe.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);
  const effectiveTimezone = mounted ? timezone : "UTC";

  return (
    <div>
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
        <EventTypeIcon eventType={event.eventType} className="h-3.5 w-3.5" />
        {getEventTypeLabel(event.eventType)}
      </div>
      <h2 className="mt-1.5 text-lg font-semibold leading-snug text-ink">{event.title}</h2>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-dim">
        <span className="flex items-center gap-1">
          <MapPin className="h-3 w-3" /> {country ? `${country.flag} ${country.name}` : event.region}
        </span>
        <span>{formatAbsoluteTime(event.occurredAt, effectiveTimezone)}</span>
        <span>{timeAgo(event.occurredAt, MOCK_NOW)}</span>
        {/* Driven by updateHistory (an accepted change actually happened),
            not by Event.updatedAt — that column also moves on lifecycle
            actions like publish/unpublish that aren't content changes,
            which would make "Updated X ago" misleading (spec "show
            'updated X ago'" means since the last accepted fact update). */}
        {event.updateHistory && event.updateHistory.length > 0 && (
          <span data-testid="event-updated-ago">Updated {timeAgo(event.updateHistory[0]!.changedAt, MOCK_NOW)}</span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <SeverityBadge severity={event.severity} size="sm" />
        <VerificationBadge status={event.verificationStatus} disputed={event.disputed} />
      </div>

      <p className="mt-4 text-sm leading-relaxed text-ink-dim">{event.summary}</p>

      {((event.actors?.length ?? 0) > 0 ||
        event.casualtiesKilled != null ||
        event.casualtiesInjured != null ||
        (event.infrastructureDamage?.length ?? 0) > 0) && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-dim" data-testid="event-accepted-facts">
          {event.actors && event.actors.length > 0 && <span>Actors: {event.actors.join(", ")}</span>}
          {event.casualtiesKilled != null && <span>Killed: {event.casualtiesKilled}</span>}
          {event.casualtiesInjured != null && <span>Injured: {event.casualtiesInjured}</span>}
          {event.infrastructureDamage && event.infrastructureDamage.length > 0 && (
            <span>Damage: {event.infrastructureDamage.join(", ")}</span>
          )}
        </div>
      )}

      {conflict && (
        <Link
          href={`/conflict/${conflict.slug}`}
          className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
        >
          Part of {conflict.shortName}
          <ArrowRight className="h-3 w-3" />
        </Link>
      )}

      <div className="mt-5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Timeline</p>
        <ol className="mt-2 space-y-3 border-l border-border pl-3">
          {event.timeline.map((t, i) => (
            <li key={i} className="relative">
              <span className="absolute -left-[17px] top-1 h-2 w-2 rounded-full bg-accent" aria-hidden />
              <p className="text-xs font-medium text-ink">{t.label}</p>
              <p className="text-[11px] text-ink-faint">{timeAgo(t.time, MOCK_NOW)}</p>
              <p className="mt-0.5 text-xs text-ink-dim">{t.description}</p>
            </li>
          ))}
        </ol>
      </div>

      {event.updateHistory && event.updateHistory.length > 0 && (
        <div className="mt-5" data-testid="public-update-history">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Recent Updates</p>
          <ul className="mt-2 space-y-1.5">
            {event.updateHistory.map((h, i) => (
              <li key={i} className="text-xs text-ink-dim">
                <span className="text-ink-faint">{timeAgo(h.changedAt, MOCK_NOW)}</span> — {h.newValue}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          Sources ({event.sources.length})
        </p>
        <ul className="mt-2 space-y-2">
          {event.sources.map((s, i) => (
            // s.id is the underlying Source (outlet)'s id, not this
            // particular link's — the SAME outlet can legitimately supply
            // more than one report to one event (e.g. a follow-up
            // submission via the same feed, or a relay), so two entries
            // here can share s.id even though they're different reports.
            // Index-qualifying the key is what actually makes it unique.
            <li key={`${s.id}-${i}`} className="rounded-lg border border-border px-3 py-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 font-medium text-ink">
                  <SourceRoleIcon sourceRole={s.sourceRole} className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
                  {s.name}
                  {i === 0 && (
                    <span className="ml-1.5 rounded-full border border-accent/30 bg-accent-dim px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-accent">
                      Originating report
                    </span>
                  )}
                </p>
                <p className="shrink-0 text-ink-faint">{timeAgo(s.publishedAt, MOCK_NOW)}</p>
              </div>
              <p className="mt-0.5 text-ink-faint">
                Source type: {s.sourceType}
                {getSourceRoleLabel(s.sourceRole) && ` · ${getSourceRoleLabel(s.sourceRole)}`}
              </p>
              <p className="mt-0.5 text-ink-faint">Published: {formatAbsoluteTime(s.publishedAt, effectiveTimezone)}</p>
              {s.url && (
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 block truncate text-accent hover:underline"
                >
                  Original source: {s.url}
                </a>
              )}
              {s.note && <p className="mt-1 text-[10px] italic text-ink-faint">{s.note}</p>}
            </li>
          ))}
        </ul>
      </div>

      {linkToFullPage && (
        <Link
          href={`/event/${event.slug}`}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-5 w-full")}
        >
          Open full event page
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      )}
    </div>
  );
}
