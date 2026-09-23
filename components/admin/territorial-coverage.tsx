"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/utils/format";
import { COVERAGE_STATE_LABEL, DATASET_TYPE_LABEL, type CoverageState, type TerritorialDatasetType } from "@/lib/territory/dataset-types";
import type { CoverageDataset, CoverageRow } from "@/lib/territory/datasets";

const STATE_TONE: Record<CoverageState, string> = {
  HAS_CONTROL_DATA: "border-stable/40 text-stable",
  HAS_PRESENCE_DATA: "border-accent/40 text-accent",
  PENDING_REVIEW: "border-high/40 text-high",
  STALE: "border-high/40 text-high",
  SOURCE_CANDIDATE: "border-border-strong text-ink-dim",
  NO_DATA: "border-border text-ink-faint",
};

/** Coverage of territorial data per active conflict, the provider / licence / freshness of every dataset, and the human
 * approval step: publishing an imported dataset's drafts goes through the same per-area publish as the editor. */
export function TerritorialCoverage() {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const { data, isPending } = useQuery({
    queryKey: ["admin", "territorial-coverage"],
    queryFn: async (): Promise<{ rows: CoverageRow[]; unlinked: CoverageDataset[] }> => (await fetch("/api/admin/territorial-datasets")).json(),
  });

  async function publish(d: CoverageDataset) {
    if (!window.confirm(`Publish ${d.draftVersions} draft version(s) of "${d.name}"? Published versions become permanent history.`)) return;
    setBusy(d.id);
    setMessage(null);
    const res = await fetch(`/api/admin/territorial-datasets/${d.id}/publish`, { method: "POST" });
    const json = await res.json().catch(() => ({}));
    setMessage(res.ok ? `Published ${json.published} version(s) of ${d.name}.` : `Could not publish: ${json.error ?? res.status}`);
    setBusy(null);
    void queryClient.invalidateQueries({ queryKey: ["admin"] });
    void queryClient.invalidateQueries({ queryKey: ["territorial-datasets"] });
  }

  const datasetRow = (d: CoverageDataset) => (
    <li key={d.id} className="rounded-lg border border-border/60 bg-card/40 px-3 py-2 text-xs" data-testid={`coverage-dataset-${d.slug ?? d.id}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium text-ink">{d.name}</span>
        <span className="rounded border border-border px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-ink-dim">{DATASET_TYPE_LABEL[d.datasetType as TerritorialDatasetType] ?? d.datasetType}</span>
        <span className="text-ink-faint">review: {d.reviewStatus.replace(/_/g, " ")}</span>
        {d.stale && <span className="text-high">stale</span>}
        {d.draftVersions > 0 && (
          <Button size="sm" variant="primary" className="ml-auto" onClick={() => publish(d)} disabled={busy === d.id} data-testid={`publish-dataset-${d.slug ?? d.id}`}>
            {busy === d.id ? "Publishing…" : `Approve and publish ${d.draftVersions} draft${d.draftVersions === 1 ? "" : "s"}`}
          </Button>
        )}
      </div>
      <p className="mt-1 text-ink-faint">
        {d.provider} · licence: {d.license ?? "n/a"} · {d.publishedVersions} published / {d.draftVersions} draft geometries · {d.lastUpdated ? `updated ${timeAgo(d.lastUpdated)}` : "no update date"} · geometry: {d.geometryAvailability}
        {d.sourceUrl && (
          <>
            {" "}
            ·{" "}
            <a href={d.sourceUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-0.5 text-accent hover:underline">
              source <ExternalLink className="h-2.5 w-2.5" />
            </a>
          </>
        )}
      </p>
      {d.notes && <p className="mt-1 text-ink-faint">{d.notes}</p>}
    </li>
  );

  return (
    <Card className="mb-6 p-4" data-testid="territorial-coverage">
      <h2 className="text-sm font-semibold text-ink">Data coverage</h2>
      <p className="mb-3 text-xs text-ink-faint">Which active conflicts have territorial-control or presence data, what is waiting for review, and which sources are only candidates. Nothing imported is public until it is approved here.</p>
      {message && <p className="mb-2 text-xs text-ink-dim" data-testid="coverage-message">{message}</p>}
      {isPending && <p className="text-xs text-ink-faint">Loading…</p>}
      <ul className="space-y-2">
        {data?.rows.map((r) => (
          <li key={r.conflictId} data-testid={`coverage-row-${r.slug}`} data-state={r.state}>
            <div className="flex items-center gap-2">
              <span className="text-[13px] text-ink">{r.name}</span>
              <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", STATE_TONE[r.state])} data-testid="coverage-state">
                {COVERAGE_STATE_LABEL[r.state]}
              </span>
            </div>
            {r.datasets.length > 0 && <ul className="mt-1 space-y-1 pl-3">{r.datasets.map(datasetRow)}</ul>}
          </li>
        ))}
      </ul>
      {data && data.unlinked.length > 0 && (
        <div className="mt-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Not tied to a conflict</h3>
          <ul className="mt-1 space-y-1">{data.unlinked.map(datasetRow)}</ul>
        </div>
      )}
    </Card>
  );
}
