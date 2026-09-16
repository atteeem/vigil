import Link from "next/link";
import { ArrowUp, ArrowDown, Minus } from "lucide-react";
import type { Conflict } from "@/lib/types";
import { SeverityBadge } from "@/components/ui/severity-badge";
import { timeAgo, cn } from "@/lib/utils";
import { MOCK_NOW } from "@/lib/data/constants";
import { getCountryByCode } from "@/lib/data/mock-countries";
import { computeImpact } from "@/lib/data/impact";

export function ConflictCard({
  conflict,
  baseCountryCode,
  className,
}: {
  conflict: Conflict;
  baseCountryCode: string;
  className?: string;
}) {
  const country = getCountryByCode(baseCountryCode);
  const impact = country ? computeImpact(country, conflict) : null;
  const now = new Date(MOCK_NOW);
  const updateIso = new Date(
    now.getTime() - conflict.lastUpdateMinutesAgo * 60000,
  ).toISOString();

  const TrendIcon =
    conflict.intensityChange24h > 0 ? ArrowUp : conflict.intensityChange24h < 0 ? ArrowDown : Minus;

  return (
    <Link
      href={`/conflict/${conflict.slug}`}
      className={cn(
        "block rounded-2xl border border-border bg-card/80 p-5 transition-colors hover:border-border-strong hover:bg-card",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-ink">{conflict.shortName}</h3>
          <p className="mt-0.5 text-xs text-ink-faint">{conflict.region} · Updated {timeAgo(updateIso, MOCK_NOW)}</p>
        </div>
        <SeverityBadge severity={conflict.severity} size="sm" />
      </div>

      <div className="mt-4 grid grid-cols-4 gap-3">
        <Stat label="Intensity" value={conflict.intensity} />
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wide text-ink-faint">24H</p>
          <p className="mt-0.5 flex items-center gap-0.5 text-lg font-semibold tabular-nums text-ink">
            <TrendIcon className="h-3.5 w-3.5 text-ink-faint" />
            {Math.abs(conflict.intensityChange24h)}
          </p>
        </div>
        <Stat label="Events" value={conflict.eventCount} />
        <Stat label="Impact on you" value={impact?.score ?? "—"} accent />
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {conflict.primaryEffects.map((e) => (
          <span
            key={e}
            className="rounded-full border border-border-strong px-2 py-0.5 text-[11px] text-ink-dim"
          >
            {e}
          </span>
        ))}
      </div>
    </Link>
  );
}

function Stat({ label, value, accent }: { label: string; value: number | string; accent?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-wide text-ink-faint">{label}</p>
      <p className={cn("mt-0.5 text-lg font-semibold tabular-nums", accent ? "text-accent" : "text-ink")}>
        {value}
      </p>
    </div>
  );
}
