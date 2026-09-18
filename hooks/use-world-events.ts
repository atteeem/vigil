"use client";

import { useEffect, useRef, useState } from "react";
import type { ConflictEvent } from "@/lib/types";

const POLL_INTERVAL_MS = 20_000;

export interface WorldEventsResult {
  events: ConflictEvent[];
  loading: boolean;
  error: boolean;
}

/**
 * Global Timeline / Historical Playback — the /world map's single data
 * source, covering both Live and historical modes so the page never
 * needs two separate fetch code paths.
 *
 * Live (`asOf === null`): identical to the original
 * hooks/use-live-events.ts — polls GET /api/events every 20s so newly
 * published events appear without a reload.
 *
 * Historical (`asOf` set): a past timestamp's reconstructed world state
 * never changes on its own, so this fetches GET /api/events?at=... once
 * per distinct timestamp rather than polling (spec "do not create
 * expensive per-frame historical queries"). A small in-memory cache
 * keyed by the exact ISO timestamp avoids re-fetching a timestamp
 * already seen this session (e.g. flipping back and forth between two
 * presets) — resolveTimelineTimestamp already rounds to the minute, so
 * repeat visits to the same preset resolve to the same key and actually
 * hit the cache instead of missing on sub-second jitter.
 */
export function useWorldEvents(asOf: Date | null): WorldEventsResult {
  const [events, setEvents] = useState<ConflictEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const cache = useRef(new Map<string, ConflictEvent[]>());
  const asOfTime = asOf ? asOf.getTime() : null;

  useEffect(() => {
    let cancelled = false;

    async function pollLive() {
      if (cancelled) return;
      setError(false);
      try {
        const res = await fetch("/api/events");
        if (!res.ok) return;
        const data = (await res.json()) as ConflictEvent[];
        if (!cancelled) setEvents(data);
      } catch {
        // Network hiccup — keep showing the last known set, try again next tick.
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
          setEvents(cached);
          setError(false);
        }
        return;
      }
      if (!cancelled) {
        setLoading(true);
        setError(false);
      }
      try {
        const res = await fetch(`/api/events?at=${encodeURIComponent(key)}`);
        if (!res.ok) {
          if (!cancelled) setError(true);
          return;
        }
        const data = (await res.json()) as ConflictEvent[];
        cache.current.set(key, data);
        if (!cancelled) setEvents(data);
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
        clearInterval(id);
      };
    }

    fetchHistorical(asOfTime);
    return () => {
      cancelled = true;
    };
  }, [asOfTime]);

  return { events, loading, error };
}
