"use client";

import { CountUp } from "@/components/ui/count-up";
import { SeverityBadge } from "@/components/ui/severity-badge";
import { Card } from "@/components/ui/card";
import { SEVERITY_TEXT_CLASS, severityFromScore } from "@/lib/utils/severity";
import { exposureLabel } from "@/lib/utils/exposure";
import { formatSigned, cn } from "@/lib/utils";
import { getCountryByCode, getTopConflictsForCountry, DIMENSION_LABEL } from "@/lib/data";
import type { Conflict } from "@/lib/types";

export function MobileStatusStrip({ status }: { status: { score: number; change24h: number } | null }) {
  if (!status) return null;
  const { score, change24h } = status;
  const severity = severityFromScore(score);
  return (
    <div className="flex items-center gap-4 px-4">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-faint">
          Global Status
        </p>
        <div className="flex items-baseline gap-2">
          <span className={cn("text-3xl font-semibold tabular-nums", SEVERITY_TEXT_CLASS[severity])}>
            <CountUp value={score} />
          </span>
          <SeverityBadge severity={severity} size="sm" />
        </div>
      </div>
      <span className="ml-auto text-xs text-ink-faint">{formatSigned(change24h)} today</span>
    </div>
  );
}

export function MobileTopExposureCard({
  baseCountryCode,
  conflicts,
  onSeeWhy,
}: {
  baseCountryCode: string;
  conflicts: readonly Conflict[];
  onSeeWhy: (slug: string) => void;
}) {
  const country = getCountryByCode(baseCountryCode);
  if (!country) return null;
  const [top] = getTopConflictsForCountry(country, conflicts, 1);
  if (!top) return null;
  const { conflict, impact } = top;

  return (
    <Card className="mx-4 p-4">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-faint">
        Your Top Exposure
      </p>
      <div className="mt-1.5 flex items-center justify-between">
        <h3 className="text-base font-semibold text-ink">{conflict.shortName}</h3>
        <span className="text-xl font-semibold tabular-nums text-accent">{impact.score}</span>
      </div>
      <p className="text-[11px] text-ink-faint">Impact Score</p>

      <div className="mt-3 space-y-1.5">
        {impact.components.slice(0, 3).map((c) => (
          <div key={c.dimension} className="flex items-center justify-between text-sm">
            <span className="text-ink-dim">{DIMENSION_LABEL[c.dimension]}</span>
            <span className="font-medium text-ink">{exposureLabel(c.value)}</span>
          </div>
        ))}
      </div>

      <button
        onClick={() => onSeeWhy(conflict.slug)}
        className="mt-3 text-xs font-medium text-accent hover:underline"
      >
        See Why
      </button>
    </Card>
  );
}
