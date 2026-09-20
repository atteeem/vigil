import { EmptyState } from "@/components/public/data-states";

// No market data feed is connected. Rather than show sample prices as if they
// were real, this page says so. (Sample market fixtures live in lib/dev-fixtures
// for development only and are never imported here.)
export default function MarketsPage() {
  return (
    <main className="mx-auto max-w-[1100px] px-4 pb-28 pt-24 sm:px-6 sm:pt-32">
      <h1 className="text-2xl font-semibold text-ink sm:text-[28px]">Global Market Impact</h1>
      <p className="mt-1 max-w-xl text-sm text-ink-dim">Market pressure will appear here once a market data source is connected.</p>
      <EmptyState className="mt-8" title="Market data unavailable" detail="Vigil does not yet have a live market feed, so no prices or pressure readings are shown." testId="markets-unavailable" />
    </main>
  );
}
