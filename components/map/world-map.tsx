"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Map as MapLibreMap,
  NavigationControl,
  config as maplibreConfig,
  type GeoJSONSource,
  type ImageSource,
  type MapLayerMouseEvent,
  type ExpressionSpecification,
  type DataDrivenPropertyValueSpecification,
} from "maplibre-gl";
import type { Conflict, ConflictEvent } from "@/lib/types";
import { EVENT_TYPES } from "@/lib/types";
import type { MapBasemapMode } from "@/lib/map/style";
import { readBasemapConfig, resolveBasemap, safeReason, type BasemapProviderId, type BasemapResolution } from "@/lib/map/basemap";
import { probeArchive } from "@/lib/map/pmtiles-protocol";
import { glyphStats } from "@/lib/map/glyph-protocol";
import { registerBasemapProtocols } from "@/lib/map/register-protocols";
import { recordBasemapState } from "@/lib/map/basemap-state";
import { eventsToGeoJSON, type EventFeatureProps } from "@/lib/map/events-to-geojson";
import { useHeatField } from "@/hooks/use-heat-field";
import { renderHeatCanvas, MERCATOR_MAX_LAT } from "@/lib/heat/render";
import { getHeatBorders } from "@/lib/heat/borders";
import { HeatLegend } from "@/components/heat/heat-legend";
import { useAppStore } from "@/hooks/use-app-store";
import { aggregateReportBuckets, formatReportCount, REPORT_COUNT_CAP } from "@/lib/map/report-counts";
import { createEventIconImageData } from "@/lib/map/event-icons";
import { createContestedPatternImageData } from "@/lib/map/territorial-pattern";
import { SEVERITY_HEX } from "@/lib/utils/severity";
import type { TerritoryFeatureProperties } from "@/lib/types/territorial-control";
import type { HazardCollection, HazardFeatureProps } from "@/lib/hazards/public-types";
import type { HazardLayer } from "@/lib/hazards/types";
import { createHazardIconImageData, HAZARD_ICON_IDS } from "@/lib/map/hazard-icons";
import { EMPTY_HAZARD_SOURCES, hazardsToSources, type HazardSourceData } from "@/lib/map/hazards-to-geojson";
import type { HazardViewport } from "@/hooks/use-hazards";
import type { MarkerConflict } from "@/lib/world/types";
import { buildEventMarkers } from "@/lib/map/intelligence-markers";

// Simplified colored-dot markers ("medium zoom") give way to full
// category icons ("high zoom") at this threshold — see Map Requirements.md
// in the Obsidian vault for the intended zoom hierarchy.
const ICON_DETAIL_ZOOM = 11;

const SEVERITY_COLOR_MATCH: DataDrivenPropertyValueSpecification<string> = [
  "match",
  ["get", "severity"],
  "stable",
  SEVERITY_HEX.stable,
  "guarded",
  SEVERITY_HEX.guarded,
  "elevated",
  SEVERITY_HEX.elevated,
  "high",
  SEVERITY_HEX.high,
  "severe",
  SEVERITY_HEX.severe,
  "extreme",
  SEVERITY_HEX.extreme,
  "#8D96A5",
];

function registerEventIcons(map: MapLibreMap) {
  for (const type of EVENT_TYPES) {
    const id = `event-icon-${type}`;
    if (map.hasImage(id)) continue;
    map.addImage(id, createEventIconImageData(type), { sdf: true });
  }
}

// MapLibre GL loads its GeoJSON/vector-tile processing in a dedicated
// module Worker, whose script URL it derives from `import.meta.url` at
// runtime. That derivation assumes a plain http(s) module URL, which
// Turbopack's dev/prod bundling does not provide for a dependency's
// internal worker file — the resulting worker request silently resolves
// to the current page instead, so the worker never loads and source data
// (clusters, points, the heatmap) never renders even though the map
// canvas itself appears fine. We ship the two files the worker needs
// (copied from maplibre-gl/dist) under /public and point MapLibre at them
// directly, which sidesteps the runtime URL derivation entirely.
if (typeof window !== "undefined") {
  maplibreConfig.WORKER_URL = "/maplibre-gl-worker.mjs";
}

export interface WorldMapProps {
  events: ConflictEvent[];
  viewMode: "markers" | "heatmap";
  /** Curated conflicts feeding the heat surface's sustained base. Omit in
   * historical mode (the surface then derives bases from `events` alone). */
  conflicts?: readonly Conflict[];
  /** Reference time for the heat surface: the timeline's asOf, else the app's live "now". */
  nowIso?: string;
  /** True for the live view (see HeatInputArgs.live); false while a historical asOf is active. */
  live?: boolean;
  basemapMode: MapBasemapMode;
  onSelectEvent: (event: ConflictEvent) => void;
  // Territorial Control Mode (spec §1 "keep these layers architecturally
  // independent" — a standalone toggle, not a third value squeezed into
  // `viewMode`, so it composes with either markers or heatmap: heatmap ON
  // + territorial ON is exactly spec's "Both"). Optional — callers that
  // don't need territorial polygons (e.g. the per-conflict detail map)
  // simply omit them and the layers stay empty/hidden.
  territorialFeatures?: GeoJSON.FeatureCollection;
  showTerritorial?: boolean;
  onSelectTerritory?: (properties: TerritoryFeatureProperties) => void;
  // Natural-hazard layers (earthquakes, fires, weather, volcanoes): structured sensor/official data
  // drawn with their own visual language, independent of the conflict layers above. Optional, so the
  // per-conflict detail map is unaffected.
  hazards?: HazardCollection | null;
  /** Centre the map here once (notification deep links). */
  focus?: { lat: number; lng: number; zoom: number; animate?: boolean } | null;
  /** True while Live View is paused: an in-flight camera move stops where it is. */
  holdCamera?: boolean;
  /** Situation-level markers for active conflicts (name, severity, recent-development ring). One per conflict. */
  activeConflicts?: readonly MarkerConflict[];
  onSelectConflict?: (slug: string) => void;
  hazardLayers?: readonly HazardLayer[];
  onSelectHazard?: (id: string) => void;
  onViewportChange?: (viewport: HazardViewport) => void;
  className?: string;
}

const EMPTY_FEATURE_COLLECTION: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

// Territorial Control Mode — status is encoded on more than color alone
// (spec §3): fill-opacity AND outline dash pattern both vary by status,
// plus a dedicated hatch overlay for "contested" and a bright highlight
// outline for "recently_changed", so the distinction survives even for a
// colorblind viewer or an actor-less (uncertain) polygon with no actor
// color to lean on.
// What the source supports drives the look, and control is never confused with presence or influence: CONTROL is a
// filled area, INFLUENCE a faint wash with a dashed edge, PRESENCE no fill at all, only a dotted edge.
const TERRITORY_KIND = ["coalesce", ["get", "kind"], "control"] as const;
const TERRITORY_FILL_OPACITY: DataDrivenPropertyValueSpecification<number> = [
  "case",
  ["==", TERRITORY_KIND as unknown as ExpressionSpecification, "presence"],
  0,
  ["==", TERRITORY_KIND as unknown as ExpressionSpecification, "influence"],
  0.1,
  [
    "match",
    ["get", "status"],
    "controlled",
    0.35,
    "contested",
    0.22,
    "uncertain",
    0.12,
    "recently_changed",
    0.35,
    0.2,
  ],
];
const TERRITORY_OUTLINE_WIDTH: DataDrivenPropertyValueSpecification<number> = [
  "match",
  ["get", "status"],
  "recently_changed",
  3,
  "uncertain",
  1.25,
  2,
];
const TERRITORY_OUTLINE_OPACITY: DataDrivenPropertyValueSpecification<number> = [
  "case",
  ["==", TERRITORY_KIND as unknown as ExpressionSpecification, "presence"],
  0,
  ["==", TERRITORY_KIND as unknown as ExpressionSpecification, "influence"],
  0.3,
  ["match", ["get", "status"], "uncertain", 0.55, 0.9],
];

