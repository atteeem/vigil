"use client";

import { useEffect, useRef } from "react";
import { Map as MapLibreMap, config as maplibreConfig } from "maplibre-gl";
import { getBasemapStyle } from "@/lib/map/basemap";
import { registerBasemapProtocols } from "@/lib/map/register-protocols";
import type { TerritorialGeometry } from "@/lib/types/territorial-control";

if (typeof window !== "undefined") {
  maplibreConfig.WORKER_URL = "/maplibre-gl-worker.mjs";
}

function bbox(geometry: TerritorialGeometry): [[number, number], [number, number]] {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  const rings = geometry.type === "Polygon" ? geometry.coordinates : geometry.coordinates.flat();
  for (const ring of rings) {
    for (const point of ring) {
      const lng = point[0] ?? 0;
      const lat = point[1] ?? 0;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}

// Admin geometry entry is a raw GeoJSON textarea (spec §6 "prefer a simple
// map drawing/editing tool if compatible" — a full draw tool was out of
// scope for this milestone, see ARCHITECTURE.md/TASKS.md for the
// deferred-enhancement note); this preview is what satisfies "preview"
// concretely — a small read-only map rendering exactly the pasted
// geometry, so an admin can visually verify placement/shape before
// publishing without a full editor.
export function TerritoryGeometryPreview({ geometry }: { geometry: TerritorialGeometry | null }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    registerBasemapProtocols();
    const map = new MapLibreMap({
      container: containerRef.current,
      style: getBasemapStyle("intel"),
      center: [20, 25],
      zoom: 1,
      attributionControl: false,
    });
    mapRef.current = map;
    map.on("style.load", () => {
      map.addSource("preview", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "preview-fill", type: "fill", source: "preview", paint: { "fill-color": "#4CC2FF", "fill-opacity": 0.35 } });
      map.addLayer({ id: "preview-outline", type: "line", source: "preview", paint: { "line-color": "#4CC2FF", "line-width": 2 } });
    });
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const source = map.getSource("preview") as { setData: (d: GeoJSON.FeatureCollection) => void } | undefined;
      if (!source) return;
      if (!geometry) {
        source.setData({ type: "FeatureCollection", features: [] });
        return;
      }
      source.setData({ type: "FeatureCollection", features: [{ type: "Feature", geometry, properties: {} }] });
      try {
        map.fitBounds(bbox(geometry), { padding: 24, maxZoom: 10, duration: 0 });
      } catch {
        // Degenerate/empty geometry — leave the camera where it was.
      }
    };
    if (map.isStyleLoaded()) apply();
    else map.once("style.load", apply);
  }, [geometry]);

  return (
    <div
      ref={containerRef}
      data-testid="territory-geometry-preview"
      className="h-48 w-full overflow-hidden rounded-lg border border-border"
    />
  );
}
