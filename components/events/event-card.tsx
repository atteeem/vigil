import Link from "next/link";
import { MapPin } from "lucide-react";
import type { ConflictEvent } from "@/lib/types";
import { EventTypeIcon, getEventTypeLabel } from "./event-type-icon";
import { VerificationBadge } from "@/components/ui/verification-badge";
import { timeAgo } from "@/lib/utils/format";
import { MOCK_NOW } from "@/lib/data/constants";
import { getCountryByCode } from "@/lib/data/mock-countries";
import { cn } from "@/lib/utils";

export function EventCard({
  event,
  className,
  compact,
}: {
  event: ConflictEvent;
  className?: string;
  compact?: boolean;
}) {
  const country = getCountryByCode(event.countryCode);

  return (
    <Link
      href={`/event/${event.slug}`}
      className={cn(
        "block rounded-2xl border border-border bg-card/70 p-4 transition-colors hover:border-border-strong hover:bg-card",
        className,
      )}
    >
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
        <EventTypeIcon eventType={event.eventType} className="h-3.5 w-3.5" />
        {getEventTypeLabel(event.eventType)}
        <span aria-hidden>·</span>
        <span>{timeAgo(event.occurredAt, MOCK_NOW)}</span>
      </div>
      <h3 className={cn("mt-1.5 font-medium text-ink", compact ? "text-sm" : "text-[15px]")}>
        {event.title}
      </h3>
      <div className="mt-1.5 flex items-center gap-1 text-xs text-ink-dim">
        <MapPin className="h-3 w-3" aria-hidden />
        {country ? `${country.flag} ${country.name}` : event.region}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <VerificationBadge status={event.verificationStatus} disputed={event.disputed} />
        <span className="text-[11px] text-ink-faint">
          {event.sourceCount} source{event.sourceCount === 1 ? "" : "s"}
        </span>
      </div>
    </Link>
  );
}
