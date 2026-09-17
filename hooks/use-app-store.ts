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

// Conflicts hotspots, country Borders, and Labels (country + city names)
// are on by default; Events is the one genuinely optional extra (it adds
// per-report markers on top of the conflict hotspots already shown), left
// off to keep first paint fast on every device, mobile especially.
// Borders'/Labels' own datasets are real Natural Earth data plus a small
// curated city list, but both are lazy-imported (ConflictGlobe's effect
// below) — Borders is pre-decimated to a single ~22-point ring per
// country (lib/globe/country-borders.ts), and Labels only ever renders a
// handful of tier-1 entries at the globe's default zoomed-out resting
// altitude (lib/globe/city-labels.ts) — both measured as a bounded
// ~0.5-1s one-time cost, not an ongoing frame cost, so defaulting them on
// doesn't reopen the "keep first paint fast" tradeoff this comment used
// to justify leaving Borders off in an earlier stage. ConflictGlobe skips
// rendering Borders in Satellite mode regardless of this setting, and
// shows fewer/fainter Labels there.
const DEFAULT_GLOBE_LAYERS: GlobeLayerVisibility = {
  conflicts: true,
  events: false,
  borders: true,
  labels: true,
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
      // Bumped when Borders/Labels flipped from off- to on-by-default
      // (globe readability fix): zustand's persist middleware otherwise
      // uses whatever a returning user's browser already saved verbatim,
      // so without this migration their globeLayers would keep silently
      // pinning both to the OLD default forever — "enabled in config" is
      // not the same as "actually visible in a real browser" for anyone
      // who'd loaded this app before this fix shipped.
      version: 1,
      migrate: (persistedState, version) => {
        const state = persistedState as Partial<AppState>;
        if (version < 1 && state.globeLayers) {
          state.globeLayers = { ...state.globeLayers, borders: true, labels: true };
        }
        return state;
      },
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
