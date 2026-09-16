"use client";

import { useState } from "react";
import { Layers, Satellite, Radar } from "lucide-react";
import { useAppStore, type GlobeLayerVisibility } from "@/hooks/use-app-store";
import { cn } from "@/lib/utils";

const LAYER_ITEMS: { key: keyof GlobeLayerVisibility; label: string }[] = [
  { key: "conflicts", label: "Conflicts" },
  { key: "events", label: "Events" },
  { key: "borders", label: "Borders" },
  { key: "labels", label: "Labels" },
];

/**
 * Compact Intel/Satellite switch + a small Layers popover, meant to sit
 * directly in the homepage globe's overlay chrome without competing for
 * space with the time-range / arc-layer controls already there.
 */
export function GlobeControls({ className }: { className?: string }) {
  const viewMode = useAppStore((s) => s.globeViewMode);
  const setViewMode = useAppStore((s) => s.setGlobeViewMode);
  const globeLayers = useAppStore((s) => s.globeLayers);
  const setGlobeLayer = useAppStore((s) => s.setGlobeLayer);
  const [layersOpen, setLayersOpen] = useState(false);

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <div
        role="radiogroup"
        aria-label="Globe view"
        className="inline-flex items-center gap-0.5 rounded-full border border-border bg-surface/70 p-0.5 backdrop-blur"
      >
        <button
          role="radio"
          aria-checked={viewMode === "intel"}
          onClick={() => setViewMode("intel")}
          className={cn(
            "flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
            viewMode === "intel" ? "bg-ink text-bg" : "text-ink-dim hover:text-ink",
          )}
        >
          <Radar className="h-3 w-3" aria-hidden />
          Intel
        </button>
        <button
          role="radio"
          aria-checked={viewMode === "satellite"}
          onClick={() => setViewMode("satellite")}
          className={cn(
            "flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
            viewMode === "satellite" ? "bg-ink text-bg" : "text-ink-dim hover:text-ink",
          )}
        >
          <Satellite className="h-3 w-3" aria-hidden />
          Satellite
        </button>
      </div>

      <div className="relative">
        <button
          onClick={() => setLayersOpen((v) => !v)}
          aria-haspopup="true"
          aria-expanded={layersOpen}
          aria-label="Globe layers"
          className={cn(
            "flex h-[26px] w-[26px] items-center justify-center rounded-full border border-border bg-surface/70 text-ink-dim backdrop-blur transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
            layersOpen && "text-ink",
          )}
        >
          <Layers className="h-3.5 w-3.5" />
        </button>
        {layersOpen && (
          <div className="glass-card absolute right-0 top-8 z-30 w-40 rounded-xl border border-border p-2">
            <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
              Layers
            </p>
            {LAYER_ITEMS.map((item) => (
              <label
                key={item.key}
                className="flex items-center gap-2 rounded-lg px-1.5 py-1.5 text-xs text-ink-dim hover:bg-white/5"
              >
                <input
                  type="checkbox"
                  checked={globeLayers[item.key]}
                  onChange={(e) => setGlobeLayer(item.key, e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-border-strong accent-accent"
                />
                {item.label}
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
