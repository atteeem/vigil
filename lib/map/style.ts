import type { StyleSpecification } from "maplibre-gl";

export const MAP_BASEMAP_MODES = ["intel", "street", "satellite"] as const;
export type MapBasemapMode = (typeof MAP_BASEMAP_MODES)[number];

export const MAP_BASEMAP_MODE_LABEL: Record<MapBasemapMode, string> = {
  intel: "Intel",
  street: "Street",
  satellite: "Satellite",
};

/**
 * No-key fallback: a solid dark background only. CARTO's free anonymous
 * `dark_all` raster tiles (used here previously) now require an API key of
 * their own — without one they render visible "API KEY REQUIRED" watermark
 * tiles, which is worse than no basemap at all. Event markers/clusters
 * never depend on this layer and always render regardless.
 */
/** Glyph (font) PBFs for text layers. The key-less fallback style needs its own: without a `glyphs` URL every
 * symbol layer with text (cluster counts, hotspot labels) silently draws nothing. The default is the Protomaps
 * `basemaps-assets` host (Noto Sans, OFL); self-host the fonts and set NEXT_PUBLIC_GLYPHS_URL to move off it. */
export const DEFAULT_GLYPHS_URL = "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf";
export function getGlyphsUrl(): string {
  const custom = process.env.NEXT_PUBLIC_GLYPHS_URL;
  return custom && custom.includes("{fontstack}") && custom.includes("{range}") ? custom : DEFAULT_GLYPHS_URL;
}

export const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  glyphs: getGlyphsUrl(),
  sources: {},
  layers: [
    {
      id: "vigil-basemap-fallback",
      type: "background",
      paint: {
        "background-color": "#0E1116",
      },
    },
  ],
};

// MapTiler-hosted style IDs per Vigil map mode. See Decisions.md in the
// Obsidian vault (D:\GLOBAL CONFLICT CLAUDE\Decisions.md) — MapTiler is the
// approved basemap provider for the map upgrade (supersedes the CARTO-only
// approach TASKS.md originally documented).
const MAPTILER_STYLE_ID: Record<MapBasemapMode, string> = {
  // Dark vector style — reads as the existing Vigil "Intel" aesthetic
  // (dark ground, muted labels) while giving real per-zoom label hierarchy
  // and street/building detail instead of a fixed-detail raster tile.
  intel: "dataviz-dark",
  street: "streets-v2",
  // "hybrid" = satellite imagery + labels/borders/major roads, as opposed
  // to MapTiler's bare "satellite" style which has no labels at all.
  satellite: "hybrid",
};

/**
 * Resolves the MapLibre style for a given Vigil map mode. Returns a MapTiler
 * style URL when an API key is configured; otherwise falls back to the
 * offline-safe dark style for every mode (Street/Satellite just won't look
 * distinct from Intel until a key is added — never a broken/blank map).
 */
export function getMapStyle(mode: MapBasemapMode, apiKey: string | undefined): StyleSpecification | string {
  if (!apiKey) return FALLBACK_STYLE;
  return `https://api.maptiler.com/maps/${MAPTILER_STYLE_ID[mode]}/style.json?key=${apiKey}`;
}

export function getMapTilerKey(): string | undefined {
  const key = process.env.NEXT_PUBLIC_MAPTILER_KEY;
  return key && key.length > 0 ? key : undefined;
}
