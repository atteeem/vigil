"use client";

import { useState } from "react";
import { Info } from "lucide-react";
import { HEAT_LEGEND, heatLegendGradient } from "@/lib/heat/scale";
import { cn } from "@/lib/utils";

/** Compact legend for the continuous conflict-intensity surface. Shared by the
 * flat map and the globe. The color means observed conflict intensity, never a
 * forecast — and the low end is "low observed intensity", not "safe". */
export function HeatLegend({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      data-testid="heat-legend"
      className={cn("pointer-events-auto relative w-[210px] rounded-lg border border-border bg-surface/80 px-2.5 py-1.5 backdrop-blur", className)}
    >
      <div className="mb-1 flex items-center justify-between gap-1 text-[9px] font-semibold uppercase leading-tight tracking-wide text-ink-faint">
        <span>{HEAT_LEGEND.low}</span>
        <span>{HEAT_LEGEND.high}</span>
        <button
          type="button"
          data-testid="heat-legend-info"
          aria-label="About the heat colors"
          aria-expanded={open}
          onClick={() => setOpen(true)}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          className="-mr-0.5 text-ink-faint hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Info className="h-3 w-3" aria-hidden />
        </button>
      </div>
      <div data-testid="heat-legend-bar" className="h-1.5 w-full rounded-full" style={{ backgroundImage: heatLegendGradient() }} />
      {open && (
        <p role="tooltip" data-testid="heat-legend-tooltip" className="absolute bottom-full left-0 z-30 mb-1.5 w-56 rounded-lg border border-border bg-surface p-2 text-[11px] normal-case leading-snug tracking-normal text-ink-dim shadow-lg">
          {HEAT_LEGEND.info}
        </p>
      )}
    </div>
  );
}
