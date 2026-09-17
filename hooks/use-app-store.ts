"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { DEFAULT_BASE_COUNTRY } from "@/lib/data/constants";
import type { TimeRange, MapLayer, Region } from "@/lib/types";
import type { MapBasemapMode } from "@/lib/map/style";
import type { AccountProfile } from "@/lib/auth/types";

export type { TimeRange, MapLayer };
export type { MapBasemapMode };

export type GlobeViewMode = "intel" | "satellite";
export type ContentSensitivity = "standard" | "reduced";

export interface GlobeLayerVisibility {
  conflicts: boolean;
  events: boolean;
  borders: boolean;
  labels: boolean;
}

// Conflicts hotspots and country Borders are on by default; Events/Labels
// are genuinely optional extras (Events adds per-report markers on top of
// the conflict hotspots already shown, and Labels is the visually busiest
// layer), left off to keep first paint fast on every device, mobile
// especially. Borders' own dataset is real Natural Earth data, but it's
// lazy-imported (ConflictGlobe's effect below) and pre-decimated to a
// single ~22-point ring per country (lib/globe/country-borders.ts) —
// measured as a bounded ~0.5-1s one-time cost, not an ongoing frame cost,
// so defaulting it on doesn't reopen the "keep first paint fast" tradeoff
// this comment used to justify leaving it off. ConflictGlobe also skips
// rendering it in Satellite mode regardless of this setting.
const DEFAULT_GLOBE_LAYERS: GlobeLayerVisibility = {
  conflicts: true,
  events: false,
  borders: true,
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
  mapBasemapMode: MapBasemapMode;
  setMapBasemapMode: (m: MapBasemapMode) => void;
  contentSensitivity: ContentSensitivity;
  setContentSensitivity: (v: ContentSensitivity) => void;
  theme: "dark";

  // Reactive mirror of lib/auth/local-auth-provider.ts's own localStorage
  // session — NOT persisted by this store itself (see partialize below),
  // so there's exactly one source of truth for "who's signed in." Populated
  // on mount via hooks/use-auth-session.ts.
  account: AccountProfile | null;
  setAccount: (a: AccountProfile | null) => void;
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
      mapBasemapMode: "intel",
      setMapBasemapMode: (m) => set({ mapBasemapMode: m }),
      contentSensitivity: "standard",
      setContentSensitivity: (v) => set({ contentSensitivity: v }),
      theme: "dark",

      account: null,
      setAccount: (a) => set({ account: a }),
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
        mapBasemapMode: s.mapBasemapMode,
        contentSensitivity: s.contentSensitivity,
      }),
      skipHydration: typeof window === "undefined",
    },
  ),
);
