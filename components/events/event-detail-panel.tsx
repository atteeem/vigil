"use client";

import Link from "next/link";
import { ArrowRight, MapPin } from "lucide-react";
import type { ConflictEvent } from "@/lib/types";
import { EVENT_TYPE_ICON, EVENT_TYPE_LABEL } from "./event-type-icon";
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
  const Icon = EVENT_TYPE_ICON[event.eventType];
  const country = getCountryByCode(event.countryCode);
  const conflict = event.conflictId ? getConflictById(event.conflictId) : undefined;
  const timezone = useAppStore((s) => s.timezone);

  return (
    <div>
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
        <Icon className="h-3.5 w-3.5" aria-hidden />
        {EVENT_TYPE_LABEL[event.eventType]}
      </div>
      <h2 className="mt-1.5 text-lg font-semibold leading-snug text-ink">{event.title}</h2>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-dim">
        <span className="flex items-center gap-1">
          <MapPin className="h-3 w-3" /> {country ? `${country.flag} ${country.name}` : event.region}
        </span>
        <span>{formatAbsoluteTime(event.occurredAt, timezone)}</span>
        <span>{timeAgo(event.occurredAt, MOCK_NOW)}</span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <SeverityBadge severity={event.severity} size="sm" />
        <VerificationBadge status={event.verificationStatus} disputed={event.disputed} />
      </div>

      <p className="mt-4 text-sm leading-relaxed text-ink-dim">{event.summary}</p>

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

      <div className="mt-5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          Sources ({event.sources.length})
        </p>
        <ul className="mt-2 space-y-2">
          {event.sources.map((s) => (
            <li key={s.id} className="rounded-lg border border-border px-3 py-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium text-ink">{s.name}</p>
                <p className="shrink-0 text-ink-faint">{timeAgo(s.publishedAt, MOCK_NOW)}</p>
              </div>
              <p className="mt-0.5 text-ink-faint">{s.sourceType}</p>
              <a
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 block truncate text-accent hover:underline"
              >
                {s.url}
              </a>
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
