"use client";

import { useEffect, useRef, useState } from "react";
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
import { getMapStyle, getMapTilerKey, type MapBasemapMode } from "@/lib/map/style";
import { eventsToGeoJSON, type EventFeatureProps } from "@/lib/map/events-to-geojson";
import { useHeatField } from "@/hooks/use-heat-field";
import { renderHeatCanvas, MERCATOR_MAX_LAT } from "@/lib/heat/render";
import { getHeatBorders } from "@/lib/heat/borders";
import { HeatLegend } from "@/components/heat/heat-legend";
import { aggregateReportBuckets, formatReportCount, REPORT_COUNT_CAP } from "@/lib/map/report-counts";
import { createEventIconImageData } from "@/lib/map/event-icons";
import { createContestedPatternImageData } from "@/lib/map/territorial-pattern";
import { SEVERITY_HEX } from "@/lib/utils/severity";
import { MOCK_NOW } from "@/lib/data/constants";
import type { TerritoryFeatureProperties } from "@/lib/types/territorial-control";

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
  className?: string;
}

const EMPTY_FEATURE_COLLECTION: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

// Territorial Control Mode — status is encoded on more than color alone
// (spec §3): fill-opacity AND outline dash pattern both vary by status,
// plus a dedicated hatch overlay for "contested" and a bright highlight
// outline for "recently_changed", so the distinction survives even for a
// colorblind viewer or an actor-less (uncertain) polygon with no actor
// color to lean on.
const TERRITORY_FILL_OPACITY: DataDrivenPropertyValueSpecification<number> = [
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
  "match",
  ["get", "status"],
  "uncertain",
  0.55,
  0.9,
];

