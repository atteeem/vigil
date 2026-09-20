"use client";

import { useState } from "react";
import { ChevronDown, Layers } from "lucide-react";
import { HAZARD_LAYER_LABEL, LAYER_GROUPS, type HazardLayer } from "@/lib/hazards/types";
import type { HazardLayerHealth } from "@/lib/hazards/public-types";
import { RelativeTime } from "@/components/ui/relative-time";
import { cn } from "@/lib/utils";

const LAYER_SWATCH: Record<HazardLayer, string> = { earthquakes: "#C77DFF", fires: "#FFB020", weather: "#2EC4B6", volcanoes: "#FF6F91", aviation: "#6EA8FF", maritime: "#22D3EE", energy: "#A3E635", internet: "#F0ABFC" };
const LAYER_HINT: Record<HazardLayer, string> = {
  earthquakes: "USGS seismic network",
  fires: "NASA satellite detections + reported incidents",
  weather: "Official alerts (NWS, GDACS)",
  volcanoes: "Observatory alert levels",
  aviation: "Airport and airspace status (civil)",
  maritime: "Chokepoints, ports, security notices",
  energy: "Grid and gas capacity disruption",
  internet: "Observed connectivity anomalies",
};

/** One compact button that expands into the natural-hazard group. The conflict layers (Events /
 * Heatmap / Territorial Control) keep their own controls in the bar; every hazard layer here is an
 * independent toggle, off by default. */
export function HazardLayerPanel({ enabled, onToggle, health }: { enabled: readonly HazardLayer[]; onToggle: (layer: HazardLayer) => void; health?: readonly HazardLayerHealth[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="w-full sm:relative sm:w-auto" data-testid="hazard-layers">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls="hazard-layer-list"
        data-testid="hazard-layers-button"
        className={cn("flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors", enabled.length ? "border-accent/40 bg-accent-dim text-accent" : "border-border-strong text-ink-dim hover:text-ink")}
      >
        <Layers className="h-3.5 w-3.5" /> Live data layers{enabled.length > 0 && <span className="rounded-full bg-accent/20 px-1.5 text-[10px]" data-testid="hazard-layers-count">{enabled.length}</span>}
        <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div id="hazard-layer-list" className="mt-2 max-h-[36vh] w-full space-y-2 overflow-y-auto rounded-2xl border border-border bg-surface/95 p-2 shadow-xl backdrop-blur-xl sm:absolute sm:right-0 sm:top-full sm:z-20 sm:w-72" data-testid="hazard-layer-list">
          {LAYER_GROUPS.map((group) => (
            <section key={group.id} data-testid={`layer-group-${group.id}`}>
              <h3 className="px-2 pt-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">{group.label}</h3>
              <ul className="space-y-0.5">
                {group.layers.map((layer) => {
                  const on = enabled.includes(layer);
                  const h = health?.find((x) => x.layer === layer);
                  return (
                    <li key={layer}>
                      <label className="flex cursor-pointer items-start gap-2.5 rounded-xl px-2 py-1.5 hover:bg-white/5">
                        <input type="checkbox" checked={on} onChange={() => onToggle(layer)} className="mt-0.5 accent-current" data-testid={`hazard-toggle-${layer}`} aria-label={HAZARD_LAYER_LABEL[layer]} />
                        <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: LAYER_SWATCH[layer] }} aria-hidden />
                        <span className="min-w-0 text-xs">
                          <span className="block font-medium text-ink">{HAZARD_LAYER_LABEL[layer]}</span>
                          <span className="block text-[11px] text-ink-faint">{LAYER_HINT[layer]}</span>
                          {on && h && (
                            <span className={cn("block text-[11px]", h.stale || !h.enabled ? "text-elevated" : "text-ink-faint")} data-testid={`hazard-health-${layer}`}>
                              {!h.enabled ? "Provider disabled" : h.lastSuccessAt ? <RelativeTime iso={h.lastSuccessAt} prefix={h.stale ? "Stale — last update " : "Updated "} /> : "No successful update yet"}
                            </span>
                          )}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
