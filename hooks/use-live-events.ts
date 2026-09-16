"use client";

import { useEffect, useState } from "react";
import type { ConflictEvent } from "@/lib/types";

const POLL_INTERVAL_MS = 20_000;

/** Polls /api/events (published DB events) so newly published admin
 * reports appear on /world without a full page reload — see spec §15
 * ("Frontend should refresh new published events automatically... Use
 * polling/SSE as appropriate"). Polling was chosen over SSE for this local-
 * development build: one plain GET endpoint, no extra transport/reconnect
 * logic, easily swapped for SSE later if the poll interval becomes a real
 * latency concern. */
export function useLiveEvents(): ConflictEvent[] {
  const [events, setEvents] = useState<ConflictEvent[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch("/api/events");
        if (!res.ok) return;
        const data = (await res.json()) as ConflictEvent[];
        if (!cancelled) setEvents(data);
      } catch {
        // Network hiccup — keep showing the last known set, try again next tick.
      }
    }
    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return events;
}