const TERRITORY_LAYER_IDS = [
  "territory-fill",
  "territory-contested-hatch",
  "territory-outline",
  "territory-outline-dashed",
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
    filter: ["==", ["get", "status"], "contested"],
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
    filter: ["in", ["get", "status"], ["literal", ["contested", "uncertain"]]],
    layout: { visibility: "none" },
    paint: {
      "line-color": "#f3f5f7",
      "line-width": 1.5,
      "line-opacity": 0.7,
      "line-dasharray": ["match", ["get", "status"], "uncertain", ["literal", [1, 2]], ["literal", [3, 2]]],
    },
  });
  map.addLayer({
    id: "territory-recently-changed-highlight",
    type: "line",
    source: "territory",
    filter: ["==", ["get", "status"], "recently_changed"],
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
    clusterProperties: { reports: ["+", ["get", "reportCount"]] },
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
      "circle-radius": ["step", ["get", "point_count"], 16, 8, 22, 24, 30],
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
      "text-size": 12,
      "text-allow-overlap": true,
    },
    paint: { "text-color": "#F3F5F7" },
  });
  // Location-precision uncertainty: an event whose position is only
  // approximate / area-level / unknown gets a soft, oversized halo instead
  // of looking like an exact pin. Only an explicit non-exact precision draws
  // one (mock/legacy events with no precision are unchanged).
  map.addLayer({
    id: "unclustered-point-uncertainty",
    type: "circle",
    source: "events",
    filter: ["all", ["!", ["has", "point_count"]], ["in", ["get", "precision"], ["literal", ["approximate", "area_level", "unknown"]]]],
    paint: {
      "circle-radius": ["match", ["get", "precision"], "approximate", 16, "area_level", 30, "unknown", 24, 0],
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
      "circle-radius": ["interpolate", ["linear"], ["get", "importance"], 40, 8, 100, 11],
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
      "text-size": 10,
      "text-allow-overlap": true,
      "text-ignore-placement": true,
      "text-offset": ["step", ["zoom"], ["literal", [0, 0]], ICON_DETAIL_ZOOM, ["literal", [1.3, -1.3]]],
    },
    paint: { "text-color": "#F3F5F7", "text-halo-color": "rgba(8,10,13,0.85)", "text-halo-width": 1.2 },
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
    events.map((e) => ({ id: e.id, lat: e.lat, lng: e.lng, sources: e.sources, sourceCount: e.sourceCount })),
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
  nowIso = MOCK_NOW,
  live = true,
  basemapMode,
  onSelectEvent,
  territorialFeatures = EMPTY_FEATURE_COLLECTION,
  showTerritorial = false,
  onSelectTerritory = () => {},
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
  const appliedModeRef = useRef<MapBasemapMode | null>(null);
  const apiKey = getMapTilerKey();
  const [missingKeyNotice, setMissingKeyNotice] = useState(false);
  const heatUrlRef = useRef<string | null>(null);

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
  });

  const applyViewModeVisibility = (map: MapLibreMap) => {
    const markerVis = viewModeRef.current === "markers" ? "visible" : "none";
    const heatVis = viewModeRef.current === "heatmap" ? "visible" : "none";
    ["clusters", "cluster-count", "unclustered-point-uncertainty", "unclustered-point", "unclustered-point-icon", "unclustered-report-count"].forEach((id) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", markerVis);
    });
    HEAT_LAYER_IDS.forEach((id) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", heatVis);
    });
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

    const map = new MapLibreMap({
      container: containerRef.current,
      style: getMapStyle(basemapMode, apiKey),
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
      if (sourceId === "vigil-basemap") return;
      console.error("MapLibre error:", e.error);
    });

    // style.load fires on the initial style load AND after every
    // setStyle() call (basemap-mode switch), so this is the one place that
    // (re)wires source/layers/interactions — it must stay idempotent-safe
    // per addEventLayers' own getSource() guard.
    map.on("style.load", () => {
      addEventLayers(map, eventsToGeoJSON(eventsRef.current), territorialFeaturesRef.current);
      applyHeatSurface(map);
      refreshReportHeatLabels(map, eventsRef.current);
      applyViewModeVisibility(map);
      applyTerritorialVisibility(map);

      map.on("click", "territory-fill", (e: MapLayerMouseEvent) => {
        // "Heatmap/event hotspots must remain clickable above territorial
        // polygons in Both mode" (spec §8) — MapLibre fires each layer's
        // own click handler independently by hit-testing, so a marker
        // sitting on top of a territory polygon would otherwise trigger
        // BOTH handlers for one click; querying the marker layers first
        // and yielding to them keeps markers taking priority when stacked.
        const markerHit = map.queryRenderedFeatures(e.point, {
          layers: ["clusters", "unclustered-point", "unclustered-point-icon"],
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
    setMissingKeyNotice(basemapMode !== "intel" && !apiKey);
    // Skip the render that mounts the map — its initial style already
    // matches basemapMode via the constructor above.
    if (appliedModeRef.current === basemapMode) return;
    appliedModeRef.current = basemapMode;
    map.setStyle(getMapStyle(basemapMode, apiKey));
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

  return (
    <div className={className} style={{ position: "relative" }} data-heat-signature={heatField?.signature} data-heat-peak={heatField ? Math.round(heatField.peak) : undefined}>
      <div ref={containerRef} className="h-full w-full" role="application" aria-label="Operational conflict map" />
      {viewMode === "heatmap" && <HeatLegend className="absolute bottom-20 left-3 z-10 sm:bottom-7" />}
      {missingKeyNotice && (
        <div className="pointer-events-none absolute bottom-3 left-3 z-10 max-w-xs rounded-lg border border-border bg-surface/90 px-3 py-2 text-xs text-ink-faint backdrop-blur">
          Street/Satellite need a MapTiler key. Add <code className="text-ink-dim">NEXT_PUBLIC_MAPTILER_KEY</code> to{" "}
          <code className="text-ink-dim">.env.local</code> — showing the Intel fallback basemap for now.
        </div>
      )}
    </div>
  );
}
