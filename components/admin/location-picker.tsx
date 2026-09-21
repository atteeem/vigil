"use client";

import { useEffect, useRef, useState } from "react";
import { Map as MapLibreMap, Marker, config as maplibreConfig } from "maplibre-gl";
import { Search, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getBasemapStyle } from "@/lib/map/basemap";
import { registerBasemapProtocols } from "@/lib/map/register-protocols";
import type { LocationCandidateDTO } from "@/lib/types/db";

if (typeof window !== "undefined") {
  // Same Turbopack worker-URL workaround as components/map/world-map.tsx.
  maplibreConfig.WORKER_URL = "/maplibre-gl-worker.mjs";
}

export interface LocationValue {
  lat: string;
  lng: string;
  locationName: string;
  countryCode: string;
  region: string;
}

/**
 * Search place → geocoder candidates → human picks → manual lat/lng
 * adjustment → marker preview (spec §4). Never auto-selects when a search
 * returns more than one candidate — the caller decides, same rule the
 * automated draft-extraction heuristic follows for ambiguous names.
 */
export function LocationPicker({
  value,
  onChange,
  ambiguousCandidates,
}: {
  value: LocationValue;
  onChange: (patch: Partial<LocationValue>) => void;
  /** Pre-supplied candidates from an ambiguous automated match (spec §4's
   * "Novoselivka" example) — shown immediately without a search click. */
  ambiguousCandidates?: LocationCandidateDTO[];
}) {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<LocationCandidateDTO[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    registerBasemapProtocols();
    const map = new MapLibreMap({
      container: containerRef.current,
      style: getBasemapStyle("intel"),
      center: [20, 25],
      zoom: 1,
      attributionControl: false,
      interactive: true,
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    // Number("") is 0, not NaN — an explicit empty-string check first is
    // required so an unset field doesn't get treated as a real "0,0" pin.
    if (!map || value.lat.trim() === "" || value.lng.trim() === "") return;
    const lat = Number(value.lat);
    const lng = Number(value.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    // Always remove+recreate rather than reusing markerRef across renders:
    // under React StrictMode's dev-only double-invoke, the map-creation
    // effect above tears down and rebuilds the map instance once before
    // settling, and a reused marker would stay bound to that first
    // (already-removed) map — recreating fresh here every time is what
    // makes this correct regardless of how many times that happens.
    const marker = new Marker({ color: "#EF4B4B" }).setLngLat([lng, lat]).addTo(map);
    markerRef.current = marker;
    map.easeTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 5), duration: 400 });

    return () => {
      marker.remove();
      if (markerRef.current === marker) markerRef.current = null;
    };
  }, [value.lat, value.lng]);

  async function search() {
    if (!query.trim()) return;
    setSearching(true);
    setSearchError(null);
    try {
      const res = await fetch(`/api/admin/geocode?q=${encodeURIComponent(query)}`);
      if (!res.ok) throw new Error((await res.json()).error ?? "Search failed");
      setResults(await res.json());
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setSearching(false);
    }
  }

  function selectCandidate(c: LocationCandidateDTO) {
    onChange({
      lat: String(c.lat),
      lng: String(c.lng),
      locationName: c.label,
      countryCode: c.countryCode?.toUpperCase() ?? value.countryCode,
      region: c.region ?? value.region,
    });
    setResults([]);
  }

  return (
    <div className="space-y-2">
      {ambiguousCandidates && ambiguousCandidates.length > 1 && (
        <div className="rounded-lg border border-high/30 bg-high/10 p-2.5 text-xs">
          <p className="mb-1.5 font-medium text-high">
            Ambiguous location — {ambiguousCandidates.length} possible matches, none selected automatically:
          </p>
          <ul className="space-y-1">
            {ambiguousCandidates.map((c, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => selectCandidate(c)}
                  className="text-left text-accent hover:underline"
                >
                  {c.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex gap-1.5">
        <input
          aria-label="Search place"
          className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
          placeholder="Search place name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), search())}
        />
        <Button type="button" size="sm" variant="outline" onClick={search} disabled={searching}>
          {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
        </Button>
      </div>
      {searchError && <p className="text-xs text-high">{searchError}</p>}
      {results.length > 0 && (
        <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-border bg-surface p-1.5">
          {results.map((c, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => selectCandidate(c)}
                className="w-full rounded px-2 py-1 text-left text-xs text-ink-dim hover:bg-white/5 hover:text-ink"
              >
                {c.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      {results.length === 0 && !searching && query && !searchError && (
        <p className="text-xs text-ink-faint">No matches — click Search, or set latitude/longitude manually below.</p>
      )}

      <div ref={containerRef} className="h-40 w-full overflow-hidden rounded-lg border border-border" />
    </div>
  );
}
