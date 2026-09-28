"use client";

import { useQuery } from "@tanstack/react-query";
import { useAppStore } from "@/hooks/use-app-store";
import type { CommandCenter } from "@/lib/world/types";

/** The one aggregated read behind /world's status bar, ticker, Pulse and right rail: a single poll
 * (paused by TanStack Query while the tab is hidden), never one timer per module. Party claims are requested
 * only when the user's existing Profile setting is on.
 *
 * `asOf`: pass the Global Timeline's historical timestamp to reconstruct the brief-derived sections as of
 * that moment (Pre-Launch Critical Correctness & Security v1 §6) — omit/null for Live. Included in the
 * query key (not just the fetch URL) so switching between Live and a historical moment — or between two
 * different historical moments — never serves one's cached response for the other; polling is also
 * disabled while historical, since there is no reason to re-fetch a fixed historical instant every 60s. */
export function useCommandCenter(asOf?: Date | null) {
  const claims = useAppStore((s) => s.showPartyClaims);
  const asOfIso = asOf ? asOf.toISOString() : null;
  return useQuery<CommandCenter>({
    queryKey: ["command-center", claims, asOfIso],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (claims) params.set("claims", "1");
      if (asOfIso) params.set("at", asOfIso);
      const qs = params.toString();
      const res = await fetch(`/api/world/command-center${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw new Error(`Command center request failed (${res.status})`);
      return (await res.json()) as CommandCenter;
    },
    staleTime: 30_000,
    refetchInterval: asOfIso ? false : 60_000,
  });
}
