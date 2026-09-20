import Link from "next/link";
import type { ReactNode } from "react";
import type { Provenance, PublicEntityEvent } from "@/lib/public/entities";
import type { SourceTrust } from "@/lib/sources/trust";
import { EmptyState } from "@/components/public/data-states";
import { RelativeTime } from "@/components/ui/relative-time";
import { getEventTypeLabel } from "@/components/events/event-type-icon";
import { cn } from "@/lib/utils";

// Shared building blocks for the actor / unit / commander / equipment pages. Readable
// sections and cards rather than a graph; every relationship shows where it came from and
// how old that is, and an absent value is said to be absent.

export function EntitySection({ title, testId, children, note }: { title: string; testId: string; children: ReactNode; note?: string }) {
  return (
    <section className="mt-8" data-testid={testId}>
      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{title}</h2>
      {note && <p className="mt-1 text-[11px] text-ink-faint">{note}</p>}
      <div className="mt-2">{children}</div>
    </section>
  );
}

export function TrustChip({ trust }: { trust: SourceTrust | null }) {
  if (!trust) return <span className="rounded-full border border-border-strong px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-ink-faint">Reference source</span>;
  return (
    <span
      className={cn("rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide", trust.category === "party_claim" ? "border-high/50 text-high" : trust.category === "strong" ? "border-stable/40 text-stable" : "border-border-strong text-ink-faint")}
      data-testid="trust-label"
    >
      {trust.badge ?? trust.label}
    </span>
  );
}

/** "last sourced 4 months ago (2026-05-02) · may be out of date" — with an explicit stale/unknown marker. */
export function FreshnessText({ provenance, className }: { provenance: Provenance; className?: string }) {
  return (
    <span className={cn("text-[11px] text-ink-faint", className)} data-testid="relationship-freshness" data-freshness={provenance.freshness.state}>
      {provenance.freshnessText}
      {provenance.freshness.state === "stale" && (
        <span className="ml-1.5 rounded-full border border-elevated/40 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-elevated" data-testid="stale-relationship">
          stale
        </span>
      )}
    </span>
  );
}

export function ProvenanceLine({ provenance }: { provenance: Provenance }) {
  return (
    <span className="text-[11px] text-ink-faint" data-testid="provenance-line">
      {provenance.sourceName ?? "Source not recorded"}
      {provenance.sourceUrl ? (
        <>
          {" · "}
          <a href={provenance.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline" data-testid="original-source-link">
            original record
          </a>
        </>
      ) : (
        <>
          {" · "}
          <span data-testid="source-unavailable">Source unavailable</span>
        </>
      )}
      {" · "}
      <TrustChip trust={provenance.trust} />
      {provenance.confidence != null && <span> · confidence {Math.round(provenance.confidence * 100)}%</span>}
      <span> · </span>
      <FreshnessText provenance={provenance} />
    </span>
  );
}

export function EntityLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="text-accent hover:underline" data-testid="entity-link">
      {children}
    </Link>
  );
}

export function EntityEventList({ events, emptyTitle = "No published events linked yet" }: { events: PublicEntityEvent[]; emptyTitle?: string }) {
  if (events.length === 0) return <EmptyState title={emptyTitle} testId="entity-events-empty" />;
  return (
    <ul className="space-y-2" data-testid="entity-events">
      {events.map((e) => (
        <li key={e.slug} className="rounded-xl border border-border bg-card/60 px-3.5 py-2.5 text-xs" data-testid="entity-event">
          <Link href={`/event/${e.slug}`} className="text-sm text-accent hover:underline">
            {e.title}
          </Link>
          <p className="mt-0.5 text-ink-faint">
            {getEventTypeLabel(e.eventType as never)} · <RelativeTime iso={e.occurredAt} /> · {e.countryCode ?? "location unknown"}
            {e.locationPrecision && e.locationPrecision !== "exact" ? ` (${e.locationPrecision.replace("_", " ")})` : ""} · {e.severity}
          </p>
          <p className="text-ink-faint">
            {e.conflict && (
              <>
                <Link href={`/conflict/${e.conflict.slug}`} className="hover:underline">
                  {e.conflict.name}
                </Link>
                {" · "}
              </>
            )}
            {e.reportCount} report{e.reportCount === 1 ? "" : "s"} · {e.independentSources > 0 ? `${e.independentSources} independent source${e.independentSources === 1 ? "" : "s"}` : "no independent confirmation"}
          </p>
        </li>
      ))}
    </ul>
  );
}

export const TACTICAL_NOTE = "Strategic reference only. “Last sourced” means the last time Vigil sourced a mention of this entity — it does not say where it is or what it is doing now, and no positions are shown.";
