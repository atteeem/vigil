"use client";

import Link from "next/link";
import type { ConflictEvent, SourceRef } from "@/lib/types";
import type { ConflictingClaims, PublicClaim } from "@/lib/public/claims";
import { SourceRoleIcon } from "./source-role-icon";
import { SourceTrustHelp } from "@/components/sources/source-trust-help";
import { RelativeTime } from "@/components/ui/relative-time";
import { EmptyState } from "@/components/public/data-states";
import { useAppStore } from "@/hooks/use-app-store";
import { describeEvidence, sourceTrust, summarizeEvidence, type EvidenceReport, type SourceTrust } from "@/lib/sources/trust";
import { formatAbsoluteTime, cn } from "@/lib/utils";

const trustOf = (s: SourceRef): SourceTrust => s.trust ?? sourceTrust({ sourceRole: s.sourceRole });

export function evidenceReports(sources: readonly SourceRef[]): EvidenceReport[] {
  return sources.map((s) => ({ sourceId: s.id, url: s.url, trust: trustOf(s), relay: s.relationship === "relay" }));
}

const TRUST_CLASS: Record<string, string> = {
  strong: "border-stable/40 text-stable",
  perspective: "border-accent/40 text-accent",
  party_claim: "border-high/50 bg-high-dim text-high",
  discovery: "border-border-strong text-ink-faint",
  unclassified: "border-border-strong text-ink-faint",
};

function TrustBadge({ trust }: { trust: SourceTrust }) {
  return (
    <span className={cn("rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide", TRUST_CLASS[trust.category])} data-testid="trust-label">
      {trust.badge ?? trust.label}
    </span>
  );
}

function OriginalLink({ url }: { url: string | null }) {
  return url ? (
    <a href={url} target="_blank" rel="noopener noreferrer" className="mt-1 block truncate text-accent hover:underline" data-testid="original-source-link">
      Original source: {url}
    </a>
  ) : (
    <p className="mt-1 text-ink-faint" data-testid="source-unavailable">
      Source unavailable
    </p>
  );
}

/** Reports/sources for ONE event, and the claims among them. The event itself is described
 * elsewhere; here every card is a report with its own outlet, trust label, publication time
 * and original URL. Party / aligned claims are hidden unless the user turned them on, and are
 * never counted as independent confirmation. A claim is worded as a claim. */
