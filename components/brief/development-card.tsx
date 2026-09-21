"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown, MapPin } from "lucide-react";
import { RelativeTime } from "@/components/ui/relative-time";
import { mapHrefFor } from "@/lib/brief/links";
import type { BriefDevelopment } from "@/lib/brief/types";
import { cn } from "@/lib/utils";

const TYPE_LABEL: Record<string, string> = {
  conflict_event: "Incident",
  event_update: "Update",
  conflict_status: "Status change",
  actor_involvement: "Actor",
  escalation: "Escalation",
  de_escalation: "De-escalation",
  territory_changed: "Territorial change",
  territory_under_review: "Under review",
  territory_conflicting: "Conflicting claims",
  party_claim: "Party claim",
  airport: "Airport",
  airspace: "Airspace",
  chokepoint: "Chokepoint",
  port: "Port",
  maritime: "Maritime",
  energy: "Energy",
  internet: "Internet",
  earthquake: "Earthquake",
  weather: "Weather",
  volcano: "Volcano",
  wildfire: "Wildfire",
};
const CONF_STYLE = { high: "text-emerald-300 border-emerald-400/40", medium: "text-yellow-200 border-yellow-400/40", low: "text-ink-faint border-border-strong" } as const;
const ROLE_LABEL: Record<string, string> = { independent: "Independent report", party_claim: "Party claim", provider: "Official provider", discovery: "Discovery lead", repeat: "Repeat — not counted" };

export function DevelopmentCard({ d, showMap = true, historical = false }: { d: BriefDevelopment; showMap?: boolean; historical?: boolean }) {
  const [open, setOpen] = useState(false);
  const claim = d.developmentType === "party_claim";
  const conflicting = d.developmentType === "territory_conflicting";
  return (
    <article className={cn("rounded-xl border bg-card/60 px-4 py-3", claim ? "border-yellow-400/30" : conflicting ? "border-orange-400/30" : "border-border")} data-testid="development-card" data-dev-type={d.developmentType} data-dev-id={d.id}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", claim ? "border-yellow-400/40 text-yellow-200" : conflicting ? "border-orange-400/40 text-orange-300" : "border-border-strong text-ink-dim")} data-testid="dev-type">
          {claim ? "PARTY CLAIM" : conflicting ? "CONFLICTING CLAIMS" : d.isResolution ? "RESOLUTION" : (TYPE_LABEL[d.developmentType] ?? d.developmentType)}
        </span>
        <span className={cn("rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide", CONF_STYLE[d.confidenceLabel])} data-testid="dev-confidence">
          {d.confidenceLabel} confidence
        </span>
        <span className="ml-auto text-[11px] text-ink-faint">
          <RelativeTime iso={d.occurredAt} />
        </span>
      </div>
      <h3 className="mt-1.5 text-sm font-medium text-ink" data-testid="dev-title">
        {d.title}
      </h3>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-dim" data-testid="dev-summary">
        {d.summary}
      </p>
      {d.previousState && d.currentState && d.previousState !== d.currentState && (
        <p className="mt-1 text-[11px] text-ink-faint" data-testid="dev-change">
          {d.previousState} → {d.currentState}
        </p>
      )}
      {d.conflictingClaims && (
        <ul className="mt-1.5 space-y-0.5 text-[12px] text-ink-dim" data-testid="dev-claims">
          {d.conflictingClaims.map((c) => (
            <li key={c.actor}>
              <span className="font-medium text-ink">{c.actor}</span> claims: {c.text}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-faint">
        <span data-testid="dev-evidence">{d.evidence.text}</span>
        {d.conflictName && (
          <Link href={`/conflict/${d.conflictSlug}`} className="hover:text-ink">
            {d.conflictName}
          </Link>
        )}
        {d.countryCode && (
          <Link href={`/country/${d.countryCode}`} className="hover:text-ink" data-testid="dev-country-link">
            {d.countryCode}
          </Link>
        )}
        {showMap && (
          <Link href={mapHrefFor(d, { at: historical })} className="inline-flex items-center gap-1 text-accent hover:underline" data-testid="dev-map-link">
            <MapPin className="h-3 w-3" /> {d.mapTarget ? "View on map" : "Open"}
          </Link>
        )}
        <button type="button" onClick={() => setOpen((v) => !v)} className="ml-auto inline-flex items-center gap-1 hover:text-ink" aria-expanded={open} data-testid="dev-expand">
          Evidence &amp; why <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
        </button>
      </div>
      {open && (
        <div className="mt-2 space-y-2 rounded-lg border border-border bg-surface/60 p-3 text-[11px] text-ink-dim" data-testid="dev-details">
          <div>
            <p className="font-semibold text-ink">Sources</p>
            {d.sources.length === 0 ? (
              <p className="mt-0.5">No external source: derived from recorded state.</p>
            ) : (
              <ul className="mt-0.5 space-y-0.5" data-testid="dev-sources">
                {d.sources.map((s, i) => (
                  <li key={`${s.name}-${i}`}>
                    {s.url ? (
                      <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                        {s.name}
                      </a>
                    ) : (
                      <span>
                        {s.name} <span className="text-ink-faint">(source unavailable)</span>
                      </span>
                    )}{" "}
                    <span className="text-ink-faint">· {ROLE_LABEL[s.role] ?? s.role}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="font-semibold text-ink">Why it is here</p>
            <ul className="mt-0.5 list-disc pl-4" data-testid="dev-reasons">
              {d.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
              <li>
                Significance {d.significance}: {d.significanceReasons.join(", ")}
              </li>
              <li>Confidence: {d.confidenceReasons.join("; ")}</li>
            </ul>
          </div>
        </div>
      )}
    </article>
  );
}
