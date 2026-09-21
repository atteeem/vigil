"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WorldItem } from "@/lib/world/types";

// 10-15 s per development. The env override exists so tests can step quickly; NEXT_PUBLIC_* must be a literal reference.
export const LIVE_VIEW_STEP_MS = Number(process.env.NEXT_PUBLIC_LIVE_VIEW_STEP_MS) || 12_000;

/** LIVE VIEW: cycles the meaningful developments (the same queue as the ticker: no party claims, no minor
 * RSS/thermal, no duplicates) on a timer. Never starts by itself; `pause()` is called by any manual
 * interaction; `resume()` continues from the current item. */
export function useLiveView(queue: WorldItem[], onStep: (item: WorldItem) => void, stepMs = LIVE_VIEW_STEP_MS) {
  const [active, setActive] = useState(false);
  const [paused, setPaused] = useState(false);
  const [index, setIndex] = useState(0);
  const queueRef = useRef(queue);
  const stepRef = useRef(onStep);
  const indexRef = useRef(0);
  useEffect(() => {
    queueRef.current = queue;
    stepRef.current = onStep;
  });

  const go = useCallback((i: number) => {
    const q = queueRef.current;
    if (q.length === 0) return;
    const n = ((i % q.length) + q.length) % q.length;
    indexRef.current = n;
    setIndex(n);
    stepRef.current(q[n]!);
  }, []);

  const start = useCallback(() => {
    if (queueRef.current.length === 0) return;
    setActive(true);
    setPaused(false);
    go(0);
  }, [go]);
  const stop = useCallback(() => {
    setActive(false);
    setPaused(false);
  }, []);
  const pause = useCallback(() => setPaused(true), []);
  const resume = useCallback(() => {
    setPaused(false);
    go(indexRef.current + 1);
  }, [go]);

  useEffect(() => {
    if (!active || paused) return;
    const t = setInterval(() => go(indexRef.current + 1), stepMs);
    return () => clearInterval(t);
  }, [active, paused, stepMs, go]);

  // An empty queue (data refreshed away) ends the mode rather than leaving it spinning on nothing.
  useEffect(() => {
    if (active && queue.length === 0) {
      setActive(false); // eslint-disable-line react-hooks/set-state-in-effect -- ending the mode when its queue vanishes
      setPaused(false);
    }
  }, [active, queue.length]);

  return { active, paused, index, current: active ? (queue[index] ?? null) : null, start, stop, pause, resume };
}

export const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
