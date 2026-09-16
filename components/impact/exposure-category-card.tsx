"use client";

import { LineChart, Line, ResponsiveContainer } from "recharts";
import type { ExposureDimension } from "@/lib/types";
import { DIMENSION_LABEL } from "@/lib/data/impact";
import { generateTrendSeries } from "@/lib/data/trend";
import { formatSigned, exposureLabel, cn } from "@/lib/utils";
import { SEVERITY_TEXT_CLASS, severityFromScore } from "@/lib/utils/severity";

export function ExposureCategoryCard({
  dimension,
  value,
  change24h,
  topConflictName,
  seedKey,
}: {
  dimension: ExposureDimension;
  value: number;
  change24h: number;
  topConflictName?: string;
  seedKey: string;
}) {
  const series = generateTrendSeries(seedKey, value).map((v, i) => ({ i, v }));
  const severity = severityFromScore(value);

  return (
    <div className="rounded-2xl border border-border bg-card/70 p-4">
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

      <div className="mt-2 h-10">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={series}>
            <Line type="monotone" dataKey="v" stroke="#4CC2FF" strokeWidth={1.75} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {topConflictName && (
        <p className="mt-1 truncate text-[11px] text-ink-faint">Top driver: {topConflictName}</p>
      )}
    </div>
  );
}