const TERRITORY_LAYER_IDS = [
  "territory-fill",
  "territory-contested-hatch",
  "territory-outline",
  "territory-outline-dashed",
  "territory-outline-influence",
  "territory-outline-presence",
  "territory-recently-changed-highlight",
];

function addEventLayers(
  map: MapLibreMap,
  initialData: GeoJSON.FeatureCollection,
  initialTerritoryData: GeoJSON.FeatureCollection,
) {
  // A basemap-mode switch calls setStyle(), which discards every source and
  // layer added imperatively (they aren't part of the new style document),
  // so this whole setup must be safely re-runnable, not just mount-once.
  if (map.getSource("events")) return;

  // Continuous conflict-intensity surface: one image over the land (oceans
  // transparent), added before everything else so territorial polygons,
  // borders, markers and labels all sit above it. Inserted beneath the
  // basemap's own symbol (label) layers when the style has any, so place
  // names stay readable through the surface.
  map.addSource("heat-surface", { type: "image", url: TRANSPARENT_PIXEL, coordinates: HEAT_IMAGE_COORDINATES });
  const firstSymbol = map.getStyle().layers.find((l) => l.type === "symbol")?.id;
  map.addLayer(
    { id: "heat-surface", type: "raster", source: "heat-surface", layout: { visibility: "none" }, paint: { "raster-opacity": 1, "raster-resampling": "linear", "raster-fade-duration": 0 } },
    firstSymbol,
  );

  // Territorial polygons are added next so they render beneath every
  // marker/heat layer added below (spec §1/§8 "territorial polygons
  // underneath... heatmap/event hotspots must remain clickable above
  // territorial polygons") — MapLibre stacks layers in addLayer() call
  // order, later calls painting on top.
  map.addSource("territory", { type: "geojson", data: initialTerritoryData });
  const hatchId = "territory-contested-hatch-pattern";
  if (!map.hasImage(hatchId)) map.addImage(hatchId, createContestedPatternImageData());
  map.addLayer({
    id: "territory-fill",
    type: "fill",
    source: "territory",
    layout: { visibility: "none" },
    paint: { "fill-color": ["get", "actorColor"], "fill-opacity": TERRITORY_FILL_OPACITY },
  });
  map.addLayer({
    id: "territory-contested-hatch",
    type: "fill",
    source: "territory",
    filter: ["all", ["==", ["get", "status"], "contested"], ["==", TERRITORY_KIND as unknown as ExpressionSpecification, "control"]],
    layout: { visibility: "none" },
    paint: { "fill-pattern": hatchId, "fill-opacity": 0.6 },
  });
  map.addLayer({
    id: "territory-outline",
    type: "line",
    source: "territory",
    layout: { visibility: "none" },
    paint: { "line-color": ["get", "actorColor"], "line-width": TERRITORY_OUTLINE_WIDTH, "line-opacity": TERRITORY_OUTLINE_OPACITY },
  });
  // A secondary dashed/dotted stroke, distinct outline TEXTURE (not just
  // color) for contested vs. uncertain, drawn on top of the solid outline.
  map.addLayer({
    id: "territory-outline-dashed",
    type: "line",
    source: "territory",
    filter: ["all", ["in", ["get", "status"], ["literal", ["contested", "uncertain"]]], ["==", TERRITORY_KIND as unknown as ExpressionSpecification, "control"]],
    layout: { visibility: "none" },
    paint: {
      "line-color": "#f3f5f7",
      "line-width": 1.5,
      "line-opacity": 0.7,
      "line-dasharray": ["match", ["get", "status"], "uncertain", ["literal", [1, 2]], ["literal", [3, 2]]],
    },
  });
  // Influence / presence edges: distinct textures so they cannot be read as control.
  map.addLayer({ id: "territory-outline-influence", type: "line", source: "territory", filter: ["==", TERRITORY_KIND as unknown as ExpressionSpecification, "influence"], layout: { visibility: "none" }, paint: { "line-color": "#f3f5f7", "line-width": 1.6, "line-opacity": 0.85, "line-dasharray": ["literal", [4, 2.5]] } });
  map.addLayer({ id: "territory-outline-presence", type: "line", source: "territory", filter: ["==", TERRITORY_KIND as unknown as ExpressionSpecification, "presence"], layout: { visibility: "none", "line-cap": "round" }, paint: { "line-color": "#f3f5f7", "line-width": 2, "line-opacity": 0.9, "line-dasharray": ["literal", [0.4, 2.2]] } });
  map.addLayer({
    id: "territory-recently-changed-highlight",
    type: "line",
    source: "territory",
    filter: ["all", ["==", ["get", "status"], "recently_changed"], ["==", TERRITORY_KIND as unknown as ExpressionSpecification, "control"]],
    layout: { visibility: "none" },
    paint: { "line-color": "#ffd60a", "line-width": 2, "line-opacity": 0.9, "line-dasharray": ["literal", [2, 1.5]] },
  });

  map.addSource("events", {
    type: "geojson",
    data: initialData,
    cluster: true,
    clusterMaxZoom: 7,
    clusterRadius: 46,
    // A cluster's number is the SUM of its events' supporting reports, not
    // how many event points it swallowed (lib/map/report-counts.ts).
    clusterProperties: { reports: ["+", ["get", "reportCount"]], events: ["+", ["get", "eventCount"]] },
  });
  // Hotspot report-count labels for heatmap mode — pre-aggregated by
  // geographic bucket per zoom (see refreshReportHeatLabels), so the label
  // count stays small however many events exist.
  map.addSource("report-heat-labels", { type: "geojson", data: EMPTY_FEATURE_COLLECTION });

  map.addLayer({
    id: "clusters",
    type: "circle",
    source: "events",
    filter: ["has", "point_count"],
    paint: {
      "circle-color": "#4CC2FF",
      "circle-opacity": 0.22,
      "circle-stroke-width": 1.5,
      "circle-stroke-color": "#4CC2FF",
      "circle-radius": ["step", ["get", "events"], 18, 8, 24, 24, 32],
    },
  });
  map.addLayer({
    id: "cluster-count",
    type: "symbol",
    source: "events",
    filter: ["has", "point_count"],
    layout: {
      "text-field": REPORT_LABEL_EXPRESSION(["get", "reports"]),
      "text-font": ["Noto Sans Regular"],
      "text-size": 14,
      "text-allow-overlap": true,
      "text-ignore-placement": true,
    },
    paint: { "text-color": "#FFFFFF", "text-halo-color": "rgba(8,10,13,0.8)", "text-halo-width": 1.3 },
  });
  // Location-precision uncertainty: an event whose position is only
  // approximate / area-level / unknown gets a soft, oversized halo instead
  // of looking like an exact pin. Only an explicit non-exact precision draws
  // one (mock/legacy events with no precision are unchanged).
  map.addLayer({
    id: "unclustered-point-uncertainty",
    type: "circle",
    source: "events",
    filter: ["all", ["!", ["has", "point_count"]], ["in", ["get", "precision"], ["literal", ["approximate", "city", "region", "area_level", "unknown"]]]],
    paint: {
      "circle-radius": ["match", ["get", "precision"], "approximate", 16, "city", 16, "region", 34, "area_level", 30, "unknown", 24, 0],
      "circle-color": SEVERITY_COLOR_MATCH,
      "circle-opacity": 0.12,
      "circle-blur": 0.5,
      "circle-stroke-width": 1,
      "circle-stroke-color": SEVERITY_COLOR_MATCH,
      "circle-stroke-opacity": 0.4,
    },
  });
  map.addLayer({
    id: "unclustered-point",
    type: "circle",
    source: "events",
    filter: ["!", ["has", "point_count"]],
    // "Medium zoom: simplified category markers" — a plain severity-colored
    // dot, ceding to the full icon layer once zoomed in past ICON_DETAIL_ZOOM.
    maxzoom: ICON_DETAIL_ZOOM,
    paint: {
      // Big enough to hold the report-count label drawn on top of it.
      "circle-radius": ["interpolate", ["linear"], ["get", "importance"], 40, 10, 100, 13],
      "circle-color": SEVERITY_COLOR_MATCH,
      "circle-stroke-width": 1.5,
      "circle-stroke-color": "rgba(8,10,13,0.85)",
    },
  });
  registerEventIcons(map);
  map.addLayer({
    id: "unclustered-point-icon",
    type: "symbol",
    source: "events",
    filter: ["!", ["has", "point_count"]],
    // "High zoom: full category-specific icons".
    minzoom: ICON_DETAIL_ZOOM,
    layout: {
      // SQLite has no enum type (prisma/schema.prisma), so a real DB row's
      // eventType is never actually validated against EVENT_TYPES the way
      // TypeScript assumes elsewhere — a stray/legacy value would resolve
      // to an unregistered image id and MapLibre would silently render no
      // icon for that marker. The "in" check falls back to the "other"
      // icon (always registered) instead.
      "icon-image": [
        "case",
        ["in", ["get", "eventType"], ["literal", EVENT_TYPES as unknown as string[]]],
        ["concat", "event-icon-", ["get", "eventType"]],
        "event-icon-other",
      ],
      "icon-size": ["interpolate", ["linear"], ["get", "importance"], 40, 0.32, 100, 0.5],
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
    paint: {
      "icon-color": SEVERITY_COLOR_MATCH,
      "icon-halo-color": "rgba(8,10,13,0.85)",
      "icon-halo-width": 1.2,
    },
  });
  // Country borders + coastlines from our own topology, above the heat
  // surface and territory fill: the surface tints the land, these keep
  // geography legible on any basemap (including the key-less fallback).
  map.addSource("heat-borders", { type: "geojson", data: getHeatBorders() });
  map.addLayer({
    id: "heat-borders",
    type: "line",
    source: "heat-borders",
    layout: { visibility: "none" },
    paint: { "line-color": "#d5dde8", "line-opacity": ["match", ["get", "kind"], "coast", 0.42, 0.24], "line-width": ["match", ["get", "kind"], "coast", 0.9, 0.6] },
  });

  // Report count on every individual marker (marker mode): the supporting
  // reports of THAT event, capped at "99+". Sits on the dot at medium zoom
  // and as a small badge beside the category icon at high zoom.
  map.addLayer({
    id: "unclustered-report-count",
    type: "symbol",
    source: "events",
    filter: ["!", ["has", "point_count"]],
    layout: {
      "text-field": REPORT_LABEL_EXPRESSION(["get", "reportCount"]),
      "text-font": ["Noto Sans Regular"],
      "text-size": 13,
      "text-allow-overlap": true,
      "text-ignore-placement": true,
      "text-offset": ["step", ["zoom"], ["literal", [0, 0]], ICON_DETAIL_ZOOM, ["literal", [1.3, -1.3]]],
    },
    paint: { "text-color": "#FFFFFF", "text-halo-color": "rgba(8,10,13,0.85)", "text-halo-width": 1.4 },
  });

  // Heatmap mode: unobtrusive count at each hotspot bucket's centre.
  map.addLayer({
    id: "report-heat-label",
    type: "symbol",
    source: "report-heat-labels",
    layout: {
      visibility: "none",
      "text-field": ["get", "label"],
      "text-font": ["Noto Sans Regular"],
      "text-size": 12,
    },
    paint: { "text-color": "#F3F5F7", "text-halo-color": "rgba(8,10,13,0.9)", "text-halo-width": 1.5, "text-opacity": 0.9 },
  });
}


// ---- Natural-hazard layers ------------------------------------------------------------------
// Visual language (deliberately unlike conflict markers, whose colour encodes conflict severity):
//   earthquakes  violet RINGS sized by magnitude, "M6.4" labels, clustered when zoomed out
//   thermal      amber DIAMONDS; dense detections arrive already aggregated as counted discs
//   wildfires    red-orange flame-notched diamonds (reported incidents, not raw detections)
//   volcanoes    rose TRIANGLES (faded when the record is stale)
//   weather      teal alert AREAS (dashed outline, opacity by CAP severity) with a warning marker
const HZ = { quake: "#C77DFF", thermal: "#FFB020", wildfire: "#FF5A36", volcano: "#FF6F91", weather: "#2EC4B6", aviation: "#6EA8FF", maritime: "#22D3EE", energy: "#A3E635", internet: "#F0ABFC", alert: "#FF6EC7" };
const HAZARD_LAYER_IDS: Record<HazardLayer, string[]> = {
  earthquakes: ["hz-quake-cluster", "hz-quake-cluster-count", "hz-quake-circle", "hz-quake-label-major", "hz-quake-label-mid", "hz-quake-label-all"],
  fires: ["hz-thermal-cluster", "hz-thermal-cluster-count", "hz-thermal-point", "hz-fire-point"],
  weather: ["hz-weather-fill", "hz-weather-outline", "hz-weather-icon"],
  volcanoes: ["hz-volcano"],
  aviation: ["hz-airspace-fill", "hz-airspace-outline", "hz-aviation-icon"],
  maritime: ["hz-chokepoint-ring", "hz-maritime-icon"],
  energy: ["hz-energy-cluster", "hz-energy-cluster-count", "hz-energy-icon"],
  internet: ["hz-internet-halo", "hz-internet-icon"],
};
const AREA_CLICK_LAYERS = ["hz-weather-fill", "hz-airspace-fill"];
const HAZARD_CLICK_LAYERS = ["hz-quake-circle", "hz-thermal-point", "hz-fire-point", "hz-volcano", "hz-weather-icon", "hz-weather-fill", "hz-aviation-icon", "hz-airspace-fill", "hz-maritime-icon", "hz-energy-icon", "hz-energy-cluster", "hz-internet-icon"];
const QUAKE_RADIUS: DataDrivenPropertyValueSpecification<number> = ["interpolate", ["linear"], ["coalesce", ["get", "value"], 2.5], 2.5, 4, 4, 7, 5, 11, 6, 18, 7, 28, 8, 38];
const AREA_FILTER: ExpressionSpecification = ["in", ["geometry-type"], ["literal", ["Polygon", "MultiPolygon"]]];

const CONFLICT_MARKER_LAYERS = ["conflict-halo", "conflict-core", "conflict-count", "conflict-label", "conflict-nonspatial-count"];

function conflictMarkersToGeoJSON(list: readonly MarkerConflict[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: list.map((c) => {
      const reports = c.reportCount ?? 0;
      const mapped = Math.min(c.mappedReportCount ?? 0, reports);
      return { type: "Feature", geometry: { type: "Point", coordinates: [c.lng, c.lat] }, properties: { slug: c.slug, name: c.name, severity: c.severity, score: c.severityScore, recent: c.recent ? 1 : 0, reports, nonSpatial: reports - mapped } };
    }),
  };
}

const SEVERITY_MATCH: ExpressionSpecification = ["match", ["get", "severity"], "stable", SEVERITY_HEX.stable, "guarded", SEVERITY_HEX.guarded, "elevated", SEVERITY_HEX.elevated, "high", SEVERITY_HEX.high, "severe", SEVERITY_HEX.severe, "extreme", "#C2374F", SEVERITY_HEX.elevated];

// Situation-level active-conflict markers: below the event clusters (events stay on top and clickable), gone once
// the map is zoomed in far enough that individual events are the meaningful level. A conflict gets ONE marker
// however many events it has; the ring is heavier when the conflict had a recent development.
function addConflictMarkerLayers(map: MapLibreMap, list: readonly MarkerConflict[]) {
  if (map.getSource("active-conflicts")) return;
  map.addSource("active-conflicts", { type: "geojson", data: conflictMarkersToGeoJSON(list) });
  // Beneath the hazard layers (which sit beneath the event clusters) so hazards and events stay on top and clickable.
  const before = map.getStyle()?.layers?.find((l) => l.id.startsWith("hz-"))?.id ?? (map.getLayer("clusters") ? "clusters" : undefined);
  map.addLayer({ id: "conflict-halo", type: "circle", source: "active-conflicts", maxzoom: 7, paint: { "circle-radius": ["interpolate", ["linear"], ["get", "score"], 30, 9, 70, 14, 100, 20], "circle-color": SEVERITY_MATCH, "circle-opacity": 0.14, "circle-stroke-color": SEVERITY_MATCH, "circle-stroke-opacity": 0.7, "circle-stroke-width": ["case", ["==", ["get", "recent"], 1], 2.5, 1] } }, before);
  // The conflict's own report count sits INSIDE its marker: the dot grows to hold the number when there are reports.
  map.addLayer({ id: "conflict-core", type: "circle", source: "active-conflicts", maxzoom: 7, paint: { "circle-radius": ["case", [">", ["get", "reports"], 0], 12, 4], "circle-color": SEVERITY_MATCH, "circle-stroke-color": "#0B0E12", "circle-stroke-width": 1.5 } }, before);
  map.addLayer({ id: "conflict-count", type: "symbol", source: "active-conflicts", maxzoom: 7, filter: [">", ["get", "reports"], 0], layout: { "text-field": REPORT_LABEL_EXPRESSION(["get", "reports"]), "text-font": ["Noto Sans Regular"], "text-size": 13, "text-allow-overlap": true, "text-ignore-placement": true }, paint: { "text-color": "#FFFFFF", "text-halo-color": "rgba(8,10,13,0.75)", "text-halo-width": 1.3 } }, before);
  map.addLayer({ id: "conflict-label", type: "symbol", source: "active-conflicts", minzoom: 2.5, maxzoom: 7, layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Medium"], "text-size": 11, "text-offset": [0, 1.6], "text-anchor": "top", "text-optional": true, "symbol-sort-key": ["-", 100, ["get", "score"]] }, paint: { "text-color": "#F3F5F7", "text-halo-color": "rgba(8,10,13,0.9)", "text-halo-width": 1.3 } }, before);
  // Past zoom 7, the aggregate marker above steps aside for individual geolocated event markers/clusters —
  // but a conflict's country-level (non-spatial) reports have no point to become one of those, so without
  // this they simply vanish with no indication they still exist (spec "no report should silently cease to
  // be represented merely because the user changed zoom"). A small, explicitly-labelled text badge (never
  // a filled point — it must not look like a precise location) picks up exactly where the aggregate marker
  // stops, and only appears where there IS a non-spatial remainder; `text-allow-overlap: false` lets it
  // gracefully give way to denser event markers rather than stacking on top of them.
  map.addLayer(
    {
      id: "conflict-nonspatial-count",
      type: "symbol",
      source: "active-conflicts",
      minzoom: 7,
      filter: [">", ["get", "nonSpatial"], 0],
      layout: {
        "text-field": ["concat", ["get", "nonSpatial"], " country-level"],
        "text-font": ["Noto Sans Regular"],
        "text-size": 10,
        "text-anchor": "center",
        "text-allow-overlap": false,
        "text-ignore-placement": false,
        "symbol-sort-key": ["-", 100, ["get", "score"]],
      },
      paint: { "text-color": "#F3F5F7", "text-halo-color": "rgba(8,10,13,0.85)", "text-halo-width": 1.5 },
    },
    before,
  );
}

function addHazardLayers(map: MapLibreMap, initial: HazardSourceData) {
  if (map.getSource("hz-quakes")) return;
  for (const id of HAZARD_ICON_IDS) if (!map.hasImage(id)) map.addImage(id, createHazardIconImageData(id), { sdf: true });
  // Below the conflict layers, so a conflict marker always stays on top and clickable.
  const before = map.getLayer("clusters") ? "clusters" : undefined;
  const halo = { "text-color": "#F3F5F7", "text-halo-color": "rgba(8,10,13,0.9)", "text-halo-width": 1.4 };

  map.addSource("hz-weather", { type: "geojson", data: initial.weather });
  map.addLayer({ id: "hz-weather-fill", type: "fill", source: "hz-weather", filter: AREA_FILTER, layout: { visibility: "none" }, paint: { "fill-color": HZ.weather, "fill-opacity": ["interpolate", ["linear"], ["coalesce", ["get", "value"], 1], 1, 0.1, 2, 0.16, 3, 0.24, 4, 0.34] } }, before);
  map.addLayer({ id: "hz-weather-outline", type: "line", source: "hz-weather", filter: AREA_FILTER, layout: { visibility: "none" }, paint: { "line-color": HZ.weather, "line-width": ["interpolate", ["linear"], ["coalesce", ["get", "value"], 1], 1, 1, 4, 2.5], "line-dasharray": ["literal", [3, 2]], "line-opacity": 0.9 } }, before);
  map.addLayer({ id: "hz-weather-icon", type: "symbol", source: "hz-weather", layout: { visibility: "none", "icon-image": "hz-icon-warning", "icon-size": ["interpolate", ["linear"], ["zoom"], 1, 0.3, 8, 0.5], "icon-allow-overlap": true }, paint: { "icon-color": HZ.weather, "icon-halo-color": "rgba(8,10,13,0.9)", "icon-halo-width": 1.2 } }, before);

  map.addSource("hz-thermal", { type: "geojson", data: initial.thermal });
  map.addLayer({ id: "hz-thermal-cluster", type: "circle", source: "hz-thermal", filter: ["==", ["get", "kind"], "thermal_cluster"], layout: { visibility: "none" }, paint: { "circle-color": HZ.thermal, "circle-opacity": 0.32, "circle-stroke-width": 1.5, "circle-stroke-color": HZ.thermal, "circle-radius": ["interpolate", ["linear"], ["coalesce", ["get", "count"], 1], 1, 6, 20, 10, 200, 16, 2000, 24] } }, before);
  map.addLayer({ id: "hz-thermal-cluster-count", type: "symbol", source: "hz-thermal", filter: ["==", ["get", "kind"], "thermal_cluster"], layout: { visibility: "none", "text-field": ["to-string", ["get", "count"]], "text-font": ["Noto Sans Regular"], "text-size": 10, "text-allow-overlap": true }, paint: halo }, before);
  map.addLayer({ id: "hz-thermal-point", type: "symbol", source: "hz-thermal", filter: ["!=", ["get", "kind"], "thermal_cluster"], layout: { visibility: "none", "icon-image": "hz-icon-thermal", "icon-size": ["interpolate", ["linear"], ["zoom"], 6, 0.28, 12, 0.5], "icon-allow-overlap": true }, paint: { "icon-color": HZ.thermal, "icon-halo-color": "rgba(8,10,13,0.85)", "icon-halo-width": 1 } }, before);

  map.addSource("hz-points", { type: "geojson", data: initial.points });
  map.addLayer({ id: "hz-fire-point", type: "symbol", source: "hz-points", filter: ["==", ["get", "kind"], "confirmed_wildfire"], layout: { visibility: "none", "icon-image": "hz-icon-wildfire", "icon-size": ["interpolate", ["linear"], ["zoom"], 2, 0.34, 10, 0.6], "icon-allow-overlap": true }, paint: { "icon-color": HZ.wildfire, "icon-halo-color": "rgba(8,10,13,0.9)", "icon-halo-width": 1.2 } }, before);
  map.addLayer({ id: "hz-volcano", type: "symbol", source: "hz-points", filter: ["==", ["get", "kind"], "volcano"], layout: { visibility: "none", "icon-image": "hz-icon-volcano", "icon-size": ["interpolate", ["linear"], ["zoom"], 2, 0.36, 10, 0.62], "icon-allow-overlap": true }, paint: { "icon-color": HZ.volcano, "icon-opacity": ["case", ["get", "stale"], 0.4, 1], "icon-halo-color": "rgba(8,10,13,0.9)", "icon-halo-width": 1.2 } }, before);

  // ---- Transport and infrastructure (strategic status only: no aircraft or vessel positions) ----
  // Aviation: plane = an airport with a reported status change; blue areas = airspace notices.
  // Maritime: hourglass ring = chokepoint (faint when normal), square = port, hexagon = security incident.
  // Energy: bolt = an outage/reduced-capacity record; zoomed out, one counted disc per country.
  // Internet: broken ring = an observed country-level connectivity anomaly.
  map.addSource("hz-ops", { type: "geojson", data: initial.ops });
  const statusColor = (family: string): ExpressionSpecification => ["match", ["coalesce", ["get", "status"], ""], ["closed", "closure", "closed_restricted", "major_disruption", "outage"], HZ.alert, ["partially_closed", "restriction", "elevated_disruption", "reduced_capacity"], "#B08CFF", family];
  map.addLayer({ id: "hz-airspace-fill", type: "fill", source: "hz-ops", filter: ["all", ["==", ["get", "layer"], "aviation"], AREA_FILTER], layout: { visibility: "none" }, paint: { "fill-color": HZ.aviation, "fill-opacity": 0.14 } }, before);
  map.addLayer({ id: "hz-airspace-outline", type: "line", source: "hz-ops", filter: ["all", ["==", ["get", "layer"], "aviation"], AREA_FILTER], layout: { visibility: "none" }, paint: { "line-color": HZ.aviation, "line-width": 1.8, "line-dasharray": ["literal", [2, 2]] } }, before);
  map.addLayer({ id: "hz-aviation-icon", type: "symbol", source: "hz-ops", filter: ["==", ["get", "layer"], "aviation"], layout: { visibility: "none", "icon-image": ["case", ["==", ["get", "kind"], "airspace_event"], "hz-icon-warning", "hz-icon-airport"], "icon-size": ["interpolate", ["linear"], ["zoom"], 1, 0.34, 8, 0.58], "icon-allow-overlap": true }, paint: { "icon-color": statusColor(HZ.aviation), "icon-halo-color": "rgba(8,10,13,0.9)", "icon-halo-width": 1.2 } }, before);
  map.addLayer({ id: "hz-chokepoint-ring", type: "circle", source: "hz-ops", filter: ["==", ["get", "kind"], "chokepoint_status"], layout: { visibility: "none" }, paint: { "circle-radius": 15, "circle-color": HZ.maritime, "circle-opacity": ["match", ["get", "status"], "normal", 0.06, 0.18], "circle-stroke-width": ["match", ["get", "status"], "normal", 1, 2.5], "circle-stroke-color": statusColor(HZ.maritime), "circle-stroke-opacity": ["match", ["get", "status"], "normal", 0.4, 0.95] } }, before);
  map.addLayer({ id: "hz-maritime-icon", type: "symbol", source: "hz-ops", filter: ["==", ["get", "layer"], "maritime"], layout: { visibility: "none", "icon-image": ["match", ["get", "kind"], "chokepoint_status", "hz-icon-chokepoint", "port_disruption", "hz-icon-port", "hz-icon-incident"], "icon-size": ["interpolate", ["linear"], ["zoom"], 1, 0.3, 8, 0.55], "icon-allow-overlap": true }, paint: { "icon-color": statusColor(HZ.maritime), "icon-opacity": ["case", ["==", ["get", "status"], "normal"], 0.55, ["get", "stale"], 0.4, 1], "icon-halo-color": "rgba(8,10,13,0.9)", "icon-halo-width": 1.2 } }, before);
  map.addLayer({ id: "hz-energy-cluster", type: "circle", source: "hz-ops", filter: ["==", ["get", "kind"], "energy_cluster"], layout: { visibility: "none" }, paint: { "circle-color": HZ.energy, "circle-opacity": 0.25, "circle-stroke-width": 2, "circle-stroke-color": HZ.energy, "circle-radius": ["interpolate", ["linear"], ["coalesce", ["get", "count"], 1], 1, 10, 10, 16, 50, 24] } }, before);
  map.addLayer({ id: "hz-energy-cluster-count", type: "symbol", source: "hz-ops", filter: ["==", ["get", "kind"], "energy_cluster"], layout: { visibility: "none", "text-field": ["to-string", ["get", "count"]], "text-font": ["Noto Sans Regular"], "text-size": 11, "text-allow-overlap": true }, paint: halo }, before);
  map.addLayer({ id: "hz-energy-icon", type: "symbol", source: "hz-ops", filter: ["all", ["==", ["get", "layer"], "energy"], ["!=", ["get", "kind"], "energy_cluster"]], layout: { visibility: "none", "icon-image": "hz-icon-energy", "icon-size": ["interpolate", ["linear"], ["zoom"], 4, 0.36, 10, 0.6], "icon-allow-overlap": true }, paint: { "icon-color": statusColor(HZ.energy), "icon-halo-color": "rgba(8,10,13,0.9)", "icon-halo-width": 1.2 } }, before);
  map.addLayer({ id: "hz-internet-halo", type: "circle", source: "hz-ops", filter: ["==", ["get", "layer"], "internet"], layout: { visibility: "none" }, paint: { "circle-color": HZ.internet, "circle-opacity": 0.12, "circle-stroke-width": 1.5, "circle-stroke-color": HZ.internet, "circle-stroke-opacity": 0.6, "circle-radius": ["interpolate", ["linear"], ["get", "prominence"], 40, 12, 90, 30] } }, before);
  map.addLayer({ id: "hz-internet-icon", type: "symbol", source: "hz-ops", filter: ["==", ["get", "layer"], "internet"], layout: { visibility: "none", "icon-image": "hz-icon-internet", "icon-size": ["interpolate", ["linear"], ["zoom"], 1, 0.34, 8, 0.55], "icon-allow-overlap": true }, paint: { "icon-color": HZ.internet, "icon-halo-color": "rgba(8,10,13,0.9)", "icon-halo-width": 1.2 } }, before);

  // Earthquakes cluster while zoomed out (the number is how many quakes).
  map.addSource("hz-quakes", { type: "geojson", data: initial.quakes, cluster: true, clusterMaxZoom: 5, clusterRadius: 38, clusterProperties: { maxMag: ["max", ["coalesce", ["get", "value"], 0]] } });
  map.addLayer({ id: "hz-quake-cluster", type: "circle", source: "hz-quakes", filter: ["has", "point_count"], layout: { visibility: "none" }, paint: { "circle-color": HZ.quake, "circle-opacity": 0.22, "circle-stroke-width": 2, "circle-stroke-color": HZ.quake, "circle-radius": ["step", ["get", "point_count"], 13, 5, 18, 20, 26] } }, before);
  map.addLayer({ id: "hz-quake-cluster-count", type: "symbol", source: "hz-quakes", filter: ["has", "point_count"], layout: { visibility: "none", "text-field": ["to-string", ["get", "point_count"]], "text-font": ["Noto Sans Regular"], "text-size": 11, "text-allow-overlap": true }, paint: halo }, before);
  map.addLayer({ id: "hz-quake-circle", type: "circle", source: "hz-quakes", filter: ["!", ["has", "point_count"]], layout: { visibility: "none" }, paint: { "circle-radius": QUAKE_RADIUS, "circle-color": HZ.quake, "circle-opacity": 0.16, "circle-stroke-width": 2, "circle-stroke-color": HZ.quake, "circle-stroke-opacity": 0.95 } }, before);
  const label = (id: string, filter: ExpressionSpecification, minzoom: number) =>
    map.addLayer({ id, type: "symbol", source: "hz-quakes", filter, minzoom, layout: { visibility: "none", "text-field": ["get", "label"], "text-font": ["Noto Sans Regular"], "text-size": 11, "text-offset": [0, 1.4], "text-anchor": "top", "text-allow-overlap": false }, paint: halo }, before);
  label("hz-quake-label-major", ["all", ["!", ["has", "point_count"]], [">=", ["coalesce", ["get", "value"], 0], 5]], 0);
  label("hz-quake-label-mid", ["all", ["!", ["has", "point_count"]], [">=", ["coalesce", ["get", "value"], 0], 3.5], ["<", ["coalesce", ["get", "value"], 0], 5]], 5);
  label("hz-quake-label-all", ["all", ["!", ["has", "point_count"]], ["<", ["coalesce", ["get", "value"], 0], 3.5]], 7);
}

function setHazardData(map: MapLibreMap, data: HazardSourceData) {
  (map.getSource("hz-quakes") as GeoJSONSource | undefined)?.setData(data.quakes);
  (map.getSource("hz-thermal") as GeoJSONSource | undefined)?.setData(data.thermal);
  (map.getSource("hz-points") as GeoJSONSource | undefined)?.setData(data.points);
  (map.getSource("hz-weather") as GeoJSONSource | undefined)?.setData(data.weather);
  (map.getSource("hz-ops") as GeoJSONSource | undefined)?.setData(data.ops);
}

function applyHazardVisibility(map: MapLibreMap, enabled: readonly HazardLayer[]) {
  (Object.keys(HAZARD_LAYER_IDS) as HazardLayer[]).forEach((layer) => {
    const vis = enabled.includes(layer) ? "visible" : "none";
    HAZARD_LAYER_IDS[layer].forEach((id) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", vis);
    });
  });
}

/** "99+"-capped display text for a numeric report-count expression. */
function REPORT_LABEL_EXPRESSION(value: ExpressionSpecification): ExpressionSpecification {
  return ["case", [">", value, REPORT_COUNT_CAP], `${REPORT_COUNT_CAP}+`, ["to-string", value]];
}

/** Rebuilds the heatmap hotspot labels for the current zoom (grid-bucketed,
 * capped — see lib/map/report-counts.ts aggregateReportBuckets). */
function refreshReportHeatLabels(map: MapLibreMap, events: ConflictEvent[]) {
  const source = map.getSource("report-heat-labels") as GeoJSONSource | undefined;
  if (!source) return;
  const buckets = aggregateReportBuckets(
    buildEventMarkers(events).map((m) => ({ id: m.id, lat: m.latitude, lng: m.longitude, sourceCount: m.reportCount })),
    map.getZoom(),
  );
  source.setData({
    type: "FeatureCollection",
    features: buckets.map((b) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [b.lng, b.lat] },
      properties: { reports: b.reports, label: formatReportCount(b.reports), eventCount: b.eventCount },
    })),
  });
}