export function EvidencePanel({
  event,
  timezone,
  conflictingClaims = [],
}: {
  event: ConflictEvent;
  timezone: string;
  conflictingClaims?: ConflictingClaims[];
}) {
  const showPartyClaims = useAppStore((s) => s.showPartyClaims);
  const summary = summarizeEvidence(evidenceReports(event.sources));
  const partyReports = event.sources.filter((s) => trustOf(s).category === "party_claim");
  const otherReports = event.sources.filter((s) => trustOf(s).category !== "party_claim");
  const hiddenClaims = showPartyClaims ? 0 : partyReports.length;
  const claimStatus = summary.independentSources > 0 ? `Corroborated by ${summary.independentSources} independent source${summary.independentSources === 1 ? "" : "s"}` : "Uncorroborated";

  return (
    <div className="mt-5" data-testid="event-reports">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Reports and sources</p>
      <SourceTrustHelp className="mt-1" />
      <p className="mt-1 text-xs text-ink-dim" data-testid="evidence-summary-line">
        {summary.independentSources > 0 ? describeEvidence(summary, { claims: false }) : "No independent confirmation"}
        {hiddenClaims > 0 && (
          <span data-testid="party-claims-hidden">
            {" · "}
            {hiddenClaims} party claim{hiddenClaims === 1 ? "" : "s"} hidden
          </span>
        )}
        {showPartyClaims && summary.partyClaims > 0 && (
          <span>
            {" · "}
            {summary.partyClaims} party claim{summary.partyClaims === 1 ? "" : "s"} shown
          </span>
        )}
      </p>
      <p className="mt-1 text-[11px] text-ink-faint">Articles and posts behind this event — evidence for it, not separate events. Several reports from one outlet count as one independent source.</p>

      {summary.independentSources === 0 && (
        <EmptyState
          className="mt-2"
          testId="no-independent-confirmation"
          title="No independent confirmation"
          detail={summary.partyClaims > 0 ? "This event currently rests on party claims only." : "No report from an independent source is attached yet."}
        />
      )}

      {otherReports.length === 0 && event.sources.length === 0 ? (
        <p className="mt-2 text-xs text-ink-faint" data-testid="event-no-reports">
          No supporting report is attached to this event.
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {otherReports.map((s, i) => {
            const trust = trustOf(s);
            return (
              // s.id is the outlet's id, not this link's: the same outlet can supply several reports to one event.
              <li key={`${s.id}-${i}`} className="rounded-lg border border-border px-3 py-2 text-xs" data-testid="event-report">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="flex flex-wrap items-center gap-1.5 font-medium text-ink">
                    <SourceRoleIcon sourceRole={s.sourceRole} className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
                    {s.name}
                    <TrustBadge trust={trust} />
                  </p>
                  <p className="shrink-0 text-ink-faint">
                    <RelativeTime iso={s.publishedAt} />
                  </p>
                </div>
                {trust.perspective && <p className="mt-0.5 text-ink-dim">{trust.perspective}</p>}
                <p className="mt-0.5 text-ink-faint">
                  Source published: {formatAbsoluteTime(s.publishedAt, timezone)}
                  {s.author && ` · ${s.author}`}
                </p>
                <OriginalLink url={s.url} />
                {s.note && <p className="mt-1 text-[10px] italic text-ink-faint">{s.note}</p>}
              </li>
            );
          })}
        </ul>
      )}

      {(showPartyClaims && partyReports.length > 0) || conflictingClaims.length > 0 ? (
        <div className="mt-4" data-testid="event-claims">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Claims</p>
          <p className="mt-1 text-[11px] text-ink-faint">A claim is what a party says. It is not treated as established unless independent sources support it.</p>
          {showPartyClaims && partyReports.length > 0 && (
            <ul className="mt-2 space-y-2">
              {partyReports.map((s, i) => (
                <li key={`${s.id}-${i}`} className="rounded-lg border border-high/40 bg-high-dim/40 px-3 py-2 text-xs" data-testid="party-claim">
                  <p className="flex flex-wrap items-center gap-1.5 font-medium text-ink">
                    <TrustBadge trust={trustOf(s)} />
                    {s.name}
                    {trustOf(s).perspective && <span className="font-normal text-ink-dim">({trustOf(s).perspective})</span>}
                  </p>
                  <p className="mt-1 text-ink-dim" data-testid="claim-wording">
                    {s.name} reports: {s.reportTitle ? `“${s.reportTitle}”` : "a claim about this event (no headline stored)"}
                  </p>
                  <p className="mt-0.5 text-ink-faint" data-testid="claim-status">
                    Status: {claimStatus}
                  </p>
                  <p className="text-ink-faint">
                    Published <RelativeTime iso={s.publishedAt} /> · {formatAbsoluteTime(s.publishedAt, timezone)}
                  </p>
                  <OriginalLink url={s.url} />
                </li>
              ))}
            </ul>
          )}
          {conflictingClaims.map((group) => (
            <ConflictingClaimsBlock key={`${group.conflictSlug}-${group.location}`} group={group} timezone={timezone} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

const CHANGE_VERB: Record<string, string> = { captured: "claims to have captured", recaptured: "claims to have recaptured", lost: "reports losing", withdrew: "reports withdrawing from", handed_over: "reports a handover of", contested: "claims contested control of", uncertain: "reports a control change at" };

function ClaimLine({ claim, location }: { claim: PublicClaim; location: string }) {
  return (
    <li className="rounded-lg border border-border px-3 py-2 text-xs" data-testid="territorial-claim">
      <span className="text-[9px] font-semibold uppercase tracking-wide text-high">Party claim</span>{" "}
      <span className="font-medium text-ink">
        {claim.actor?.href ? (
          <Link href={claim.actor.href} className="text-accent hover:underline" data-testid="actor-link">
            {claim.actor.name}
          </Link>
        ) : (
          (claim.actor?.name ?? "A party")
        )}{" "}
        {CHANGE_VERB[claim.changeType] ?? "reports a change at"} {location}
      </span>
      <p className="mt-0.5 text-ink-faint">
        Status: {claim.uncorroborated ? "Uncorroborated" : `Corroborated by ${claim.independentCorroboration} independent source${claim.independentCorroboration === 1 ? "" : "s"}`}
        {claim.status === "uncertain" && " · reviewer marked uncertain"}
      </p>
      {claim.sourceUrl ? (
        <a href={claim.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline" data-testid="original-source-link">
          {claim.sourceName ?? "source"}
        </a>
      ) : (
        <span className="text-ink-faint" data-testid="source-unavailable">
          Source unavailable
        </span>
      )}
    </li>
  );
}

export function ConflictingClaimsBlock({ group, timezone: _timezone }: { group: ConflictingClaims; timezone?: string }) {
  void _timezone;
  return (
    <div className="mt-3 rounded-xl border border-elevated/40 p-3" data-testid="conflicting-claims">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-elevated">Conflicting claims — {group.location}</p>
      <p className="mt-0.5 text-[11px] text-ink-faint">Each side claims control. No conclusion is drawn while this is unresolved.</p>
      <ul className="mt-2 space-y-2">
        {group.claims.map((c) => (
          <ClaimLine key={c.id} claim={c} location={group.location} />
        ))}
      </ul>
    </div>
  );
}
