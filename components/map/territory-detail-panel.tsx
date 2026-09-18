"use client";

import { ExternalLink } from "lucide-react";
import type { TerritoryFeatureProperties } from "@/lib/types/territorial-control";
import { formatAbsoluteTime, timeAgo } from "@/lib/utils";

const STATUS_LABEL: Record<TerritoryFeatureProperties["status"], string> = {
  controlled: "Controlled",
  contested: "Contested",
  uncertain: "Uncertain",
  recently_changed: "Recently changed control",
};

// Spec §8 "clicking a territorial area should show a compact panel with:
// controlling actor/status, conflict, confidence, effective since, last
// updated, sources" — deliberately reads straight off the clicked
// feature's own GeoJSON properties (already carrying every field listed)
// rather than a second network round-trip, since the feature currently
// rendered on the map IS already the historically-correct version for
// whatever asOf is active (see app/api/territorial-control/route.ts).
export function TerritoryDetailPanel({ territory }: { territory: TerritoryFeatureProperties }) {
  return (
    <div data-testid="territory-detail-panel">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{territory.conflictName}</div>
      <h2 className="mt-1.5 text-lg font-semibold leading-snug text-ink">
        {territory.actorName ?? "No clear controlling actor"}
      </h2>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span
          data-testid="territory-status-badge"
          className="rounded-full border border-border-strong px-2 py-0.5 text-xs font-medium text-ink-dim"
        >
          {STATUS_LABEL[territory.status]}
        </span>
        <span className="text-xs text-ink-faint">Confidence {Math.round(territory.confidence * 100)}%</span>
      </div>

      {/* Never presented as a legal/sovereignty determination — status and
          confidence above are explicitly a de facto/reported-control claim
          (spec §2/§9), and this line makes that framing explicit rather
          than implicit. */}
      <p className="mt-3 text-xs italic text-ink-faint">
        Reflects reported/de facto control only — not a legal determination of sovereignty.
      </p>

      <dl className="mt-4 space-y-2 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-ink-faint">Effective since</dt>
          <dd className="text-ink-dim" data-testid="territory-valid-from">
            {formatAbsoluteTime(territory.validFrom, "UTC")} ({timeAgo(territory.validFrom)})
          </dd>
        </div>
        {territory.validTo && (
          <div className="flex justify-between gap-3">
            <dt className="text-ink-faint">Superseded</dt>
            <dd className="text-ink-dim">{formatAbsoluteTime(territory.validTo, "UTC")}</dd>
          </div>
        )}
        <div className="flex justify-between gap-3">
          <dt className="text-ink-faint">Last updated</dt>
          <dd className="text-ink-dim">{timeAgo(territory.lastUpdated)}</dd>
        </div>
      </dl>

      {(territory.sourceName || territory.sourceUrl) && (
        <div className="mt-4 border-t border-border/60 pt-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Source</div>
          {territory.sourceUrl ? (
            <a
              href={territory.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-1 flex items-center gap-1 text-sm text-accent hover:underline"
            >
              {territory.sourceName ?? territory.sourceUrl} <ExternalLink className="h-3 w-3" />
            </a>
          ) : (
            <p className="mt-1 text-sm text-ink-dim">{territory.sourceName}</p>
          )}
        </div>
      )}
      {!territory.sourceName && !territory.sourceUrl && (
        <p className="mt-4 border-t border-border/60 pt-3 text-xs text-ink-faint">No source recorded.</p>
      )}
    </div>
  );
}
