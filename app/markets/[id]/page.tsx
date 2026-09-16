"use client";

import { use, useState } from "react";
import { notFound } from "next/navigation";
import { getMarketById, MOCK_MARKETS } from "@/lib/data/mock-markets";
import { getConflictBySlug } from "@/lib/data/mock-conflicts";
import { MarketPriceChart } from "@/components/markets/market-price-chart";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SeverityBadge } from "@/components/ui/severity-badge";
import { formatSigned, cn } from "@/lib/utils";

const INTERVALS = ["1D", "1W", "1M", "3M", "1Y"] as const;

export default function MarketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const asset = getMarketById(id);
  const [interval, setInterval] = useState<(typeof INTERVALS)[number]>("1M");
  if (!asset) notFound();

  const up = asset.changePct24h >= 0;
  const relevantConflicts = asset.relevantConflictSlugs
    .map((slug) => getConflictBySlug(slug))
    .filter((c) => !!c);

  return (
    <main className="mx-auto max-w-3xl px-4 pb-28 pt-24 sm:px-6 sm:pt-32">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{asset.assetClass}</p>
      <h1 className="mt-1 text-2xl font-semibold text-ink sm:text-[32px]">{asset.name}</h1>
      <div className="mt-2 flex items-baseline gap-3">
        <span className="text-3xl font-semibold tabular-nums text-ink">
          {asset.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
        </span>
        <span className="text-sm text-ink-faint">{asset.unit}</span>
        <span className={cn("text-sm font-semibold tabular-nums", up ? "text-stable" : "text-severe")}>
          {formatSigned(asset.changePct24h)}%
        </span>
      </div>

      <div className="mt-6 rounded-2xl border border-border bg-card/70 p-5">
        <div className="flex items-center justify-between">
          <SegmentedControl
            aria-label="Interval"
            options={INTERVALS.map((v) => ({ value: v, label: v }))}
            value={interval}
            onChange={setInterval}
          />
        </div>
        <MarketPriceChart series={asset.sparkline} up={up} />
      </div>

      <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-ink-faint">
        Current Geopolitical Factors
      </h2>
      <div className="space-y-2">
        {relevantConflicts.length > 0 ? (
          relevantConflicts.map((c) => (
            <div key={c!.id} className="flex items-center justify-between rounded-xl border border-border bg-card/60 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-ink">{c!.shortName}</p>
                <p className="text-xs text-ink-faint">{c!.region}</p>
              </div>
              <SeverityBadge severity={c!.severity} size="sm" />
            </div>
          ))
        ) : (
          <p className="text-sm text-ink-faint">No directly linked active conflicts right now.</p>
        )}
      </div>

      <h2 className="mb-2 mt-8 text-sm font-semibold uppercase tracking-wide text-ink-faint">
        Why It Matters
      </h2>
      <p className="max-w-xl text-sm leading-relaxed text-ink-dim">
        {asset.name} carries a <strong className="text-ink">{asset.geopoliticalPressure.toLowerCase()}</strong>{" "}
        geopolitical pressure reading, reflecting association with the tensions
        listed above rather than a causal claim. Prices are shaped by many
        factors beyond geopolitics — this view exists to help you understand
        one contributing dimension, not to predict future moves.
      </p>

      <div className="mt-6 grid grid-cols-3 gap-3 sm:hidden">
        {MOCK_MARKETS.filter((m) => m.id !== asset.id)
          .slice(0, 3)
          .map((m) => (
            <a key={m.id} href={`/markets/${m.id}`} className="rounded-xl border border-border p-2 text-center text-xs text-ink-dim">
              {m.symbol}
            </a>
          ))}
      </div>
    </main>
  );
}
