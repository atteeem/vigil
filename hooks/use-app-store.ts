"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { DEFAULT_BASE_COUNTRY } from "@/lib/data/constants";
import type { TimeRange, MapLayer, Region } from "@/lib/types";

export type { TimeRange, MapLayer };

export type GlobeViewMode = "intel" | "satellite";
export type ContentSensitivity = "standard" | "reduced";

export interface GlobeLayerVisibility {
  conflicts: boolean;
  events: boolean;
  borders: boolean;
  labels: boolean;
}

// Conflicts hotspots are the one layer on by default — Events/Borders/
// Labels are genuinely optional extras (and Borders/Labels pull in a real
// Natural Earth vector dataset), so leaving them off keeps first paint fast
// on every device, mobile especially.
const DEFAULT_GLOBE_LAYERS: GlobeLayerVisibility = {
  conflicts: true,
  events: false,
  borders: false,
  labels: false,
};

interface AppState {
  // Session/UI state
  searchOpen: boolean;
  setSearchOpen: (v: boolean) => void;
  layer: MapLayer;
  setLayer: (l: MapLayer) => void;

  // Persisted preferences (see Profile page). These double as both the
  // live current value used throughout the app AND the "default" the
  // Profile page edits — there's no separate account-level default yet
  // since Phase 1 has no auth (see PROJECT.md / TASKS.md).
  baseCountryCode: string;
  setBaseCountryCode: (code: string) => void;
  timeRange: TimeRange;
  setTimeRange: (t: TimeRange) => void;
  timezone: string; // IANA timezone name, or "auto"
  setTimezone: (tz: string) => void;
  preferredRegions: Region[];
  setPreferredRegions: (r: Region[]) => void;
  globeViewMode: GlobeViewMode;
  setGlobeViewMode: (m: GlobeViewMode) => void;
  globeLayers: GlobeLayerVisibility;
  setGlobeLayer: (key: keyof GlobeLayerVisibility, value: boolean) => void;
  contentSensitivity: ContentSensitivity;
  setContentSensitivity: (v: ContentSensitivity) => void;
  theme: "dark";
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      searchOpen: false,
      setSearchOpen: (v) => set({ searchOpen: v }),
      layer: "conflicts",
      setLayer: (l) => set({ layer: l }),

      baseCountryCode: DEFAULT_BASE_COUNTRY,
      setBaseCountryCode: (code) => set({ baseCountryCode: code }),
      timeRange: "24H",
      setTimeRange: (t) => set({ timeRange: t }),
      timezone: "auto",
      setTimezone: (tz) => set({ timezone: tz }),
      preferredRegions: [],
      setPreferredRegions: (r) => set({ preferredRegions: r }),
      globeViewMode: "intel",
      setGlobeViewMode: (m) => set({ globeViewMode: m }),
      globeLayers: DEFAULT_GLOBE_LAYERS,
      setGlobeLayer: (key, value) =>
        set((s) => ({ globeLayers: { ...s.globeLayers, [key]: value } })),
      contentSensitivity: "standard",
      setContentSensitivity: (v) => set({ contentSensitivity: v }),
      theme: "dark",
    }),
    {
      name: "vigil-preferences",
      storage: createJSONStorage(() => localStorage),
      // Only persist the actual preference fields — transient UI state
      // (search-open, the live map-layer segmented control) stays
      // session-only on purpose.
      partialize: (s) => ({
        baseCountryCode: s.baseCountryCode,
        timeRange: s.timeRange,
        timezone: s.timezone,
        preferredRegions: s.preferredRegions,
        globeViewMode: s.globeViewMode,
        globeLayers: s.globeLayers,
        contentSensitivity: s.contentSensitivity,
      }),
      skipHydration: typeof window === "undefined",
    },
  ),
);
