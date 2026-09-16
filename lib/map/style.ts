import type { StyleSpecification } from "maplibre-gl";

/**
 * Dark raster basemap (no proprietary API token required) so the map reads
 * as an intelligence-grade dark surface consistent with the rest of Vigil,
 * rather than a default light web-map style.
 */
export const DARK_MAP_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    "vigil-basemap": {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      ],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors © CARTO",
    },
  },
  layers: [
    // Solid-color base painted underneath the raster tiles. If the tile
    // provider is unreachable (corporate proxy, offline dev sandbox, ad
    // blocker), the map still reads as an intentional dark surface instead
    // of rendering pure black — vector layers (clusters/points/heatmap)
    // never depend on this and always render regardless of tile status.
    {
      id: "vigil-basemap-fallback",
      type: "background",
      paint: {
        "background-color": "#0E1116",
      },
    },
    {
      id: "vigil-basemap-layer",
      type: "raster",
      source: "vigil-basemap",
      paint: {
        "raster-opacity": 0.9,
        "raster-brightness-min": 0,
        "raster-brightness-max": 0.75,
        "raster-fade-duration": 300,
      },
    },
  ],
};
