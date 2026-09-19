"use client";

import { useEffect, useRef, useState } from "react";
import {
  Map as MapLibreMap,
  NavigationControl,
  config as maplibreConfig,
  type GeoJSONSource,
  type MapLayerMouseEvent,
  type DataDrivenPropertyValueSpecification,
} from "maplibre-gl";
import type { ConflictEvent } from "@/lib/types";
import { EVENT_TYPES } from "@/lib/types";
import { getMapStyle, getMapTilerKey, type MapBasemapMode } from "@/lib/map/style";
import { eventsToGeoJSON, type EventFeatureProps } from "@/lib/map/events-to-geojson";
import { eventsToHeatGeoJSON, conflictBaseGeoJSON } from "@/lib/map/heat-layers";
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
  initialHeatData: GeoJSON.FeatureCollection,
  initialConflictBaseData: GeoJSON.FeatureCollection,
  initialTerritoryData: GeoJSON.FeatureCollection,
) {
  // A basemap-mode switch calls setStyle(), which discards every source and
  // layer added imperatively (they aren't part of the new style document),
  // so this whole setup must be safely re-runnable, not just mount-once.
  if (map.getSource("events")) return;

  // Territorial polygons are added FIRST so they render beneath every
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
  });
  // Separate, uncluster-ed sources for heatmap mode — clustering the
  // "events" source above is specifically for the marker-mode point/icon
  // layers (grouping nearby pins at low zoom); the heat visualization
  // needs every individual event's own severity/recency/corroboration,
  // and a second, pre-aggregated per-conflict source for the broader
  // "ongoing conflict" base glow (see lib/map/heat-layers.ts).
  map.addSource("events-heat", { type: "geojson", data: initialHeatData });
  map.addSource("conflict-bases", { type: "geojson", data: initialConflictBaseData });

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
      "text-field": "{point_count_abbreviated}",
      "text-font": ["Noto Sans Regular"],
      "text-size": 12,
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
      "circle-radius": ["interpolate", ["linear"], ["get", "importance"], 40, 5, 100, 9],
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
  // Conflict base layer (spec #4): a wide, soft, severity-colored glow per
  // ongoing conflict, sized by the geographic spread of its own events —
  // rendered BELOW the per-event hotspots so a sustained conflict reads as
  // a broad affected area, not just a cluster of isolated dots. Opacity
  // only nudges up mildly with how many events feed it (eventCount, capped
  // at a modest 0.42) — a mild "more corroborated as an ongoing situation"
  // signal, never enough on its own to look "severe"; color is entirely
  // driven by the group's worst severity (see conflictBaseGeoJSON), never
  // by event count, so this can never become a wrongly-red area purely
  // from report volume. Recency-independent — an active conflict's base
  // presence persists through reporting gaps (spec #6), so no age input.
  //
  // spreadKm is the conflict's own events' geographic extent; the floor
  // (110px even for a tight/single-point cluster) is what makes a
  // sustained conflict read as a broad AREA rather than a dot the moment
  // it has 2+ events, and the interpolation scales up sharply for
  // genuinely regional conflicts (spec's West Bank example).
  const conflictBaseRadius: DataDrivenPropertyValueSpecification<number> = [
    "interpolate",
    ["linear"],
    ["get", "spreadKm"],
    0,
    110,
    50,
    160,
    200,
    260,
    600,
    380,
  ];
  const conflictBaseOpacity: DataDrivenPropertyValueSpecification<number> = [
    "interpolate",
    ["linear"],
    ["get", "eventCount"],
    1,
    0.22,
    6,
    0.42,
  ];
  // Each "heat glow" (conflict base and individual event alike) is three
  // concentric circles sharing one center rather than one blurred disc —
  // MapLibre's circle-blur alone fades a single circle's own edge, but
  // many overlapping same-severity blobs in a dense area still composite
  // toward a fairly solid-looking core with only the outermost boundary
  // visibly soft. Stacking a wide/faint outer ring, a medium ring, and a
  // small/denser core (same shape, just radius/opacity scaled down and
  // blur reduced toward the center) reads unambiguously as "transparent
  // at the edges, strongest at the center" — spec #1's smooth radial
  // gradient requirement — regardless of how many neighboring glows
  // overlap it.
  const GRADIENT_RINGS = [
    { suffix: "outer", radiusScale: 1, opacityScale: 0.32, blur: 1 },
    { suffix: "mid", radiusScale: 0.62, opacityScale: 0.62, blur: 0.9 },
    { suffix: "core", radiusScale: 0.3, opacityScale: 1, blur: 0.75 },
  ] as const;
  for (const ring of GRADIENT_RINGS) {
    map.addLayer({
      id: `conflict-base-heat-${ring.suffix}`,
      type: "circle",
      source: "conflict-bases",
      layout: { visibility: "none" },
      paint: {
        "circle-radius": ring.radiusScale === 1 ? conflictBaseRadius : ["*", conflictBaseRadius, ring.radiusScale],
        "circle-color": SEVERITY_COLOR_MATCH,
        "circle-opacity":
          ring.opacityScale === 1 ? conflictBaseOpacity : ["*", conflictBaseOpacity, ring.opacityScale],
        "circle-blur": ring.blur,
      },
    });
  }

  // Scope (spec #3): importance is the existing "how significant is this
  // incident" scalar (already drives marker size in markers mode) —
  // reused here so a major event visibly dominates its area while a minor
  // one stays modest. Kept well under conflictBaseRadius's own 110px floor
  // (above) even at max importance, so a single local incident can never
  // out-size the broad glow reserved for a genuinely regional/ongoing
  // conflict — only spreadKm (a conflict's own geographic extent) earns
  // that larger radius.
  const eventHeatRadius: DataDrivenPropertyValueSpecification<number> = [
    "interpolate",
    ["linear"],
    ["get", "importance"],
    20,
    16,
    55,
    32,
    100,
    58,
  ];
  // Opacity = confidence x recency (Central Conflict Scoring Engine §7
  // "confidence influences opacity"), multiplied rather than added so
  // neither factor alone can force full strength: a low-confidence report
  // stays modest even if brand new, and a well-evidenced report still
  // fades once old. confidenceScore (lib/scoring/confidence.ts, computed
  // in lib/map/heat-layers.ts) replaces the previous direct sourceCount
  // interpolation — the same formula admin/conflict views use, not a
  // second ad hoc one living only here.
  const eventHeatOpacity: DataDrivenPropertyValueSpecification<number> = [
    "*",
    ["interpolate", ["linear"], ["get", "confidenceScore"], 30, 0.4, 60, 0.75, 90, 1],
    ["interpolate", ["linear"], ["get", "ageHours"], 0, 1, 24, 0.65, 168, 0.25, 720, 0.08],
  ];
  for (const ring of GRADIENT_RINGS) {
    map.addLayer({
      id: `events-heat-${ring.suffix}`,
      type: "circle",
      source: "events-heat",
      layout: { visibility: "none" },
      paint: {
        "circle-radius": ring.radiusScale === 1 ? eventHeatRadius : ["*", eventHeatRadius, ring.radiusScale],
        // Color = severity, per event, never touched by nearby report
        // volume (spec #1/#7) — same match expression the marker layers use.
        "circle-color": SEVERITY_COLOR_MATCH,
        "circle-opacity": ring.opacityScale === 1 ? eventHeatOpacity : ["*", eventHeatOpacity, ring.opacityScale],
        "circle-blur": ring.blur,
      },
    });
  }
}

