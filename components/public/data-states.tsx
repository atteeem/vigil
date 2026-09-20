"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { RelativeTime } from "@/components/ui/relative-time";

/** Honest states for missing data. Nothing here ever shows a placeholder value
 * as though it were real — an absent value is said to be absent. */

export function EmptyState({ title, detail, className, testId }: { title: string; detail?: string; className?: string; testId?: string }) {
  return (
    <div data-testid={testId} className={cn("rounded-xl border border-dashed border-border px-4 py-5 text-center", className)}>
      <p className="text-sm font-medium text-ink-dim">{title}</p>
      {detail && <p className="mt-1 text-xs text-ink-faint">{detail}</p>}
    </div>
  );
}

export function LoadingLine({ label = "Loading…", className }: { label?: string; className?: string }) {
  return (
    <p role="status" aria-live="polite" data-testid="loading-state" className={cn("text-xs text-ink-faint", className)}>
      {label}
    </p>
  );
}

/** "Last event 3h ago" with a stale marker when older than `staleAfterHours`. The page loading
 * recently is never presented as the data being current. */
export function FreshnessStamp({ label, iso, staleAfterHours, none = "none recorded", className }: { label: string; iso: string | null | undefined; staleAfterHours?: number; none?: string; className?: string }) {
  // The stale flag needs the real clock, which only exists after mount (SSR renders it unflagged).
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(Date.now());
  }, []);
  const stale = iso && staleAfterHours && now !== null ? now - new Date(iso).getTime() > staleAfterHours * 3_600_000 : false;
  return (
    <span className={cn("text-xs text-ink-faint", className)} data-testid={`freshness-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      {label}: {iso ? <RelativeTime iso={iso} /> : none}
      {stale && (
        <span className="ml-1.5 rounded-full border border-elevated/40 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-elevated" data-testid="stale-indicator">
          stale
        </span>
      )}
    </span>
  );
}
