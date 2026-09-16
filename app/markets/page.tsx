import Link from "next/link";
import { MOCK_MARKETS } from "@/lib/data/mock-markets";
import { formatSigned, cn } from "@/lib/utils";

const PRESSURE_CLASS: Record<string, string> = {
  Low: "text-stable bg-stable-dim",
  Moderate: "text-elevated bg-elevated-dim",
  High: "text-high bg-high-dim",
  Severe: "text-severe bg-severe-dim",
};

export default function MarketsPage() {
  return (
    <main className="mx-auto max-w-[1100px] px-4 pb-28 pt-24 sm:px-6 sm:pt-32">
      <h1 className="text-2xl font-semibold text-ink sm:text-[28px]">Global Market Impact</h1>
      <p className="mt-1 max-w-xl text-sm text-ink-dim">
        Geopolitical pressure reflects association with current tensions, not
        a claim that any single conflict caused a price move.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MOCK_MARKETS.map((m) => {
          const up = m.changePct24h >= 0;
          return (
            <Link
              key={m.id}
              href={`/markets/${m.id}`}
              className="rounded-2xl border border-border bg-card/80 p-5 hover:border-border-strong hover:bg-card"
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold uppercase tracking-wide text-ink-faint">
                  {m.name}
                </p>
                <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase", PRESSURE_CLASS[m.geopoliticalPressure])}>
                  {m.geopoliticalPressure}
                </span>
              </div>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-ink">
                {m.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}{" "}
                <span className="text-sm font-medium text-ink-faint">{m.unit}</span>
              </p>
              <p className={cn("mt-0.5 text-sm font-semibold tabular-nums", up ? "text-stable" : "text-severe")}>
                {formatSigned(m.changePct24h)}%
              </p>
              {m.relevantConflictSlugs.length > 0 && (
                <p className="mt-3 truncate text-[11px] text-ink-faint">
                  Relevant: {m.relevantConflictSlugs.join(", ")}
                </p>
              )}
            </Link>
          );
        })}
      </div>
    </main>
  );
}
