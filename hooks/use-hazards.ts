"use client";

import { useEffect, useRef, useState } from "react";
import type { HazardCollection } from "@/lib/hazards/public-types";
import { HAZARD_LAYERS, type HazardLayer } from "@/lib/hazards/types";

const POLL_INTERVAL_MS = 30_000;
const EMPTY: HazardCollection | null = null;

export interface HazardViewport {
  /** [west, south, east, north] */
  bbox: [number, number, number, number];
  zoom: number;
}

/**
 * Natural-hazard layers for /world. Same single timeline as events and territory: `asOf` null polls
 * live; a set `asOf` (including every playback tick) fetches once per distinct key and caches it, with
 * an AbortController so a superseded request is cancelled. The viewport is quantised (whole degrees,
 * half-zoom steps) so panning a little does not refetch, and requests are debounced — the server only
 * ever returns a bounded, zoom-aggregated set, never raw observation tables.
 */
export function useHazards(layers: readonly HazardLayer[], asOf: Date | null, viewport: HazardViewport | null, prefetchAsOf?: Date | null): { data: HazardCollection | null; loading: boolean } {
  const [data, setData] = useState<HazardCollection | null>(EMPTY);
  const [loading, setLoading] = useState(false);
  const cache = useRef(new Map<string, HazardCollection>());
  const layerKey = HAZARD_LAYERS.filter((l) => layers.includes(l)).join(",");
  const asOfTime = asOf ? asOf.getTime() : null;
  const prefetchTime = prefetchAsOf ? prefetchAsOf.getTime() : null;

  const vp = viewport
    ? { bbox: viewport.bbox.map((n, i) => (i < 2 ? Math.floor(n) : Math.ceil(n))).join(","), zoom: Math.floor(viewport.zoom * 2) / 2 }
    : null;
  const vpKey = vp ? `${vp.bbox}|${vp.zoom}` : "world";

  const urlFor = (at: number | null) => {
    const p = new URLSearchParams({ layers: layerKey });
    if (at !== null) p.set("at", new Date(at).toISOString());
    if (vp) {
      p.set("bbox", vp.bbox);
      p.set("zoom", String(vp.zoom));
    }
    return `/api/hazards?${p.toString()}`;
  };

  useEffect(() => {
    if (!layerKey) return; // nothing selected: the returned data is null regardless of what was last fetched
    let cancelled = false;
    const controller = new AbortController();
    const key = `${layerKey}|${vpKey}|${asOfTime ?? "live"}`;

    async function load(useCache: boolean) {
      const cached = useCache ? cache.current.get(key) : undefined;
      if (cached) {
        setData(cached);
        return;
      }
      setLoading(true);
      try {
        const res = await fetch(urlFor(asOfTime), { signal: controller.signal });
        if (!res.ok) return;
        const json = (await res.json()) as HazardCollection;
        if (asOfTime !== null) cache.current.set(key, json);
        if (!cancelled) setData(json);
      } catch {
        // Network hiccup or an intentional abort: keep the last known set.
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    const timer = setTimeout(() => load(asOfTime !== null), 250); // debounce viewport churn
    const poll = asOfTime === null ? setInterval(() => load(false), POLL_INTERVAL_MS) : null;
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
      if (poll) clearInterval(poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- urlFor is derived from the keyed inputs
  }, [layerKey, vpKey, asOfTime]);

  // Warm the cache for the next playback tick without touching displayed state.
  useEffect(() => {
    if (!layerKey || prefetchTime === null || Number.isNaN(prefetchTime)) return;
    const key = `${layerKey}|${vpKey}|${prefetchTime}`;
    if (cache.current.has(key)) return;
    const controller = new AbortController();
    fetch(urlFor(prefetchTime), { signal: controller.signal })
      .then(async (res) => {
        if (res.ok) cache.current.set(key, (await res.json()) as HazardCollection);
      })
      .catch(() => {});
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layerKey, vpKey, prefetchTime]);

  return { data: layerKey ? data : null, loading };
}
