"use client";

import type { ExposureDimension } from "@/lib/types";
import type { ImpactComponent } from "@/lib/types";
import { DIMENSION_LABEL } from "@/lib/data/impact";
import { formatSigned, exposureLabel, cn } from "@/lib/utils";
import { SEVERITY_TEXT_CLASS, severityFromScore } from "@/lib/utils/severity";

/** One exposure dimension. No sparkline: there is no sourced history behind a
 * dimension's trend, and a generated one would present invented movement as
 * intelligence. Dimensions that are rule-of-thumb estimates (everything but
 * security) are labelled as such. */
export function ExposureCategoryCard({
  dimension,
  value,
  change24h,
  topConflictName,
  basis,
}: {
  dimension: ExposureDimension;
  value: number;
  change24h: number;
  topConflictName?: string;
  basis: ImpactComponent["basis"];
}) {
  const severity = severityFromScore(value);

  return (
    <div className="rounded-2xl border border-border bg-card/70 p-4" data-testid={`exposure-card-${dimension}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
        {DIMENSION_LABEL[dimension]}
      </p>
      <div className="mt-1 flex items-end justify-between">
        <p className={cn("text-2xl font-semibold tabular-nums", SEVERITY_TEXT_CLASS[severity])}>
          {value}
        </p>
        <span className="text-xs text-ink-faint">{exposureLabel(value)}</span>
      </div>
      <p className="text-[11px] text-ink-faint">{formatSigned(change24h)} today</p>
      <p className="mt-2 text-[10px] uppercase tracking-wide text-ink-faint" data-testid={`exposure-basis-${dimension}`}>
        {basis === "estimated" ? "Estimated — no sourced data yet" : "Computed"}
      </p>

      {topConflictName && (
        <p className="mt-1 truncate text-[11px] text-ink-faint">Top driver: {topConflictName}</p>
      )}
    </div>
  );
}
