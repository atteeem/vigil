"use client";

import { useEffect, useRef } from "react";
import {
  Map as MapLibreMap,
  NavigationControl,
  config as maplibreConfig,
  type GeoJSONSource,
  type MapLayerMouseEvent,
} from "maplibre-gl";
import type { ConflictEvent } from "@/lib/types";
import { DARK_MAP_STYLE } from "@/lib/map/style";
import { eventsToGeoJSON, type EventFeatureProps } from "@/lib/map/events-to-geojson";
import { SEVERITY_HEX } from "@/lib/utils/severity";

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
  onSelectEvent: (event: ConflictEvent) => void;
  className?: string;
}

export function WorldMap({ events, viewMode, onSelectEvent, className }: WorldMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const eventsRef = useRef(events);
  const onSelectRef = useRef(onSelectEvent);

  useEffect(() => {
    eventsRef.current = events;
    onSelectRef.current = onSelectEvent;
  });

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new MapLibreMap({
      container: containerRef.current,
      style: DARK_MAP_STYLE,
      center: [20, 25],
      zoom: 1.6,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
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

    map.on("load", () => {
      map.addSource("events", {
        type: "geojson",
        data: eventsToGeoJSON(eventsRef.current),
        cluster: true,
        clusterMaxZoom: 7,
        clusterRadius: 46,
      });

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
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["get", "importance"], 40, 5, 100, 9],
          "circle-color": [
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
          ],
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "rgba(8,10,13,0.85)",
        },
      });
      map.addLayer({
        id: "events-heatmap",
        type: "heatmap",
        source: "events",
        layout: { visibility: "none" },
        paint: {
          "heatmap-weight": ["interpolate", ["linear"], ["get", "importance"], 0, 0, 100, 1],
          "heatmap-intensity": 1.1,
          "heatmap-radius": 26,
          "heatmap-color": [
            "interpolate",
            ["linear"],
            ["heatmap-density"],
            0,
            "rgba(76,194,255,0)",
            0.3,
            "rgba(228,196,65,0.5)",
            0.6,
            "rgba(240,146,59,0.7)",
            1,
            "rgba(179,18,43,0.9)",
          ],
        },
      });

      map.on("click", "clusters", (e: MapLayerMouseEvent) => {
        const features = map.queryRenderedFeatures(e.point, { layers: ["clusters"] });
        const feature = features[0];
        if (!feature || feature.geometry.type !== "Point") return;
        map.easeTo({ center: feature.geometry.coordinates as [number, number], zoom: map.getZoom() + 2 });
      });
      map.on("click", "unclustered-point", (e: MapLayerMouseEvent) => {
        const feature = e.features?.[0];
        if (!feature) return;
        const props = feature.properties as EventFeatureProps;
        const match = eventsRef.current.find((ev) => ev.id === props.id);
        if (match) onSelectRef.current(match);
      });
      ["clusters", "unclustered-point"].forEach((layer) => {
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
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const source = map.getSource("events") as GeoJSONSource | undefined;
    source?.setData(eventsToGeoJSON(events));
  }, [events]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const markerVis = viewMode === "markers" ? "visible" : "none";
    const heatVis = viewMode === "heatmap" ? "visible" : "none";
    ["clusters", "cluster-count", "unclustered-point"].forEach((id) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", markerVis);
    });
    if (map.getLayer("events-heatmap")) {
      map.setLayoutProperty("events-heatmap", "visibility", heatVis);
    }
  }, [viewMode]);

  return <div ref={containerRef} className={className} role="application" aria-label="Operational conflict map" />;
}
