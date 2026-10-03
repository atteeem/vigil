import type { LayerSpecification, StyleSpecification } from "maplibre-gl";
import { feature } from "topojson-client";
import type { Feature, FeatureCollection, MultiPolygon, Point, Polygon } from "geojson";
import { layers as protomapsLayers, DARK, LIGHT, type Flavor } from "@protomaps/basemaps";
import { landObject, worldTopology } from "@/lib/globe/world-topology";
import { getHeatBorders } from "@/lib/heat/borders";
import { COUNTRY_RECORDS } from "@/lib/countries/registry";
import { cutFeatureCollection } from "./antimeridian";

// Vigil's own basemap styles. Two builders, one visual language (a dark, quiet intelligence map):
//  - buildPmtilesStyle: the Protomaps basemap schema served from a PMTiles archive (roads, places, boundaries...).
//  - buildBundledStyle: no network for geometry at all — land, coastline, borders and country names from the SAME
//    Natural Earth topology the globe and the heat map already use, so land and borders line up by construction.
// Every basemap layer id is prefixed `bm-` and tagged with metadata `vigil:role`, so map code can find them
// (e.g. hide basemap borders while the heat mode draws its own) without knowing which provider is active.

export const PMTILES_SOURCE_ID = "protomaps";
export const BASEMAP_LAYER_PREFIX = "bm-";
export type BasemapRole = "basemap-border" | "basemap-label" | "basemap-fill";

const role = (r: BasemapRole) => ({ "vigil:role": r });
/** Metadata flag on the bundled coastline: heat mode draws the same coastline itself (heat-borders), so the basemap's
 * copy steps aside there and no coast is ever stroked twice. */
export const HEAT_DRAWS_COAST = "vigil:heat-draws-this";

/** A restrained dark flavor: subtle land, near-black water, neutral borders, quiet labels. */
export const VIGIL_INTEL_FLAVOR: Flavor = {
  ...DARK,
  background: "#080b10",
  earth: "#141a22",
  water: "#090d13",
  boundaries: "#566178",
  country_label: "#97a1b3",
  city_label: "#a9b1bf",
  city_label_halo: "#0b0f14",
  subplace_label: "#7f8998",
  subplace_label_halo: "#0b0f14",
  state_label: "#5f6a7c",
  state_label_halo: "#0b0f14",
  ocean_label: "#3b4656",
  roads_label_major: "#77808f",
  roads_label_minor: "#5f6875",
  major: "#28313d",
  highway: "#323d4b",
  minor_a: "#1d242e",
  minor_b: "#1d242e",
  other: "#1a2029",
  railway: "#222a34",
  buildings: "#181f28",
};

const STREET_FLAVOR: Flavor = { ...LIGHT };

const LOW_ZOOM_ROAD_MIN: Record<string, number> = { highway: 6, major: 7 };

/** Vigil adjustments applied to the vendor layer list (kept declarative and idempotent). */
function tune(list: LayerSpecification[], variant: "intel" | "street"): LayerSpecification[] {
  const out: LayerSpecification[] = [];
  for (const raw of list) {
    const l = JSON.parse(JSON.stringify(raw)) as LayerSpecification & { minzoom?: number; metadata?: Record<string, unknown> };
    const id = l.id;
    if (variant === "intel") {
      // Quiet by design: no POIs, buildings or address labels; roads only when zoomed in.
      if (id === "pois" || id === "buildings" || id === "address_label" || id === "roads_shields" || id === "roads_oneway") continue;
      if (id.startsWith("roads_")) {
        const kind = id.includes("highway") ? "highway" : id.includes("major") ? "major" : "other";
        l.minzoom = Math.max(l.minzoom ?? 0, LOW_ZOOM_ROAD_MIN[kind] ?? (id.includes("labels") || id.includes("rail") || id.includes("runway") || id.includes("taxiway") || id.includes("pier") ? 12 : 10));
      }
      // Label hierarchy: countries at world zoom, regional/city names progressively, small places only close in.
      if (id === "places_locality") l.minzoom = 3.5;
      if (id === "places_subplace") l.minzoom = 11;
      if (id === "places_region") l.minzoom = 5;
      if (id === "water_waterway_label" || id === "water_label_lakes") l.minzoom = 9;
    }
    l.id = `${BASEMAP_LAYER_PREFIX}${id}`;
    if (l.type === "line" && (id === "boundaries_country" || id === "boundaries")) {
      l.metadata = { ...(l.metadata ?? {}), ...role("basemap-border") };
    } else if (l.type === "symbol") {
      l.metadata = { ...(l.metadata ?? {}), ...role("basemap-label") };
    } else {
      l.metadata = { ...(l.metadata ?? {}), ...role("basemap-fill") };
    }
    out.push(l);
  }
  return out;
}

