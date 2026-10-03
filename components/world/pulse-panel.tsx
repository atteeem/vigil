"use client";

import { useState } from "react";
import { MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/utils/format";
import type { PulseBadge, PulseCategory, WorldItem } from "@/lib/world/types";
import { ConfidenceBadge } from "./confidence-badge";
import { CATEGORY_ICON } from "./ticker";

const TABS: { key: "all" | PulseCategory; label: string }[] = [
  { key: "all", label: "All" },
  { key: "conflict", label: "Conflict" },
  { key: "territory", label: "Territory" },
  { key: "hazard", label: "Hazards" },
  { key: "infrastructure", label: "Infrastructure" },
];
const BADGE_TONE: Record<PulseBadge, string> = {
  VERIFIED: "border-stable/40 text-stable",
  "PARTY CLAIM": "border-accent/50 text-accent",
  OFFICIAL: "border-border-strong text-ink",
  UPDATED: "border-border text-ink-dim",
  TERRITORY: "border-border text-ink-dim",
  HAZARD: "border-border text-ink-dim",
};

export function Badge({ children }: { children: PulseBadge }) {
  return (
    <span data-testid="pulse-badge" className={cn("rounded border px-1 py-px text-[9px] font-semibold tracking-wide", BADGE_TONE[children])}>
      {children}
    </span>
  );
}

/** Pulse: the reverse-chronological stream of meaningful developments (brief system), not raw articles.
 * Party claims appear only when the existing Profile setting is on, always badged PARTY CLAIM. */
export function PulsePanel({ items, loading, error, selectedId, hiddenClaims, onSelect }: { items: WorldItem[]; loading: boolean; error: boolean; selectedId: string | null; hiddenClaims: number; onSelect: (i: WorldItem) => void }) {
  const [tab, setTab] = useState<"all" | PulseCategory>("all");
  const shown = tab === "all" ? items : items.filter((i) => i.category === tab);
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="pulse-panel">
      <div className="mb-2 flex flex-wrap gap-1" role="tablist" aria-label="Pulse categories">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)} data-testid={`pulse-tab-${t.key}`} className={cn("rounded-full border px-2.5 py-0.5 text-[11px] font-medium", tab === t.key ? "border-ink bg-ink text-bg" : "border-border text-ink-dim hover:text-ink")}>
            {t.label}
          </button>
        ))}
      </div>
      <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1" data-testid="pulse-list">
        {shown.map((i) => {
          const Icon = CATEGORY_ICON[i.category];
          return (
            <li key={i.id}>
              <button type="button" onClick={() => onSelect(i)} data-testid="pulse-row" data-item-id={i.id} data-category={i.category} aria-current={selectedId === i.id} className={cn("block w-full rounded-lg border px-2.5 py-2 text-left transition-colors", selectedId === i.id ? "border-accent/60 bg-card" : "border-transparent bg-card/50 hover:bg-card")}>
                <div className="flex items-center gap-1.5 text-[10px] text-ink-faint">
                  <Icon className="h-3 w-3" aria-hidden />
                  <span className="uppercase tracking-wide">{i.category}</span>
                  <span aria-hidden>·</span>
                  <span>{timeAgo(i.occurredAt)}</span>
                  <ConfidenceBadge level={i.confidenceLabel} className="ml-auto" />
                </div>
                <p className="mt-1 text-[13px] leading-snug text-ink">{i.headline}</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-faint">
                  {i.place && (
                    <span className="inline-flex items-center gap-0.5">
                      <MapPin className="h-3 w-3" aria-hidden /> {i.place}
                    </span>
                  )}
                  {i.source && <span>{i.source}</span>}
                  {i.badges.map((b) => (
                    <Badge key={b}>{b}</Badge>
                  ))}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
      {shown.length === 0 && (
        <p className="mt-6 text-center text-xs text-ink-faint" data-testid="pulse-empty">
          {loading ? "Loading developments…" : error ? "Live developments are unavailable right now. The map is unaffected." : "No major developments in this window."}
        </p>
      )}
      {hiddenClaims > 0 && (
        <p className="mt-2 text-[10px] text-ink-faint" data-testid="pulse-hidden-claims">
          {hiddenClaims} party claim{hiddenClaims === 1 ? "" : "s"} hidden. Enable them in Profile, Sources.
        </p>
      )}
    </div>
  );
}
