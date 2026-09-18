"use client";

import { useMemo } from "react";
import { NO_ACTOR_COLOR } from "@/lib/map/territorial-colors";
import type { TerritoryFeatureProperties } from "@/lib/types/territorial-control";

// Spec §3 "the legend should show actual actor names rather than generic
// Party A / Party B" — built from whatever's actually on screen right now
// (the features currently rendered), not a static list of every actor
// that's ever existed, so it never shows an actor with no visible
// territory at the current asOf.
export function TerritoryLegend({ featureCollection }: { featureCollection: GeoJSON.FeatureCollection }) {
  const actors = useMemo(() => {
    const seen = new Map<string, { name: string; color: string }>();
    let hasNoActor = false;
    for (const feature of featureCollection.features) {
      const props = feature.properties as TerritoryFeatureProperties | null;
      if (!props) continue;
      if (props.actorId && props.actorName) {
        if (!seen.has(props.actorId)) seen.set(props.actorId, { name: props.actorName, color: props.actorColor });
      } else {
        hasNoActor = true;
      }
    }
    return { list: Array.from(seen.values()), hasNoActor };
  }, [featureCollection]);

  if (actors.list.length === 0 && !actors.hasNoActor) {
    return <p className="text-xs text-ink-faint">No territorial control data for this view.</p>;
  }

  return (
    <div className="flex flex-col gap-2" data-testid="territory-legend">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {actors.list.map((a) => (
          <span key={a.name} className="flex items-center gap-1.5 text-xs text-ink-dim" data-testid={`territory-legend-actor-${a.name}`}>
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: a.color }} aria-hidden />
            {a.name}
          </span>
        ))}
        {actors.hasNoActor && (
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
          <span
            className="h-2.5 w-2.5 rounded-sm border border-dashed border-white/60 bg-white/10"
            aria-hidden
          />{" "}
          Contested
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-ink-faint">
          <span className="h-2.5 w-2.5 rounded-sm border border-dotted border-white/50 bg-white/5" aria-hidden /> Uncertain
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-ink-faint">
          <span className="h-2.5 w-2.5 rounded-sm border-2 border-[#ffd60a]" aria-hidden /> Recently changed
        </span>
      </div>
    </div>
  );
}