/** Style for a Protomaps-schema PMTiles archive. `url` may be https://..., or a same-origin path. */
export function buildPmtilesStyle(variant: "intel" | "street", url: string, glyphs: string): StyleSpecification {
  const flavor = variant === "intel" ? VIGIL_INTEL_FLAVOR : STREET_FLAVOR;
  return {
    version: 8,
    name: variant === "intel" ? "Vigil Intel" : "Vigil Street",
    glyphs,
    sources: { [PMTILES_SOURCE_ID]: { type: "vector", url: `pmtiles://${url}`, attribution: '<a href="https://protomaps.com">Protomaps</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' } },
    layers: tune(protomapsLayers(PMTILES_SOURCE_ID, flavor, { lang: "en" }), variant),
  };
}

// ---- bundled geography ----------------------------------------------------------------------------------

let bundledCache: { land: Feature<Polygon | MultiPolygon> | FeatureCollection<Polygon | MultiPolygon>; countries: FeatureCollection<Point, { name: string; code: string; rank: number }> } | null = null;

/** Land polygons, and one label point per country (rank = the registry's suggested zoom: big countries label first). */
function bundledData() {
  if (bundledCache) return bundledCache;
  // The topology stores its antimeridian cut as a 360-degree step; planar GeoJSON must be cut for real (see antimeridian.ts).
  const land = cutFeatureCollection(feature(worldTopology, landObject) as unknown as FeatureCollection<Polygon | MultiPolygon>) as FeatureCollection<Polygon | MultiPolygon>;
  const countries: FeatureCollection<Point, { name: string; code: string; rank: number }> = {
    type: "FeatureCollection",
    features: COUNTRY_RECORDS.map((c) => ({ type: "Feature" as const, properties: { name: c.name, code: c.code, rank: c.zoom }, geometry: { type: "Point" as const, coordinates: [c.lng, c.lat] } })),
  };
  bundledCache = { land, countries };
  return bundledCache;
}

/** Key-less geography from the shared Natural Earth topology: no network for geometry, no key, no archive. */
export function buildBundledStyle(glyphs: string): StyleSpecification {
  const { land, countries } = bundledData();
  const borders = getHeatBorders(); // interior country arcs (drawn once) + coastline, from the same arcs as the land
  return {
    version: 8,
    name: "Vigil bundled geography",
    glyphs,
    sources: {
      "vigil-land": { type: "geojson", data: land as unknown as GeoJSON.FeatureCollection },
      "vigil-borders": { type: "geojson", data: borders },
      "vigil-country-labels": { type: "geojson", data: countries },
    },
    layers: [
      { id: `${BASEMAP_LAYER_PREFIX}ocean`, type: "background", paint: { "background-color": VIGIL_INTEL_FLAVOR.water }, metadata: role("basemap-fill") },
      { id: `${BASEMAP_LAYER_PREFIX}land`, type: "fill", source: "vigil-land", paint: { "fill-color": VIGIL_INTEL_FLAVOR.earth }, metadata: role("basemap-fill") },
      { id: `${BASEMAP_LAYER_PREFIX}coast`, type: "line", source: "vigil-borders", filter: ["==", ["get", "kind"], "coast"], paint: { "line-color": "#4b586b", "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.5, 6, 1] }, metadata: { ...role("basemap-fill"), [HEAT_DRAWS_COAST]: true } },
      { id: `${BASEMAP_LAYER_PREFIX}boundaries_country`, type: "line", source: "vigil-borders", filter: ["==", ["get", "kind"], "border"], paint: { "line-color": VIGIL_INTEL_FLAVOR.boundaries, "line-opacity": 0.75, "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.4, 5, 0.8, 9, 1.2] }, metadata: role("basemap-border") },
      {
        id: `${BASEMAP_LAYER_PREFIX}places_country`,
        type: "symbol",
        source: "vigil-country-labels",
        layout: {
          "text-field": ["get", "name"],
          "text-font": ["Noto Sans Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 1, 8, 4, 11, 8, 15],
          "symbol-sort-key": ["get", "rank"],
          "text-max-width": 7,
          "text-padding": 4,
          "text-transform": "uppercase",
          "text-letter-spacing": 0.08,
        },
        paint: { "text-color": VIGIL_INTEL_FLAVOR.country_label, "text-halo-color": "#080b10", "text-halo-width": 1.2, "text-opacity": ["interpolate", ["linear"], ["zoom"], 1, 0.85, 9, 0.5] },
        metadata: role("basemap-label"),
      },
    ],
  };
}