const HEAT_LAYER_IDS = [
  "conflict-base-heat-outer",
  "conflict-base-heat-mid",
  "conflict-base-heat-core",
  "events-heat-outer",
  "events-heat-mid",
  "events-heat-core",
];

export function WorldMap({
  events,
  viewMode,
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
    ["clusters", "cluster-count", "unclustered-point-uncertainty", "unclustered-point", "unclustered-point-icon"].forEach((id) => {
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
      addEventLayers(
        map,
        eventsToGeoJSON(eventsRef.current),
        eventsToHeatGeoJSON(eventsRef.current, MOCK_NOW),
        conflictBaseGeoJSON(eventsRef.current),
        territorialFeaturesRef.current,
      );
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
    const map = mapRef.current;
    if (!map) return;
    (map.getSource("events") as GeoJSONSource | undefined)?.setData(eventsToGeoJSON(events));
    (map.getSource("events-heat") as GeoJSONSource | undefined)?.setData(eventsToHeatGeoJSON(events, MOCK_NOW));
    (map.getSource("conflict-bases") as GeoJSONSource | undefined)?.setData(conflictBaseGeoJSON(events));
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

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    applyViewModeVisibility(map);
  }, [viewMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    applyTerritorialVisibility(map);
  }, [showTerritorial]);

  return (
    <div className={className} style={{ position: "relative" }}>
      <div ref={containerRef} className="h-full w-full" role="application" aria-label="Operational conflict map" />
      {missingKeyNotice && (
        <div className="pointer-events-none absolute bottom-3 left-3 z-10 max-w-xs rounded-lg border border-border bg-surface/90 px-3 py-2 text-xs text-ink-faint backdrop-blur">
          Street/Satellite need a MapTiler key. Add <code className="text-ink-dim">NEXT_PUBLIC_MAPTILER_KEY</code> to{" "}
          <code className="text-ink-dim">.env.local</code> — showing the Intel fallback basemap for now.
        </div>
      )}
    </div>
  );
}
