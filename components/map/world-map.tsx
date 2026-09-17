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
import { SEVERITY_HEX } from "@/lib/utils/severity";
import { MOCK_NOW } from "@/lib/data/constants";

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
  className?: string;
}

function addEventLayers(
  map: MapLibreMap,
  initialData: GeoJSON.FeatureCollection,
  initialHeatData: GeoJSON.FeatureCollection,
  initialConflictBaseData: GeoJSON.FeatureCollection,
) {
  // A basemap-mode switch calls setStyle(), which discards every source and
  // layer added imperatively (they aren't part of the new style document),
  // so this whole setup must be safely re-runnable, not just mount-once.
  if (map.getSource("events")) return;

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
  // reused here, scaled far wider than the old fixed 26px heatmap-radius,
  // so a major event visibly dominates its area while a minor one stays
  // modest.
  const eventHeatRadius: DataDrivenPropertyValueSpecification<number> = [
    "interpolate",
    ["linear"],
    ["get", "importance"],
    20,
    46,
    55,
    85,
    100,
    150,
  ];
  // Opacity = corroboration x recency (spec #5/#6), multiplied rather than
  // added so neither factor alone can force full strength: a single-source
  // report stays modest even if brand new, and a heavily-corroborated
  // report still fades once old.
  const eventHeatOpacity: DataDrivenPropertyValueSpecification<number> = [
    "*",
    ["interpolate", ["linear"], ["get", "sourceCount"], 1, 0.4, 3, 0.75, 8, 1],
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

export function WorldMap({ events, viewMode, basemapMode, onSelectEvent, className }: WorldMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const eventsRef = useRef(events);
  const onSelectRef = useRef(onSelectEvent);
  const viewModeRef = useRef(viewMode);
  const appliedModeRef = useRef<MapBasemapMode | null>(null);
  const apiKey = getMapTilerKey();
  const [missingKeyNotice, setMissingKeyNotice] = useState(false);

  useEffect(() => {
    eventsRef.current = events;
    onSelectRef.current = onSelectEvent;
    viewModeRef.current = viewMode;
  });

  const applyViewModeVisibility = (map: MapLibreMap) => {
    const markerVis = viewModeRef.current === "markers" ? "visible" : "none";
    const heatVis = viewModeRef.current === "heatmap" ? "visible" : "none";
    ["clusters", "cluster-count", "unclustered-point", "unclustered-point-icon"].forEach((id) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", markerVis);
    });
    HEAT_LAYER_IDS.forEach((id) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", heatVis);
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
      );
      applyViewModeVisibility(map);

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

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    applyViewModeVisibility(map);
  }, [viewMode]);

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
