"use client";

import { ExternalLink } from "lucide-react";
import { RelativeTime } from "@/components/ui/relative-time";
import type { HazardDetail } from "@/lib/hazards/public-types";
import { hazardHeadline } from "@/lib/hazards/headline";
import { cn } from "@/lib/utils";

type Meta = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function Fact({ label, children, testId }: { label: string; children: React.ReactNode; testId?: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border/50 py-1.5 text-xs" data-testid={testId}>
      <dt className="text-ink-faint">{label}</dt>
      <dd className="text-right text-ink">{children}</dd>
    </div>
  );
}

const utc = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;

function statusText(d: HazardDetail): string {
  switch (d.status) {
    case "withdrawn":
      return "Withdrawn by provider";
    case "expired":
      return "Expired";
    case "stale":
      return "Stale — not updated recently; may no longer be current";
    default:
      return "Active";
  }
}

/** Domain-specific detail for one structured event: sensor/official data, never dressed as a news report. */
export function HazardDetailView({ detail: d, className }: { detail: HazardDetail; className?: string }) {
  const m = d.metadata as Meta;
  return (
    <article className={cn("text-sm", className)} data-testid="hazard-detail" data-hazard-category={d.category} data-hazard-status={d.status}>
      <p className="mb-1 inline-block rounded-full border border-border-strong px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-dim" data-testid="hazard-origin">
        {d.originLabel}
      </p>
      <h2 className="text-lg font-semibold text-ink" data-testid="hazard-title">
        {hazardHeadline(d)}
      </h2>
      {d.category === "earthquake" && d.description && <p className="text-xs text-ink-dim" data-testid="hazard-place">{d.description}</p>}
      {d.asOf && <p className="mt-1 text-[11px] text-accent" data-testid="hazard-asof">Reconstructed as known at {utc(d.asOf)}</p>}

      {d.category === "thermal_detection" && (
        <p className="mt-2 rounded-lg border border-border-strong bg-surface/60 px-3 py-2 text-xs text-ink-dim" data-testid="hazard-caveat">
          Satellite thermal detection — not necessarily a confirmed wildfire.
        </p>
      )}
      {d.stale && (
        <p className="mt-2 rounded-lg border border-elevated/40 px-3 py-2 text-xs text-elevated" data-testid="hazard-stale">
          {d.category === "volcano" ? "Last reported" : "Last updated"} {utc(d.providerUpdatedAt ?? d.observedAt)}. This record is old and is not evidence of current activity.
        </p>
      )}

      <dl className="mt-3">
        {d.category === "earthquake" && (
          <>
            <Fact label="Magnitude" testId="fact-magnitude">{d.severity.label}{str(m.magnitudeType) ? ` (${m.magnitudeType})` : ""}</Fact>
            <Fact label="Depth" testId="fact-depth">{num(m.depthKm) != null ? `${Math.round(num(m.depthKm)!)} km` : "Not reported"}</Fact>
            <Fact label="Tsunami" testId="fact-tsunami">{m.tsunami === true ? "Tsunami flag set by provider" : "No"}</Fact>
            <Fact label="Significance" testId="fact-significance">{num(m.significance) ?? "—"}</Fact>
            {d.confidence.label && <Fact label="Solution" testId="fact-solution">{d.confidence.label}</Fact>}
            {str(m.pagerAlert) && <Fact label="USGS PAGER alert">{String(m.pagerAlert)}</Fact>}
          </>
        )}
        {d.category === "thermal_detection" && (
          <>
            <Fact label="Satellite" testId="fact-satellite">{str(m.satellite) ?? "—"}{str(m.instrument) ? ` · ${m.instrument}` : ""}</Fact>
            <Fact label="Provider confidence" testId="fact-confidence">{d.confidence.label ?? "Not supplied"}</Fact>
            <Fact label="Fire radiative power" testId="fact-frp">{d.severity.label ?? "—"}</Fact>
            {num(m.brightnessK) != null && <Fact label="Brightness">{num(m.brightnessK)} K</Fact>}
            {str(m.dayNight) && <Fact label="Day / night">{String(m.dayNight)}</Fact>}
          </>
        )}
        {d.category === "confirmed_wildfire" && (
          <>
            <Fact label="Reported by">{str(m.upstreamSource) ?? d.providerLabel}</Fact>
            {d.severity.label && <Fact label="Reported size" testId="fact-size">{d.severity.label}</Fact>}
            {d.description && <Fact label="Location">{d.description}</Fact>}
          </>
        )}
        {d.category === "volcano" && (
          <>
            {d.severity.label ? <Fact label="Alert level" testId="fact-alert-level">{d.severity.label}{str(m.colorCode) ? ` · aviation code ${m.colorCode}` : ""}</Fact> : <Fact label="Record type">Activity report (no alert level supplied)</Fact>}
            {str(m.observatory) && <Fact label="Observatory">{String(m.observatory)}</Fact>}
            {str(m.region) && <Fact label="Region">{String(m.region)}</Fact>}
            {num(m.elevationM) != null && <Fact label="Elevation">{num(m.elevationM)} m</Fact>}
          </>
        )}
        {d.category === "weather_alert" && (
          <>
            <Fact label="Authority" testId="fact-authority">{str(m.issuingAuthority) ?? d.providerLabel}</Fact>
            <Fact label="Severity" testId="fact-severity">{str(m.severity) ?? d.severity.label ?? "—"}</Fact>
            <Fact label="Certainty" testId="fact-certainty">{str(m.certainty) ?? "—"}</Fact>
            <Fact label="Urgency" testId="fact-urgency">{str(m.urgency) ?? "—"}</Fact>
            {d.effectiveAt && <Fact label="Effective" testId="fact-effective">{utc(d.effectiveAt)}</Fact>}
            {d.expiresAt && <Fact label="Expires" testId="fact-expires">{utc(d.expiresAt)}</Fact>}
            {str(m.areaDesc) && <Fact label="Area">{String(m.areaDesc).slice(0, 160)}</Fact>}
          </>
        )}
        {(d.category === "cyclone" || d.category === "flood") && (
          <>
            <Fact label="GDACS alert level" testId="fact-gdacs-level">{d.severity.label ?? "—"}</Fact>
            {str(m.severityText) && <Fact label="Assessment">{String(m.severityText)}</Fact>}
            {str(m.country) && <Fact label="Country">{String(m.country)}</Fact>}
            {str(m.agency) && <Fact label="Input agency">{String(m.agency)}</Fact>}
          </>
        )}
        <Fact label="Status" testId="fact-status">{statusText(d)}</Fact>
        <Fact label="Observed"><RelativeTime iso={d.observedAt} /></Fact>
        {d.providerUpdatedAt && <Fact label="Updated" testId="fact-updated"><RelativeTime iso={d.providerUpdatedAt} /></Fact>}
        <Fact label="Provider" testId="fact-provider">{d.providerLabel}</Fact>
        <Fact label="Location precision">{d.locationPrecision.replace("_", " ")}</Fact>
      </dl>

      {d.category === "weather_alert" && str(m.instruction) && <p className="mt-3 text-xs text-ink-dim">{String(m.instruction)}</p>}
      {d.category !== "earthquake" && d.category !== "thermal_detection" && d.description && d.category === "weather_alert" && <p className="mt-2 whitespace-pre-line text-xs text-ink-faint">{d.description.slice(0, 600)}</p>}

      {d.sourceUrl && (
        <a href={d.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs text-accent hover:underline" data-testid="hazard-source-link">
          View at {d.providerLabel} <ExternalLink className="h-3 w-3" />
        </a>
      )}
      {d.trust && (
        <p className="mt-3 text-[11px] text-ink-faint" data-testid="hazard-trust">
          {d.trust.label}
          {d.trust.scope ? ` — ${d.trust.scope}` : ""}
        </p>
      )}
      <p className="mt-1 text-[11px] text-ink-faint">
        Structured provider data, not a news report. Revision {d.revision} of {d.revisionCount}.
      </p>
    </article>
  );
}
