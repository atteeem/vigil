"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { GlassCard } from "@/components/ui/card";
import { CountrySelector } from "./country-selector";
import { getCountryByCode } from "@/lib/data";
import { rankConflictsForCountry } from "@/lib/data/priority";
import { useNowMs } from "@/hooks/use-now";
import type { Conflict, ConflictEvent } from "@/lib/types";
import { EmptyState } from "@/components/public/data-states";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function RelevantToYouCard({
  baseCountryCode,
  conflicts,
  events = [],
  onSelectConflict,
  className,
}: {
  baseCountryCode: string;
  conflicts: readonly Conflict[];
  events?: readonly ConflictEvent[];
  onSelectConflict?: (slug: string) => void;
  className?: string;
}) {
  const country = getCountryByCode(baseCountryCode);
  const now = useNowMs(events);
  if (!country) return null;
  const top = rankConflictsForCountry(country, conflicts, events, now, 3);

  return (
    <GlassCard className={cn("w-full max-w-[300px] p-5", className)} data-testid="relevant-to-you-card">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-ink-faint">
          Most Relevant To You
        </p>
      </div>
      <CountrySelector className="mt-2" />

      {top.length === 0 && <EmptyState className="mt-3" title="No conflicts to rank" detail="Nothing tracked affects this country yet." testId="relevant-empty" />}
      <ol className="mt-3 space-y-2.5">
        {top.map(({ conflict, impact }, i) => (
          <li key={conflict.id}>
            <button
              onClick={() => onSelectConflict?.(conflict.slug)}
              className="flex w-full items-center gap-3 rounded-xl px-1.5 py-1 text-left hover:bg-white/5"
              data-testid={`conflict-quick-select-${conflict.slug}`}
            >
              <span className="text-xs font-semibold text-ink-faint">{i + 1}</span>
              <span className="flex-1 truncate text-sm text-ink">{conflict.shortName}</span>
              <span className="text-sm font-semibold tabular-nums text-ink">{impact.score}</span>
            </button>
          </li>
        ))}
      </ol>

      <Link
        href="/for-you"
        className={cn(buttonVariants({ variant: "accent", size: "sm" }), "mt-4 w-full")}
      >
        View your impact
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </GlassCard>
  );
}
