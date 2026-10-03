"use client";

import { AlertTriangle, Flame, Globe2, Landmark, Swords } from "lucide-react";
import { timeAgo } from "@/lib/utils/format";
import type { PulseCategory, WorldItem } from "@/lib/world/types";
import { ConfidenceBadge } from "./confidence-badge";

export const CATEGORY_ICON: Record<PulseCategory, typeof Swords> = { conflict: Swords, territory: Globe2, hazard: Flame, infrastructure: Landmark };

/** Thin breaking-intelligence strip. Newest significant developments only (see buildTicker); one pass across
 * the strip, paused on hover/focus, static and scrollable under reduced motion. Selecting an item focuses it. */
export function Ticker({ items, loading, error, onSelect }: { items: WorldItem[]; loading: boolean; error: boolean; onSelect: (i: WorldItem) => void }) {
  return (
    <div className="vigil-ticker flex h-8 shrink-0 items-center overflow-hidden border-b border-border bg-bg/80" data-testid="ticker" role="region" aria-label="Breaking intelligence">
      <span className="z-10 flex h-full shrink-0 items-center gap-1 border-r border-border bg-surface px-3 text-[10px] font-semibold uppercase tracking-wider text-accent">
        <AlertTriangle className="h-3 w-3" /> Breaking
      </span>
      {items.length === 0 ? (
        <span className="px-3 text-xs text-ink-faint" data-testid="ticker-empty">
          {loading ? "Loading developments…" : error ? "Live developments are unavailable right now. The map is unaffected." : "No major developments in this window."}
        </span>
      ) : (
        <div className="vigil-ticker-track flex shrink-0 items-center gap-8 whitespace-nowrap pl-6" data-testid="ticker-track">
          {items.map((i) => {
            const Icon = CATEGORY_ICON[i.category];
            return (
              <button key={i.id} type="button" onClick={() => onSelect(i)} data-testid="ticker-item" data-item-id={i.id} className="inline-flex items-center gap-2 text-xs text-ink hover:text-accent">
                <Icon className="h-3.5 w-3.5 text-ink-faint" aria-hidden />
                <span>{i.headline}</span>
                <span className="text-ink-faint">{timeAgo(i.occurredAt)}</span>
                <ConfidenceBadge level={i.confidenceLabel} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
