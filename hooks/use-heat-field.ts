"use client";

import { useMemo } from "react";
import type { Conflict, ConflictEvent } from "@/lib/types";
import { computeHeatField, type HeatField } from "@/lib/heat/field";
import { buildHeatInput } from "@/lib/heat/inputs";

/** The single entry point the flat map and the globe both use to get the
 * intensity field, so they can never disagree about what is hot. `nowIso` is
 * the timeline's asOf (or the app's live reference time); ages are quantized to
 * whole hours inside buildHeatInput so playback ticks within an hour reuse the
 * cached field instead of recomputing it. Disabled callers pay nothing. */
export function useHeatField(args: { enabled: boolean; conflicts?: readonly Conflict[]; events: readonly ConflictEvent[]; nowIso: string; live?: boolean }): HeatField | null {
  const { enabled, conflicts, events, nowIso, live } = args;
  return useMemo(() => (enabled ? computeHeatField(buildHeatInput({ conflicts, events, nowIso, live })) : null), [enabled, conflicts, events, nowIso, live]);
}
