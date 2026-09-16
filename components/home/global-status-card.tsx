"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { GlassCard } from "@/components/ui/card";
import { CountUp } from "@/components/ui/count-up";
import { SEVERITY_LABEL, SEVERITY_TEXT_CLASS, severityFromScore } from "@/lib/utils/severity";
import { formatSigned, cn } from "@/lib/utils";
import { MOCK_CONFLICTS } from "@/lib/data/mock-conflicts";

export function GlobalStatusCard({
  score,
  change24h,
  className,
}: {
  score: number;
  change24h: number;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const severity = severityFromScore(score);

  const topDrivers = [...MOCK_CONFLICTS]
    .sort((a, b) => b.intensity - a.intensity)
    .slice(0, 3);

  return (
    <GlassCard className={cn("w-full max-w-[280px] p-5", className)}>
      <p className="text-[11px] font-semibold uppercase tracking-widest text-ink-faint">
        Global Status
      </p>
      <div className="mt-2 flex items-baseline gap-2">
        <span className={cn("text-4xl font-semibold tabular-nums", SEVERITY_TEXT_CLASS[severity])}>
          <CountUp value={score} />
        </span>
        <span className="text-sm font-medium text-ink-dim">/ 100</span>
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-xs">
        <span className={cn("font-semibold", SEVERITY_TEXT_CLASS[severity])}>
          {SEVERITY_LABEL[severity]}
        </span>
        <span className="text-ink-faint">
          {formatSigned(change24h)} today
        </span>
      </div>
      <p className="mt-3 text-[13px] leading-relaxed text-ink-dim">
        Global geopolitical tension has {change24h >= 0 ? "increased" : "eased"} over the
        past 24 hours.
      </p>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
        aria-expanded={expanded}
      >
        Why?
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} />
      </button>
      {expanded && (
        <div className="mt-3 space-y-1.5 border-t border-border pt-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">
            Largest current contributors
          </p>
          {topDrivers.map((c) => (
            <div key={c.id} className="flex items-center justify-between text-xs">
              <span className="text-ink-dim">{c.shortName}</span>
              <span className="font-medium text-ink">{c.intensity}</span>
            </div>
          ))}
          <p className="pt-1 text-[11px] text-ink-faint">
            Based on current available indicators. Estimated exposure, not a
            prediction.
          </p>
        </div>
      )}
    </GlassCard>
  );
}
