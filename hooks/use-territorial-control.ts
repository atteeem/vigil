"use client";

import { useEffect, useRef, useState } from "react";

const POLL_INTERVAL_MS = 20_000;

const EMPTY_COLLECTION: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

export interface TerritorialControlResult {
  featureCollection: GeoJSON.FeatureCollection;
  loading: boolean;
  error: boolean;
}

/**
 * Territorial Control Mode — the SAME `asOf` the map's event/timeline
 * state already uses (spec §5 "do not create a second timeline system"),
 * fetching GET /api/territorial-control instead of /api/events. Mirrors
 * hooks/use-world-events.ts's own live-poll / historical-fetch-and-cache /
 * AbortController-cancellation / prefetch structure exactly, so playback
 * updates territorial polygons through the identical mechanism it already
 * uses for events — no parallel caching or cancellation design to reason
 * about separately.
 */
export function useTerritorialControl(asOf: Date | null, prefetchAsOf?: Date | null): TerritorialControlResult {
  const [featureCollection, setFeatureCollection] = useState<GeoJSON.FeatureCollection>(EMPTY_COLLECTION);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const cache = useRef(new Map<string, GeoJSON.FeatureCollection>());
  const asOfTime = asOf ? asOf.getTime() : null;
  const prefetchAsOfTime = prefetchAsOf ? prefetchAsOf.getTime() : null;

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function pollLive() {
      if (cancelled) return;
      setError(false);
      try {
        const res = await fetch("/api/territorial-control", { signal: controller.signal });
        if (!res.ok) return;
        const data = (await res.json()) as GeoJSON.FeatureCollection;
        if (!cancelled) setFeatureCollection(data);
      } catch {
        // Network hiccup or intentional abort — keep showing the last
        // known set, try again next tick.
      }
    }

    async function fetchHistorical(timestamp: number) {
      if (Number.isNaN(timestamp)) {
        if (!cancelled) setError(true);
        return;
      }
      const key = new Date(timestamp).toISOString();
      const cached = cache.current.get(key);
      if (cached) {
        if (!cancelled) {
          setFeatureCollection(cached);
          setError(false);
        }
        return;
      }
      if (!cancelled) {
        setLoading(true);
        setError(false);
      }
      try {
        const res = await fetch(`/api/territorial-control?at=${encodeURIComponent(key)}`, { signal: controller.signal });
        if (!res.ok) {
          if (!cancelled) setError(true);
          return;
        }
        const data = (await res.json()) as GeoJSON.FeatureCollection;
        cache.current.set(key, data);
        if (!cancelled) setFeatureCollection(data);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (asOfTime === null) {
      pollLive();
      const id = setInterval(pollLive, POLL_INTERVAL_MS);
      return () => {
        cancelled = true;
        controller.abort();
        clearInterval(id);
      };
    }

    fetchHistorical(asOfTime);
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [asOfTime]);

  useEffect(() => {
    if (prefetchAsOfTime === null || Number.isNaN(prefetchAsOfTime)) return;
    const key = new Date(prefetchAsOfTime).toISOString();
    if (cache.current.has(key)) return;
    const controller = new AbortController();
    fetch(`/api/territorial-control?at=${encodeURIComponent(key)}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as GeoJSON.FeatureCollection;
        cache.current.set(key, data);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [prefetchAsOfTime]);

  return { featureCollection, loading, error };
}
