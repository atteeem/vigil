"use client";

import { useQuery } from "@tanstack/react-query";
import type { PublicTerritorialDataset } from "@/lib/territory/dataset-types";

/** Which territorial datasets can be shown (metadata only, no geometry): cheap, cached for a few minutes. */
export function useTerritorialDatasets() {
  return useQuery<PublicTerritorialDataset[]>({
    queryKey: ["territorial-datasets"],
    queryFn: async () => {
      const res = await fetch("/api/territorial-control/datasets");
      if (!res.ok) throw new Error(`Territorial datasets request failed (${res.status})`);
      return ((await res.json()) as { datasets: PublicTerritorialDataset[] }).datasets;
    },
    staleTime: 300_000,
  });
}
