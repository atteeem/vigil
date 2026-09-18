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
 * source, covering Live, historical, and animated-playback modes so the
 * page never needs a separate fetch path for any of them.
 *
 * Live (`asOf === null`): identical to the original
 * hooks/use-live-events.ts — polls GET /api/events every 20s so newly
 * published events appear without a reload.
 *
 * Historical (`asOf` set, including every playback tick): fetches
 * GET /api/events?at=... once per distinct timestamp rather than polling
 * (spec "do not create expensive per-frame historical queries"). A small
 * in-memory cache keyed by the exact ISO timestamp avoids re-fetching a
 * timestamp already seen this session — resolveTimelineTimestamp and the
 * playback math in lib/utils/world-timeline.ts both round to the minute,
 * so repeat visits (a preset re-picked, or playback stepping back over
 * ground it already covered) actually hit the cache instead of missing
 * on sub-second jitter. Each fetch carries an AbortController tied to
 * `asOf`, so an in-flight request for a timestamp playback has already
 * moved past is genuinely cancelled (spec "cancel stale requests when
 * playback advances"), not just ignored once it resolves.
 *
 * `prefetchAsOf` (optional — set to `previewNextAsOf` from
 * hooks/use-world-timeline.ts while playing) warms the same cache for
 * the NEXT tick's timestamp ahead of when it's actually needed, without
 * touching `events`/`loading`/`error` — spec "prefetch nearby timestamps
 * if useful". A cache hit for `prefetchAsOf` is a no-op.
 */
export function useWorldEvents(asOf: Date | null, prefetchAsOf?: Date | null): WorldEventsResult {
  const [events, setEvents] = useState<ConflictEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const cache = useRef(new Map<string, ConflictEvent[]>());
  const asOfTime = asOf ? asOf.getTime() : null;
  const prefetchAsOfTime = prefetchAsOf ? prefetchAsOf.getTime() : null;

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function pollLive() {
      if (cancelled) return;
      setError(false);
      try {
        const res = await fetch("/api/events", { signal: controller.signal });
        if (!res.ok) return;
        const data = (await res.json()) as ConflictEvent[];
        if (!cancelled) setEvents(data);
      } catch {
        // Network hiccup (or an intentional abort on unmount/mode
        // switch) — keep showing the last known set, try again next tick.
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
        const res = await fetch(`/api/events?at=${encodeURIComponent(key)}`, { signal: controller.signal });
        if (!res.ok) {
          if (!cancelled) setError(true);
          return;
        }
        const data = (await res.json()) as ConflictEvent[];
        cache.current.set(key, data);
        if (!cancelled) setEvents(data);
      } catch {
        // Includes AbortError from a superseded request — nothing to
        // report, the next asOf's own fetch is already taking over.
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

  // Background prefetch — deliberately a separate effect/controller from
  // the display fetch above, so aborting a superseded prefetch never
  // touches the (possibly still in-flight, and definitely user-visible)
  // display fetch, and vice versa.
  useEffect(() => {
    if (prefetchAsOfTime === null || Number.isNaN(prefetchAsOfTime)) return;
    const key = new Date(prefetchAsOfTime).toISOString();
    if (cache.current.has(key)) return;
    const controller = new AbortController();
    fetch(`/api/events?at=${encodeURIComponent(key)}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as ConflictEvent[];
        cache.current.set(key, data);
      })
      .catch(() => {
        // Aborted or failed — the tick that actually needs this
        // timestamp will fetch it again for real when it arrives.
      });
    return () => controller.abort();
  }, [prefetchAsOfTime]);

  return { events, loading, error };
}
