import Link from "next/link";
import { MOCK_CONFLICTS } from "@/lib/data/mock-conflicts";
import { getEventsForConflict } from "@/lib/data/mock-events";
import { SeverityBadge } from "@/components/ui/severity-badge";
import { REGIONS } from "@/lib/types";
import { getGlobalStatus } from "@/lib/data/global-status";
import { SEVERITY_LABEL, severityFromScore } from "@/lib/utils/severity";

export default function IntelPage() {
  const { score, change24h } = getGlobalStatus();
  const severity = severityFromScore(score);

  return (
    <main className="mx-auto max-w-[1000px] px-4 pb-28 pt-24 sm:px-6 sm:pt-32">
      <h1 className="text-2xl font-semibold text-ink sm:text-[28px]">Global Brief</h1>
      <p className="mt-1 text-sm text-ink-dim">
        Global Status is {score}/100 ({SEVERITY_LABEL[severity]}),{" "}
        {change24h >= 0 ? "up" : "down"} {Math.abs(change24h)} over the past 24 hours.
      </p>

      <div className="mt-8 space-y-8">
        {REGIONS.map((region) => {
          const conflicts = MOCK_CONFLICTS.filter((c) => c.region === region).sort(
            (a, b) => b.intensity - a.intensity,
          );
          if (conflicts.length === 0) return null;
          const events24h = conflicts.reduce(
            (a, c) => a + getEventsForConflict(c.id).length,
            0,
          );

          return (
            <section key={region} className="rounded-2xl border border-border bg-card/70 p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-ink">{region}</h2>
                <span className="text-xs text-ink-faint">{events24h} monitored events</span>
              </div>

              <p className="mt-2 text-sm leading-relaxed text-ink-dim">
                {conflicts.length} active conflict{conflicts.length === 1 ? "" : "s"} tracked
                in this region, led by {conflicts[0]!.shortName} at intensity{" "}
                {conflicts[0]!.intensity}.
              </p>

              <div className="mt-4 space-y-2">
                {conflicts.map((c) => (
                  <Link
                    key={c.id}
                    href={`/conflict/${c.slug}`}
                    className="flex items-center justify-between rounded-xl border border-border bg-card/60 px-3.5 py-2.5 hover:border-border-strong"
                  >
                    <span className="text-sm text-ink">{c.shortName}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-ink-faint">Intensity {c.intensity}</span>
                      <SeverityBadge severity={c.severity} size="sm" />
                    </div>
                  </Link>
                ))}
              </div>

              <p className="mt-4 text-[11px] text-ink-faint">
                Watch items reflect current monitored activity, not a forecast
                of what will happen next.
              </p>
            </section>
          );
        })}
      </div>
    </main>
  );
}
