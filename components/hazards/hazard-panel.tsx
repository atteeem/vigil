"use client";

import { useEffect, useState } from "react";
import type { HazardDetail } from "@/lib/hazards/public-types";
import { HazardDetailView } from "./hazard-detail";

/** Loads one hazard for the /world side panel / bottom sheet, reconstructed for the timeline's asOf. */
export function HazardPanel({ id, asOf }: { id: string; asOf: Date | null }) {
  const [detail, setDetail] = useState<HazardDetail | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");
  const asOfIso = asOf ? asOf.toISOString() : null;

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    fetch(`/api/hazards/${encodeURIComponent(id)}${asOfIso ? `?at=${encodeURIComponent(asOfIso)}` : ""}`, { signal: controller.signal })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) return setState("missing");
        setDetail((await res.json()) as HazardDetail);
        setState("ready");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [id, asOfIso]);

  if (state === "missing") return <p className="text-sm text-ink-faint" data-testid="hazard-missing">This event was not yet observed at the selected time.</p>;
  if (!detail) return <p className="text-sm text-ink-faint">Loading…</p>;
  return <HazardDetailView detail={detail} />;
}
