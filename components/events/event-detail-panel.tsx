"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, MapPin } from "lucide-react";
import type { ConflictEvent } from "@/lib/types";
import type { ActorLink } from "@/lib/public/actors";
import { EventTypeIcon, getEventTypeLabel } from "./event-type-icon";
import { SourceRoleIcon, getSourceRoleLabel } from "./source-role-icon";
import { VerificationBadge } from "@/components/ui/verification-badge";
import { SeverityBadge } from "@/components/ui/severity-badge";
import { RelativeTime } from "@/components/ui/relative-time";
import { buttonVariants } from "@/components/ui/button";
import { formatAbsoluteTime, cn } from "@/lib/utils";
import { getCountryByCode } from "@/lib/reference/countries";
import { useAppStore } from "@/hooks/use-app-store";
import { describeHistoryEntry } from "@/lib/data/event-history-description";

const PRECISION_LABEL: Record<string, string> = {
  exact: "Exact location",
  approximate: "Approximate location",
  area_level: "Area-level location (no precise point)",
  unknown: "Location unknown",
};

export interface EventPanelTerritorialChange {
  id: string;
  description: string;
  changeType: string;
  locationName: string | null;
  conflictSlug: string;
  sourceName: string | null;
  sourceUrl: string | null;
  geometryApplied: boolean;
}

/** One event. Deliberately separates the EVENT (what happened, when, where, how
 * sure we are) from the SUPPORTING REPORTS behind it (articles/posts, each with
 * its own publisher, publication time and original link). A missing original URL
 * is said to be missing; a repeated article is flagged, never counted twice. */
