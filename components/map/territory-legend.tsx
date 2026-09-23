"use client";

import { useMemo } from "react";
import { NO_ACTOR_COLOR } from "@/lib/map/territorial-colors";
import type { TerritoryFeatureProperties } from "@/lib/types/territorial-control";

// Spec §3 "the legend should show actual actor names rather than generic Party A / Party B": built from whatever is
// actually on screen right now, so it never shows an actor with no visible territory at the current asOf. CONTROL and
// PRESENCE / INFLUENCE never share visual semantics: control is a filled area with the status keys below; presence is a
// dotted outline and influence a dashed one, each labelled as "not control".
export function TerritoryLegend({ featureCollection }: { featureCollection: GeoJSON.FeatureCollection }) {
  const legend = useMemo(() => {
    const control = new Map<string, { name: string; color: string }>();
    const other = { influence: new Map<string, { name: string; color: string }>(), presence: new Map<string, { name: string; color: string }>() };
    let hasNoActor = false;
    let hasControl = false;
    let hasContested = false;
    let hasUncertainOther = false;
    for (const feature of featureCollection.features) {
      const props = feature.properties as TerritoryFeatureProperties | null;
      if (!props) continue;
      const kind = props.kind ?? "control";
      if (kind === "control") {
        hasControl = true;
        if (props.status === "contested") hasContested = true;
        if (props.actorId && props.actorName) control.set(props.actorId, { name: props.actorName, color: props.actorColor });
        else hasNoActor = true;
      } else {
        if (props.status === "uncertain") hasUncertainOther = true;
        if (props.actorId && props.actorName) other[kind].set(props.actorId, { name: props.actorName, color: props.actorColor });
      }
    }
    return { control: [...control.values()], influence: [...other.influence.values()], presence: [...other.presence.values()], hasNoActor, hasControl, hasContested, hasUncertainOther };
  }, [featureCollection]);

  const nothing = !legend.hasControl && legend.influence.length === 0 && legend.presence.length === 0;
  if (nothing) {
    return (
      <p className="text-xs text-ink-faint" data-testid="territory-empty-state">
        No territorial data is valid for the selected datasets at this time.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2" data-testid="territory-legend">
      {legend.hasControl && (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {legend.control.map((a) => (
              <span key={a.name} className="flex items-center gap-1.5 text-xs text-ink-dim" data-testid={`territory-legend-actor-${a.name}`}>
                <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: a.color }} aria-hidden />
                {a.name}
              </span>
            ))}
            {legend.hasNoActor && (
              <span className="flex items-center gap-1.5 text-xs text-ink-dim">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: NO_ACTOR_COLOR }} aria-hidden />
                No clear actor
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/60 pt-1.5">
            <span className="flex items-center gap-1.5 text-[11px] text-ink-faint">
              <span className="h-2.5 w-2.5 rounded-sm border border-white/40 bg-white/25" aria-hidden /> Controlled
            </span>
            <span className="flex items-center gap-1.5 text-[11px] text-ink-faint">
              <span className="h-2.5 w-2.5 rounded-sm border border-dashed border-white/60 bg-white/10" aria-hidden /> Contested
            </span>
            <span className="flex items-center gap-1.5 text-[11px] text-ink-faint">
              <span className="h-2.5 w-2.5 rounded-sm border border-dotted border-white/50 bg-white/5" aria-hidden /> Uncertain
            </span>
            <span className="flex items-center gap-1.5 text-[11px] text-ink-faint">
              <span className="h-2.5 w-2.5 rounded-sm border-2 border-[#ffd60a]" aria-hidden /> Recently changed
            </span>
          </div>
        </>
      )}
      {(legend.influence.length > 0 || legend.presence.length > 0) && (
        <div className={`flex flex-col gap-1 ${legend.hasControl ? "border-t border-border/60 pt-1.5" : ""}`} data-testid="territory-legend-presence">
          {legend.influence.length > 0 && (
            <span className="flex flex-wrap items-center gap-x-2 text-[11px] text-ink-dim" data-testid="territory-legend-influence">
              <span className="h-2.5 w-4 rounded-sm border border-dashed border-white/70 bg-white/10" aria-hidden /> Strong reported influence ({legend.influence.map((a) => a.name).join(", ")}) — not control
            </span>
          )}
          {legend.presence.length > 0 && (
            <span className="flex flex-wrap items-center gap-x-2 text-[11px] text-ink-dim" data-testid="territory-legend-presence-row">
              <span className="h-2.5 w-4 rounded-sm border-2 border-dotted border-white/70" aria-hidden /> Reported presence ({legend.presence.map((a) => a.name).join(", ")}) — not control
            </span>
          )}
          {legend.hasUncertainOther && <span className="text-[11px] text-ink-faint">Uncertain: the source is unsure of the extent.</span>}
        </div>
      )}
    </div>
  );
}
