import Link from "next/link";
import type { MarketAsset } from "@/lib/types";
import { formatSigned, cn } from "@/lib/utils";

const PRESSURE_CLASS: Record<MarketAsset["geopoliticalPressure"], string> = {
  Low: "text-stable",
  Moderate: "text-elevated",
  High: "text-high",
  Severe: "text-severe",
};

export function MarketMiniCard({ asset }: { asset: MarketAsset }) {
  const up = asset.changePct24h >= 0;
  return (
    <Link
      href={`/markets/${asset.id}`}
      className="flex items-center justify-between rounded-xl border border-border bg-card/70 p-3.5 hover:border-border-strong hover:bg-card"
    >
      <div>
        <p className="text-sm font-medium text-ink">{asset.name}</p>
        <p className="text-xs text-ink-faint">
          {asset.price.toLocaleString(undefined, { maximumFractionDigits: 2 })} {asset.unit}
        </p>
      </div>
      <div className="text-right">
        <p className={cn("text-sm font-semibold tabular-nums", up ? "text-stable" : "text-severe")}>
          {formatSigned(asset.changePct24h)}%
        </p>
        <p className={cn("text-[11px] font-medium", PRESSURE_CLASS[asset.geopoliticalPressure])}>
          {asset.geopoliticalPressure} pressure
        </p>
      </div>
    </Link>
  );
}
