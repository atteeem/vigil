import type { StyleSpecification } from "maplibre-gl";

export const MAP_BASEMAP_MODES = ["intel", "street", "satellite"] as const;
export type MapBasemapMode = (typeof MAP_BASEMAP_MODES)[number];

export const MAP_BASEMAP_MODE_LABEL: Record<MapBasemapMode, string> = {
  intel: "Intel",
  street: "Street",
  satellite: "Satellite",
};

/**
 * The MINIMAL style (last resort in the fallback chain): a solid dark background only. The bundled geography
 * (lib/map/vigil-style.ts) sits above this in the chain and is what a key-less install normally shows.
 * Event markers/clusters never depend on the basemap and always render regardless.
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

// Provider selection, PMTiles, MapTiler and the fallback order live in lib/map/basemap.ts (the one basemap
// authority). This module only holds the shared mode vocabulary, the minimal style and glyph configuration.
