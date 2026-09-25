"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import type { ConflictReportCounts, CountWindow } from "@/lib/public/report-counts";

/** The canonical per-conflict unique-report counts (GET /api/report-counts) for the displayed state. Both the flat
 * map's and the globe's conflict markers read this, never a count of their own bounded event slice. `dataVersion`
 * (e.g. the live feed's length/signature) refetches when new reports are published. */
export function useConflictReportCounts(args: { window: CountWindow; asOf?: Date | null; eventType?: string | null; region?: string | null; dataVersion?: string | number }) {
  const { window, asOf, eventType, region, dataVersion } = args;
  const at = asOf ? asOf.toISOString() : null;
  return useQuery<ConflictReportCounts>({
    queryKey: ["report-counts", window, at, eventType ?? null, region ?? null, dataVersion ?? null],
    queryFn: async ({ signal }) => {
      const p = new URLSearchParams({ window });
      if (at) p.set("at", at);
      if (eventType) p.set("type", eventType);
      if (region) p.set("region", region);
      const res = await fetch(`/api/report-counts?${p}`, { signal });
      if (!res.ok) throw new Error(`report counts ${res.status}`);
      return res.json();
    },
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}
