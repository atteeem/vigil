"use client";

import { useState } from "react";
import Link from "next/link";
import { ListChecks, X } from "lucide-react";
import { useBrief, type BriefParams } from "@/hooks/use-brief";
import type { BriefDevelopment } from "@/lib/brief/types";
import type { TimeRange } from "@/lib/types";
import { cn } from "@/lib/utils";

const WINDOW_OF: Record<TimeRange, string> = { "1H": "1h", "6H": "6h", "24H": "24h", "7D": "7d", "30D": "custom" };

/** "What changed" for /world, in two parts so the page can keep the page chrome compact: a small button (lives in the
 * map command bar) and the brief panel it opens on demand. The brief is for the map's selected time range (and
 * timeline moment). Selecting an item hands it to the map page, which enables the layer, selects the record and
 * centres the same map — there is no second map. */
export function WhatChangedButton({ open, onClick, className }: { open: boolean; onClick: () => void; className?: string }) {
  return (
    <button type="button" onClick={onClick} aria-expanded={open} data-testid="what-changed-button" title="The most material developments in the selected time range" className={cn("inline-flex min-h-[32px] items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors", open ? "border-ink bg-ink text-bg" : "border-border bg-surface/80 text-ink-dim hover:text-ink", className)}>
      <ListChecks className="h-3.5 w-3.5" /> What changed
    </button>
  );
}

export function WhatChangedPanel({ open, onClose, timeRange, asOf, onSelect }: { open: boolean; onClose: () => void; timeRange: TimeRange; asOf: Date | null; onSelect: (d: BriefDevelopment) => void }) {
  const end = asOf ?? new Date();
  const params: BriefParams = WINDOW_OF[timeRange] === "custom" ? { window: "custom", from: new Date(end.getTime() - 30 * 86_400_000).toISOString(), to: end.toISOString(), asOf: asOf?.toISOString() ?? null } : { window: WINDOW_OF[timeRange]!, asOf: asOf?.toISOString() ?? null };
  const { data, status } = useBrief(params, open);
  const items = data ? data.developments.filter((d) => !d.isPartyClaim).slice(0, 8) : [];
  if (!open) return null;
  return (
    <div data-testid="what-changed">
      <div data-testid="what-changed-panel">
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-semibold text-ink" data-testid="what-changed-headline">
            {status === "pending" ? "Loading…" : (data?.headline ?? "The brief could not be loaded")}
          </p>
          <button type="button" onClick={onClose} aria-label="Close" className="text-ink-faint hover:text-ink">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {data && (
          <ul className="mt-2 space-y-1" data-testid="what-changed-items">
            {items.map((d) => (
              <li key={d.id}>
                <button type="button" onClick={() => onSelect(d)} data-testid="what-changed-item" data-dev-id={d.id} className="block w-full rounded-lg px-2 py-1.5 text-left text-xs text-ink hover:bg-card">
                  <span className="mr-1.5 text-[10px] uppercase tracking-wide text-ink-faint">{d.developmentType.replace(/_/g, " ")}</span>
                  {d.title}
                </button>
              </li>
            ))}
            {items.length === 0 && <li className="text-xs text-ink-faint">Nothing material changed in this range.</li>}
          </ul>
        )}
        <Link href={`/brief?window=${WINDOW_OF[timeRange]}`} className="mt-2 inline-block text-[11px] text-accent hover:underline">
          Open the full brief
        </Link>
      </div>
    </div>
  );
}