export function EventDetailPanel({
  event,
  conflict,
  actors,
  territorialChanges,
  linkToFullPage = true,
}: {
  event: ConflictEvent;
  /** The event's conflict, when the caller has it (adds the link). */
  conflict?: { slug: string; shortName: string } | null;
  /** Actor names with links where they exist as stored actors. Falls back to plain names. */
  actors?: ActorLink[];
  territorialChanges?: EventPanelTerritorialChange[];
  /** Hide the "Open full event page" link when this panel IS the full event page (avoids a self-referential link). */
  linkToFullPage?: boolean;
}) {
  const country = getCountryByCode(event.countryCode);
  const timezone = useAppStore((s) => s.timezone);

  // formatAbsoluteTime(..., "auto") resolves to the *runtime's* local timezone,
  // which differs between server and browser — so server render and the client's
  // pre-hydration render both use "UTC"; the device timezone only applies after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);
  const effectiveTimezone = mounted ? timezone : "UTC";

  const precision = event.locationPrecision ?? null;
  const actorList: ActorLink[] = actors ?? (event.actors ?? []).map((name) => ({ name, href: null }));

  return (
    <div data-testid="event-detail">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
        <EventTypeIcon eventType={event.eventType} className="h-3.5 w-3.5" />
        {getEventTypeLabel(event.eventType)}
      </div>
      <h2 className="mt-1.5 text-lg font-semibold leading-snug text-ink">{event.title}</h2>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-dim">
        <span className="flex items-center gap-1" data-testid="event-location">
          <MapPin className="h-3 w-3" /> {country ? `${country.flag} ${country.name}` : event.region}
          {precision && <span className="text-ink-faint"> · {PRECISION_LABEL[precision] ?? precision}</span>}
        </span>
        <span data-testid="event-occurred">{formatAbsoluteTime(event.occurredAt, effectiveTimezone)}</span>
        <RelativeTime iso={event.occurredAt} />
        {/* Driven by updateHistory (an accepted change actually happened), not by
            Event.updatedAt — that column also moves on publish/unpublish. */}
        {event.updateHistory && event.updateHistory.length > 0 && (
          <span data-testid="event-updated-ago">
            <RelativeTime iso={event.updateHistory[0]!.changedAt} prefix="Updated " />
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <SeverityBadge severity={event.severity} size="sm" />
        <VerificationBadge status={event.verificationStatus} disputed={event.disputed} />
        <span className="text-[11px] text-ink-faint" data-testid="event-evidence-summary">
          {event.sourceCount} independent source{event.sourceCount === 1 ? "" : "s"} · {event.sources.length} supporting report{event.sources.length === 1 ? "" : "s"}
        </span>
      </div>

      <p className="mt-4 text-sm leading-relaxed text-ink-dim">{event.summary}</p>

      {(actorList.length > 0 || event.casualtiesKilled != null || event.casualtiesInjured != null || (event.infrastructureDamage?.length ?? 0) > 0) && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-dim" data-testid="event-accepted-facts">
          {actorList.length > 0 && (
            <span data-testid="event-actors">
              Actors:{" "}
              {actorList.map((a, i) => (
                <span key={a.name}>
                  {i > 0 && ", "}
                  {a.href ? (
                    <Link href={a.href} className="text-accent hover:underline" data-testid="actor-link">
                      {a.name}
                    </Link>
                  ) : (
                    a.name
                  )}
                </span>
              ))}
            </span>
          )}
          {event.casualtiesKilled != null && <span>Killed: {event.casualtiesKilled}</span>}
          {event.casualtiesInjured != null && <span>Injured: {event.casualtiesInjured}</span>}
          {event.infrastructureDamage && event.infrastructureDamage.length > 0 && <span>Damage: {event.infrastructureDamage.join(", ")}</span>}
        </div>
      )}

      {conflict && (
        <Link href={`/conflict/${conflict.slug}`} className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
          Part of {conflict.shortName}
          <ArrowRight className="h-3 w-3" />
        </Link>
      )}

      {territorialChanges && territorialChanges.length > 0 && (
        <div className="mt-5" data-testid="event-territorial-changes">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Territorial change</p>
          <ul className="mt-2 space-y-1.5">
            {territorialChanges.map((c) => (
              <li key={c.id} className="rounded-lg border border-border px-3 py-2 text-xs text-ink-dim">
                <span className="font-medium text-ink">{c.description}</span>
                {c.locationName && <span> · {c.locationName}</span>}
                {!c.geometryApplied && <span className="text-ink-faint"> · verified record, map not yet updated</span>}
                {c.sourceUrl ? (
                  <a href={c.sourceUrl} target="_blank" rel="noopener noreferrer" className="ml-1 text-accent hover:underline">
                    {c.sourceName ?? "source"}
                  </a>
                ) : (
                  <span className="ml-1 text-ink-faint">Source unavailable</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Timeline</p>
        <ol className="mt-2 space-y-3 border-l border-border pl-3">
          {event.timeline.map((t, i) => (
            <li key={i} className="relative">
              <span className="absolute -left-[17px] top-1 h-2 w-2 rounded-full bg-accent" aria-hidden />
              <p className="text-xs font-medium text-ink">{t.label}</p>
              <p className="text-[11px] text-ink-faint">
                <RelativeTime iso={t.time} />
              </p>
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
                <span className="text-ink-faint">
                  <RelativeTime iso={h.changedAt} />
                </span>{" "}
                — {describeHistoryEntry(h)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-5" data-testid="event-reports">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Supporting reports ({event.sources.length})</p>
        <p className="mt-1 text-[11px] text-ink-faint">Articles and posts behind this event — evidence for it, not separate events.</p>
        {event.sources.length === 0 ? (
          <p className="mt-2 text-xs text-ink-faint" data-testid="event-no-reports">
            No supporting report is attached to this event.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {event.sources.map((s, i) => (
              // s.id is the outlet's id, not this link's: the same outlet can supply more than one
              // report to one event, so the key is index-qualified.
              <li key={`${s.id}-${i}`} className="rounded-lg border border-border px-3 py-2 text-xs" data-testid="event-report">
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
                  <p className="shrink-0 text-ink-faint">
                    <RelativeTime iso={s.publishedAt} />
                  </p>
                </div>
                <p className="mt-0.5 text-ink-faint">
                  Source type: {s.sourceType}
                  {getSourceRoleLabel(s.sourceRole) && ` · ${getSourceRoleLabel(s.sourceRole)}`}
                </p>
                <p className="mt-0.5 text-ink-faint">Published: {formatAbsoluteTime(s.publishedAt, effectiveTimezone)}</p>
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="mt-1 block truncate text-accent hover:underline" data-testid="original-source-link">
                    Original source: {s.url}
                  </a>
                ) : (
                  <p className="mt-1 text-ink-faint" data-testid="source-unavailable">
                    Source unavailable
                  </p>
                )}
                {s.note && <p className="mt-1 text-[10px] italic text-ink-faint">{s.note}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {linkToFullPage && (
        <Link href={`/event/${event.slug}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-5 w-full")}>
          Open full event page
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      )}
    </div>
  );
}
