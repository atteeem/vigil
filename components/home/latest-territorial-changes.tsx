import Link from "next/link";
import { Map as MapIcon } from "lucide-react";
import { RelativeTime } from "@/components/ui/relative-time";
import type { PublicTerritorialChange } from "@/lib/public/territory";

const CHANGE_LABEL: Record<string, string> = {
  captured: "Captured",
  recaptured: "Recaptured",
  lost: "Lost",
  withdrew: "Withdrew",
  handed_over: "Handed over",
  contested: "Contested",
  uncertain: "Uncertain",
};

/** Latest APPROVED territorial changes (review-queue candidates are never public). Hidden when there are none. */
export function LatestTerritorialChanges({ changes, className }: { changes: readonly PublicTerritorialChange[]; className?: string }) {
  if (changes.length === 0) return null;
  return (
    <div className={className} data-testid="latest-territorial-changes">
      <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-ink-faint">
        <MapIcon className="h-3.5 w-3.5" /> Territorial changes
      </h2>
      <ul className="space-y-2">
        {changes.slice(0, 3).map((c) => (
          <li key={c.id} className="rounded-xl border border-border bg-card/60 px-3 py-2 text-xs">
            <p className="font-medium text-ink">
              <span className="mr-1.5 text-[10px] uppercase tracking-wide text-ink-faint">{CHANGE_LABEL[c.changeType] ?? c.changeType}</span>
              {c.description}
            </p>
            <p className="mt-0.5 text-ink-faint">
              <Link href={`/conflict/${c.conflictSlug}`} className="text-accent hover:underline">{c.conflictName}</Link>
              {" · "}
              <RelativeTime iso={c.observedAt ?? c.reviewedAt} fallback="date unknown" />
              {!c.geometryApplied && " · map not yet updated"}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
