"use client";

import { useQuery } from "@tanstack/react-query";
import { useAppStore } from "@/hooks/use-app-store";
import type { CommandCenter } from "@/lib/world/types";

/** The one aggregated read behind /world's status bar, ticker, Pulse and right rail: a single poll
 * (paused by TanStack Query while the tab is hidden), never one timer per module. Party claims are requested
 * only when the user's existing Profile setting is on. */
export function useCommandCenter() {
  const claims = useAppStore((s) => s.showPartyClaims);
  return useQuery<CommandCenter>({
    queryKey: ["command-center", claims],
    queryFn: async () => {
      const res = await fetch(`/api/world/command-center${claims ? "?claims=1" : ""}`);
      if (!res.ok) throw new Error(`Command center request failed (${res.status})`);
      return (await res.json()) as CommandCenter;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
