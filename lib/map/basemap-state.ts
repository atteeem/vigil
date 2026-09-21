import type { BasemapProviderId } from "./basemap";

// Client-side record of what the map actually did, for the admin diagnostics page. Written by the world map and
// read from localStorage by /admin/basemap (same browser). No secrets: provider ids, hosts and short reasons only.

export interface BasemapClientState {
  at: string;
  mode: string;
  provider: BasemapProviderId;
  fallback: boolean;
  reason: string | null;
  failed: Partial<Record<BasemapProviderId, string>>;
  mapLoaded: boolean;
  glyphs: { local: number; remote: number; failed: number; lastFailure: string | null };
}

export const BASEMAP_STATE_KEY = "vigil.basemap.state";

export function recordBasemapState(state: BasemapClientState): void {
  try {
    (window as unknown as { __vigilBasemap?: BasemapClientState }).__vigilBasemap = state;
    localStorage.setItem(BASEMAP_STATE_KEY, JSON.stringify(state));
  } catch {
    /* storage blocked: diagnostics are best-effort */
  }
}

export function readBasemapState(): BasemapClientState | null {
  try {
    const raw = localStorage.getItem(BASEMAP_STATE_KEY);
    return raw ? (JSON.parse(raw) as BasemapClientState) : null;
  } catch {
    return null;
  }
}
