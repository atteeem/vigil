import Link from "next/link";
import { listPublicConflicts } from "@/lib/public/conflicts";
import { EmptyState } from "@/components/public/data-states";
import { SeverityBadge } from "@/components/ui/severity-badge";
import { REGIONS } from "@/lib/types";
import { getGlobalStatus } from "@/lib/data/global-status";
import { SEVERITY_LABEL, severityFromScore } from "@/lib/utils/severity";
import { conflictSeverityScore } from "@/lib/scoring/severity";

// Real registry conflicts, read on demand.
export const dynamic = "force-dynamic";

export default async function IntelPage() {
  const allConflicts = await listPublicConflicts();
  const status = getGlobalStatus(allConflicts);

  return (
    <main className="mx-auto max-w-[1000px] px-4 pb-28 pt-24 sm:px-6 sm:pt-32">
      <h1 className="text-2xl font-semibold text-ink sm:text-[28px]">Global Brief</h1>
      {status ? (
        <p className="mt-1 text-sm text-ink-dim">
          Global Status is {status.score}/100 ({SEVERITY_LABEL[severityFromScore(status.score)]})
          {status.change24h !== 0 && (
            <>
              , {status.change24h > 0 ? "up" : "down"} {Math.abs(status.change24h)} over the past 24 hours
            </>
          )}
          .
        </p>
      ) : (
        <EmptyState className="mt-4" title="No active conflicts tracked" testId="intel-empty" />
      )}

      <div className="mt-8 space-y-8">
        {REGIONS.map((region) => {
          const conflicts = allConflicts.filter((c) => c.region === region && (c.status === "active" || c.status === "reduced")).sort(
            (a, b) => conflictSeverityScore(b) - conflictSeverityScore(a),
          );
          if (conflicts.length === 0) return null;
          const publishedEvents = conflicts.reduce((a, c) => a + c.eventCount, 0);

          return (
            <section key={region} className="rounded-2xl border border-border bg-card/70 p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-ink">{region}</h2>
                <span className="text-xs text-ink-faint">{publishedEvents} published events</span>
              </div>

              <p className="mt-2 text-sm leading-relaxed text-ink-dim">
                {conflicts.length} active conflict{conflicts.length === 1 ? "" : "s"} tracked
                in this region, led by {conflicts[0]!.shortName} at severity{" "}
                {conflictSeverityScore(conflicts[0]!)}.
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
                      <span className="text-xs text-ink-faint">Severity {conflictSeverityScore(c)}</span>
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