const HEAT_LAYER_IDS = ["heat-surface", "heat-borders", "report-heat-label"];

const TRANSPARENT_PIXEL = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
// Web-Mercator square: the surface is rasterized in mercator rows, so a
// plain four-corner image is geometrically exact.
const HEAT_IMAGE_COORDINATES: [[number, number], [number, number], [number, number], [number, number]] = [
  [-180, MERCATOR_MAX_LAT],
  [180, MERCATOR_MAX_LAT],
  [180, -MERCATOR_MAX_LAT],
  [-180, -MERCATOR_MAX_LAT],
];
const HEAT_TEXTURE_WIDTH = 2048;

export function WorldMap({
  events,
  viewMode,
  conflicts,
  nowIso: nowIsoProp,
  live = true,
  basemapMode,
  onSelectEvent,
  territorialFeatures = EMPTY_FEATURE_COLLECTION,
  showTerritorial = false,
  onSelectTerritory = () => {},
  hazards = null,
  focus = null,
  holdCamera = false,
  activeConflicts = [],
  onSelectConflict = () => {},
  hazardLayers = [],
  onSelectHazard = () => {},
  onViewportChange = () => {},
  className,
}: WorldMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const eventsRef = useRef(events);
  const onSelectRef = useRef(onSelectEvent);
  const viewModeRef = useRef(viewMode);
  const showTerritorialRef = useRef(showTerritorial);
  const onSelectTerritoryRef = useRef(onSelectTerritory);
  const territorialFeaturesRef = useRef(territorialFeatures);
  const hazardDataRef = useRef<HazardSourceData>(EMPTY_HAZARD_SOURCES);
  const hazardLayersRef = useRef(hazardLayers);
  const onSelectHazardRef = useRef(onSelectHazard);
  const onViewportChangeRef = useRef(onViewportChange);
  const conflictMarkersRef = useRef(activeConflicts);
  const onSelectConflictRef = useRef(onSelectConflict);
  const appliedModeRef = useRef<MapBasemapMode | null>(null);
  // The basemap authority (lib/map/basemap.ts) decides the provider; this component only applies its style and
  // handles a runtime failure by falling back ONCE per provider (never an endless retry).
  const basemapConfig = useMemo(() => readBasemapConfig(), []);
  const failedRef = useRef<Partial<Record<BasemapProviderId, string>>>({});
  const resolutionRef = useRef<BasemapResolution | null>(null);
  const styleReadyRef = useRef(false);
  const basemapErrorsRef = useRef(0);
  const [basemapNotice, setBasemapNotice] = useState<{ text: string; detail: string } | null>(null);
  const heatUrlRef = useRef<string | null>(null);
  // Reference time for the heat surface: the caller's (timeline asOf) or the real clock when the data last changed.
  const clockIso = useMemo(() => new Date().toISOString(), [events]); // eslint-disable-line react-hooks/exhaustive-deps
  const nowIso = nowIsoProp ?? clockIso;

  // Continuous conflict-intensity surface (lib/heat): computed only while
  // Heatmap is the active mode, memoized on its inputs, rasterized to a
  // mercator image and swapped into one image source — never rebuilt per frame.
  const heatField = useHeatField({ enabled: viewMode === "heatmap", conflicts, events, nowIso, live });

  const applyHeatSurface = (map: MapLibreMap) => {
    const source = map.getSource("heat-surface") as ImageSource | undefined;
    if (source && heatUrlRef.current) source.updateImage({ url: heatUrlRef.current, coordinates: HEAT_IMAGE_COORDINATES });
  };

  useEffect(() => {
    eventsRef.current = events;
    onSelectRef.current = onSelectEvent;
    viewModeRef.current = viewMode;
    showTerritorialRef.current = showTerritorial;
    onSelectTerritoryRef.current = onSelectTerritory;
    territorialFeaturesRef.current = territorialFeatures;
    hazardLayersRef.current = hazardLayers;
    onSelectHazardRef.current = onSelectHazard;
    onViewportChangeRef.current = onViewportChange;
    conflictMarkersRef.current = activeConflicts;
    onSelectConflictRef.current = onSelectConflict;
  });

  const basemapModeRef = useRef(basemapMode);
  useLayoutEffect(() => {
    basemapModeRef.current = basemapMode;
  });

  /** Resolves the style for the current mode, honouring providers that already failed. */
  const styleForMode = (mode: MapBasemapMode) => {
    const r = resolveBasemap(mode, basemapConfig, failedRef.current);
    resolutionRef.current = r;
    return r.provider.style;
  };

  const publishBasemapState = (map: MapLibreMap | null) => {
    const r = resolutionRef.current;
    if (!r) return;
    recordBasemapState({ at: new Date().toISOString(), mode: r.mode, provider: r.provider.id, fallback: r.fallback, reason: r.reason ? safeReason(r.reason) : null, failed: failedRef.current, mapLoaded: map?.isStyleLoaded() === true, glyphs: glyphStats() });
    const expected = r.mode === "satellite" && r.provider.id !== "external-satellite";
    // Users see plain words; the technical reason stays in the recorded basemap state (and the notice's tooltip). A basemap
    // that is simply not configured is not news to a visitor — only a failure at runtime or unavailable imagery is.
    const runtimeFailure = Object.keys(failedRef.current).length > 0;
    setBasemapNotice(
      r.fallback && r.reason && (expected || runtimeFailure)
        ? { text: expected ? "Satellite imagery is not available here. Showing the Vigil basemap instead." : "Basemap fallback: the detailed map could not be loaded, showing Vigil's built-in map.", detail: safeReason(r.reason) }
        : null,
    );
  };

  /** A provider failed: remember why, resolve the next one and switch to it (once). */
  const failProvider = (map: MapLibreMap, why: string) => {
    const current = resolutionRef.current?.provider.id;
    if (!current || failedRef.current[current]) return;
    failedRef.current = { ...failedRef.current, [current]: safeReason(why) };
    console.warn(`[basemap] ${current} unavailable (${safeReason(why)}); falling back`);
    styleReadyRef.current = false;
    map.setStyle(styleForMode(basemapModeRef.current));
    publishBasemapState(map);
  };

  const applyViewModeVisibility = (map: MapLibreMap) => {
    const markerVis = viewModeRef.current === "markers" ? "visible" : "none";
    const heatVis = viewModeRef.current === "heatmap" ? "visible" : "none";
    ["clusters", "cluster-count", "unclustered-point-uncertainty", "unclustered-point", "unclustered-point-icon", "unclustered-report-count"].forEach((id) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", markerVis);
    });
    CONFLICT_MARKER_LAYERS.forEach((id) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", markerVis);
    });
    HEAT_LAYER_IDS.forEach((id) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", heatVis);
    });
    // The heat mode draws its own borders (heat-borders) from the same topology; the basemap's are hidden there so
    // no border is ever traced twice.
    for (const layer of map.getStyle()?.layers ?? []) {
      if ((layer.metadata as Record<string, unknown> | undefined)?.["vigil:role"] === "basemap-border") map.setLayoutProperty(layer.id, "visibility", viewModeRef.current === "heatmap" ? "none" : "visible");
    }
  };

  // Independent of applyViewModeVisibility — territorial control is its
  // own toggle, not a third mutually-exclusive value of viewMode (spec §1
  // "keep these layers architecturally independent"), so it can be on
  // alongside either markers or heatmap.
  const applyTerritorialVisibility = (map: MapLibreMap) => {
    const vis = showTerritorialRef.current ? "visible" : "none";
    TERRITORY_LAYER_IDS.forEach((id) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", vis);
    });
  };

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    registerBasemapProtocols(); // pmtiles:// and vigil-glyphs:// (each registered once per page)
    const map = new MapLibreMap({
      container: containerRef.current,
      style: styleForMode(basemapMode),
      center: [20, 25],
      zoom: 1.6,
      minZoom: 1,
      maxZoom: 22,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    appliedModeRef.current = basemapMode;
    // Hotspot labels regroup with zoom (registered once; style.load re-adds sources).
    map.on("zoomend", () => refreshReportHeatLabels(map, eventsRef.current));
    // Viewport for the bounded hazard queries (clamped: the world wraps at low zoom).
    const reportViewport = () => {
      const b = map.getBounds();
      onViewportChangeRef.current({ bbox: [Math.max(-180, b.getWest()), Math.max(-90, b.getSouth()), Math.min(180, b.getEast()), Math.min(90, b.getNorth())], zoom: map.getZoom() });
    };
    map.on("moveend", reportViewport);
    map.once("load", reportViewport);
    // Dev/test-only escape hatch: exposes the live map instance so
    // Playwright tests can compute an exact click pixel for a given
    // lng/lat via map.project(...) instead of guessing screen
    // coordinates against a canvas that overlapping floating panels
    // (timeline/filters/legend) make unreliable to eyeball. Never
    // referenced by any production code path.
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __vigilMap?: MapLibreMap }).__vigilMap = map;
    }
    // NavigationControl provides the +/- zoom buttons; mouse-wheel zoom,
    // double-click zoom, and touch pinch-zoom are all enabled by default on
    // MapLibre's interaction handlers and are never disabled here.
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");

    // Basemap tiles are a progressive enhancement: if the tile provider is
    // unreachable, fall back silently to the solid background layer instead
    // of surfacing console/network noise the user can't act on. Vector
    // layers (clusters/points/heatmap) are unaffected either way.
    map.on("error", (e) => {
      const sourceId = (e as { sourceId?: string }).sourceId;
      const provider = resolutionRef.current?.provider;
      const message = e.error?.message ?? "map error";
      if (provider && (sourceId === provider.sourceId || (!styleReadyRef.current && provider.kind === "external"))) {
        // The basemap's own source/style failed. Three tile errors (or any error before the style is ready) mean
        // the provider is unusable: fall back once. Overlay layers are unaffected either way.
        basemapErrorsRef.current++;
        if (!styleReadyRef.current || basemapErrorsRef.current >= 3) failProvider(map, message);
        return;
      }
      if (/glyph/i.test(message)) return; // counted by the glyph protocol; shown on /admin/basemap
      console.error("MapLibre error:", e.error);
    });

    // style.load fires on the initial style load AND after every
    // setStyle() call (basemap-mode switch), so this is the one place that
    // (re)creates sources and layers — it must stay idempotent-safe per
    // addEventLayers' own getSource() guard. Interactions are NOT wired here (see below).
    map.on("style.load", () => {
      styleReadyRef.current = true;
      basemapErrorsRef.current = 0;
      addEventLayers(map, eventsToGeoJSON(eventsRef.current), territorialFeaturesRef.current);
      applyHeatSurface(map);
      refreshReportHeatLabels(map, eventsRef.current);
      applyViewModeVisibility(map);
      applyTerritorialVisibility(map);
      addHazardLayers(map, hazardDataRef.current);
      applyHazardVisibility(map, hazardLayersRef.current);
      addConflictMarkerLayers(map, conflictMarkersRef.current);
      applyViewModeVisibility(map);
      publishBasemapState(map);
    });

    // A configured PMTiles archive is probed once (a 404, a non-archive file or a server without Range support is
    // a deterministic failure): fall back immediately instead of waiting for tile errors.
    const activePmtiles = resolutionRef.current?.provider.kind === "pmtiles" ? basemapConfig.pmtilesUrl : undefined;
    if (activePmtiles) {
      void probeArchive(activePmtiles).then((probe) => {
        if (!probe.ok && mapRef.current === map) failProvider(map, probe.reason ?? "archive unavailable");
      });
    }

    // Layer interactions are registered ONCE, here, not inside style.load. style.load fires again on every
    // basemap switch (setStyle), and MapLibre's layer-delegated listeners are matched by layer id at event
    // time (they simply see no features while a layer does not exist), so they survive setStyle. Registering
    // them inside style.load stacked another full set of ~20 listeners per Intel/Street/Satellite switch:
    // growing memory, and every click ran N handlers.
    // Hazard interactions. A conflict marker stacked on a hazard keeps priority (checked below);
    // clusters zoom in rather than select.
    const CONFLICT_MARKERS = ["clusters", "unclustered-point", "unclustered-point-icon"];
    const selectHazard = (e: MapLayerMouseEvent) => {
      if (map.queryRenderedFeatures(e.point, { layers: CONFLICT_MARKERS.filter((l) => map.getLayer(l)) }).length > 0) return;
      const feature = e.features?.[0];
      if (!feature) return;
      const props = feature.properties as HazardFeatureProps;
      if ((props.kind === "thermal_cluster" || props.kind === "energy_cluster") && feature.geometry.type === "Point") {
        map.easeTo({ center: feature.geometry.coordinates as [number, number], zoom: Math.min(map.getZoom() + 2.5, 8) });
        return;
      }
      // Point layers beat an area beneath them.
      if (AREA_CLICK_LAYERS.includes(feature.layer.id) && map.queryRenderedFeatures(e.point, { layers: HAZARD_CLICK_LAYERS.filter((l) => !AREA_CLICK_LAYERS.includes(l) && map.getLayer(l)) }).length > 0) return;
      onSelectHazardRef.current(props.id);
    };
    for (const layer of HAZARD_CLICK_LAYERS) {
      map.on("click", layer, selectHazard);
      map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
    }
    map.on("click", "hz-thermal-cluster", selectHazard);
    map.on("click", "hz-quake-cluster", (e: MapLayerMouseEvent) => {
      const f = e.features?.[0];
      if (f?.geometry.type === "Point") map.easeTo({ center: f.geometry.coordinates as [number, number], zoom: map.getZoom() + 2 });
    });

    for (const layer of ["conflict-halo", "conflict-core"]) {
      map.on("click", layer, (e: MapLayerMouseEvent) => {
        // Event markers stacked on a conflict marker keep priority.
        if (map.queryRenderedFeatures(e.point, { layers: [...CONFLICT_MARKERS, ...HAZARD_CLICK_LAYERS].filter((l) => map.getLayer(l)) }).length > 0) return;
        const slug = (e.features?.[0]?.properties as { slug?: string } | undefined)?.slug;
        if (slug) onSelectConflictRef.current(slug);
      });
      map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
    }

    map.on("click", "territory-fill", (e: MapLayerMouseEvent) => {
      // "Heatmap/event hotspots must remain clickable above territorial
      // polygons in Both mode" (spec §8) — MapLibre fires each layer's
      // own click handler independently by hit-testing, so a marker
      // sitting on top of a territory polygon would otherwise trigger
      // BOTH handlers for one click; querying the marker layers first
      // and yielding to them keeps markers taking priority when stacked.
      const markerHit = map.queryRenderedFeatures(e.point, {
        layers: ["clusters", "unclustered-point", "unclustered-point-icon", ...HAZARD_CLICK_LAYERS.filter((l) => !AREA_CLICK_LAYERS.includes(l) && map.getLayer(l))],
      });
      if (markerHit.length > 0) return;
      const feature = e.features?.[0];
      if (!feature) return;
      onSelectTerritoryRef.current(feature.properties as TerritoryFeatureProperties);
    });
    map.on("mouseenter", "territory-fill", () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "territory-fill", () => {
      map.getCanvas().style.cursor = "";
    });

    map.on("click", "clusters", (e: MapLayerMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, { layers: ["clusters"] });
      const feature = features[0];
      if (!feature || feature.geometry.type !== "Point") return;
      map.easeTo({ center: feature.geometry.coordinates as [number, number], zoom: map.getZoom() + 2 });
    });
    const selectFromFeature = (e: MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const props = feature.properties as EventFeatureProps;
      const match = eventsRef.current.find((ev) => ev.id === props.id);
      if (match) onSelectRef.current(match);
    };
    map.on("click", "unclustered-point", selectFromFeature);
    map.on("click", "unclustered-point-icon", selectFromFeature);
    ["clusters", "unclustered-point", "unclustered-point-icon"].forEach((layer) => {
      map.on("mouseenter", layer, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", layer, () => {
        map.getCanvas().style.cursor = "";
      });
    });

    return () => {
      map.remove();
      mapRef.current = null;
      if (process.env.NODE_ENV !== "production") {
        delete (window as unknown as { __vigilMap?: MapLibreMap }).__vigilMap;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial mount only; basemapMode changes are handled by the effect below via setStyle so the map is never re-created.
  }, []);

  // Switching basemap mode calls setStyle() rather than re-creating the map,
  // which is what preserves center/zoom/bearing/pitch/selection across
  // Intel/Street/Satellite switches (setStyle never touches the camera).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // Skip the render that mounts the map — its initial style already
    // matches basemapMode via the constructor above.
    if (appliedModeRef.current === basemapMode) {
      publishBasemapState(map);
      return;
    }
    appliedModeRef.current = basemapMode;
    styleReadyRef.current = false;
    map.setStyle(styleForMode(basemapMode));
    publishBasemapState(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemapMode]);

  useEffect(() => {
    if (!heatField) return;
    let cancelled = false;
    const frame = window.setTimeout(() => {
      const canvas = renderHeatCanvas(heatField, { projection: "mercator", width: HEAT_TEXTURE_WIDTH });
      canvas.toBlob((blob) => {
        if (cancelled || !blob) return;
        const previous = heatUrlRef.current;
        heatUrlRef.current = URL.createObjectURL(blob);
        const map = mapRef.current;
        if (map) applyHeatSurface(map);
        if (previous) setTimeout(() => URL.revokeObjectURL(previous), 3000);
      }, "image/png");
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(frame);
    };
  }, [heatField]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    (map.getSource("events") as GeoJSONSource | undefined)?.setData(eventsToGeoJSON(events));
    refreshReportHeatLabels(map, events);
  }, [events]);

  // Territorial polygons update the same way playback updates events — a
  // setData() on the existing source, never a rebuilt source/layer, so an
  // asOf-driven refetch (or a playback tick) never re-runs addEventLayers
  // (spec §10 "do not refetch/rebuild unchanged geometry every animation
  // frame").
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    (map.getSource("territory") as GeoJSONSource | undefined)?.setData(territorialFeatures);
  }, [territorialFeatures]);

  // Visibility is applied whenever the toggle changes — deliberately NOT
  // gated on map.isStyleLoaded(). That flag is false any time a source is
  // still loading tiles/data (constantly, on a live map), so gating on it
  // silently DROPPED the toggle: the legend (React state) said "Territorial
  // Control on" while the layers stayed hidden and no polygon ever rendered.
  // The helpers no-op for layers that don't exist yet, and the style.load
  // handler re-applies the current refs once they do.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    applyViewModeVisibility(map);
  }, [viewMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    applyTerritorialVisibility(map);
  }, [showTerritorial]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus) return;
    // Camera moves are valid before the style finishes loading. Animated only when asked to (Live View) and the
    // user has not asked for reduced motion.
    const reduce = (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true) || useAppStore.getState().contentSensitivity === "reduced";
    if (focus.animate && !reduce) map.flyTo({ center: [focus.lng, focus.lat], zoom: focus.zoom, duration: 1400, essential: false });
    else map.jumpTo({ center: [focus.lng, focus.lat], zoom: focus.zoom });
  }, [focus]);

  useEffect(() => {
    if (holdCamera) mapRef.current?.stop();
  }, [holdCamera]);

  useEffect(() => {
    const map = mapRef.current;
    const src = map?.getSource("active-conflicts") as GeoJSONSource | undefined;
    src?.setData(conflictMarkersToGeoJSON(activeConflicts));
  }, [activeConflicts]);

  // Hazard data and toggles: setData on the existing sources (never rebuilt), visibility per layer.
  const hazardData = useMemo(() => (hazards ? hazardsToSources(hazards.features) : EMPTY_HAZARD_SOURCES), [hazards]);
  useEffect(() => {
    hazardDataRef.current = hazardData;
    const map = mapRef.current;
    if (map) setHazardData(map, hazardData);
  }, [hazardData]);
  const hazardLayerKey = hazardLayers.join(",");
  useEffect(() => {
    const map = mapRef.current;
    if (map) applyHazardVisibility(map, hazardLayers);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the joined list
  }, [hazardLayerKey]);

  return (
    <div className={className} style={{ position: "relative" }} data-heat-signature={heatField?.signature} data-heat-peak={heatField ? Math.round(heatField.peak) : undefined} data-hazard-layers={hazardLayerKey} data-hazard-count={hazards ? hazards.features.length : 0}>
      <div ref={containerRef} className="h-full w-full" role="application" aria-label="Operational conflict map" />
      {viewMode === "heatmap" && <HeatLegend className="absolute bottom-32 left-3 z-10 sm:bottom-7" />}
      {basemapNotice && (
        <div className="pointer-events-none absolute bottom-3 left-3 z-10 max-w-xs rounded-lg border border-border bg-surface/90 px-3 py-2 text-xs text-ink-faint backdrop-blur" data-testid="basemap-notice" title={basemapNotice.detail}>
          {basemapNotice.text}
        </div>
      )}
    </div>
  );
}
