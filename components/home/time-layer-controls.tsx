"use client";

import { SegmentedControl } from "@/components/ui/segmented-control";
import { useAppStore, type MapLayer, type TimeRange } from "@/hooks/use-app-store";
import { cn } from "@/lib/utils";

const TIME_OPTIONS: { value: TimeRange; label: string }[] = [
  { value: "1H", label: "1H" },
  { value: "6H", label: "6H" },
  { value: "24H", label: "24H" },
  { value: "7D", label: "7D" },
  { value: "30D", label: "30D" },
];

const LAYER_OPTIONS: { value: MapLayer; label: string }[] = [
  { value: "events", label: "Events" },
  { value: "conflicts", label: "Conflicts" },
  { value: "energy", label: "Energy" },
  { value: "trade", label: "Trade" },
];

export function TimeLayerControls({ className }: { className?: string }) {
  const timeRange = useAppStore((s) => s.timeRange);
  const setTimeRange = useAppStore((s) => s.setTimeRange);
  const layer = useAppStore((s) => s.layer);
  const setLayer = useAppStore((s) => s.setLayer);

  return (
    <div className={cn("flex flex-col items-center gap-2.5", className)}>
      <SegmentedControl aria-label="Time range" options={TIME_OPTIONS} value={timeRange} onChange={setTimeRange} />
      <SegmentedControl aria-label="Map layer" options={LAYER_OPTIONS} value={layer} onChange={setLayer} />
    </div>
  );
}
