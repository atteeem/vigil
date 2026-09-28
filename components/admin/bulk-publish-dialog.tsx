"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BulkPlan, BulkResult } from "@/lib/ingestion/bulk-publish";
import { LOCATION_SCOPE_LABEL, type LocationScope } from "@/lib/types/db";

// Confirmation step for "Publish filtered" / "Publish selected": an exact recount and what would happen, with warnings,
// before anything is written; afterwards the published / skipped / failed summary with every reason inspectable.

export function BulkPublishDialog({ filters, ids, onClose, onDone }: { filters: string; ids?: string[]; onClose: () => void; onDone: () => void }) {
  const [plan, setPlan] = useState<BulkPlan | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/admin/incoming/publish-bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filters, ids, mode: "preview" }) });
      const json = await res.json();
      if (cancelled) return;
      if (!res.ok) setError(json.error ?? "Could not prepare the summary");
      else setPlan(json as BulkPlan);
    })().catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [filters, ids]);

  async function confirm() {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/incoming/publish-bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filters, ids, mode: "publish", expectedCount: ids ? undefined : plan.matching }) });
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "Bulk publish failed");
      else {
        setResult(json as BulkResult);
        onDone();
      }
    } finally {
      setBusy(false);
    }
  }

  const failed = result?.outcomes.filter((o) => o.status === "failed") ?? [];
  const skipped = result?.outcomes.filter((o) => o.status === "skipped") ?? [];
  const warn = plan?.warnings;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Publish reports" data-testid="bulk-dialog">
      <div className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-border bg-surface p-5 shadow-2xl">
        <div className="mb-3 flex items-start justify-between">
          <h2 className="text-base font-semibold text-ink">{ids ? "Publish selected reports" : "Publish all filtered reports"}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-ink-faint hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </div>

        {!plan && !error && (
          <p className="flex items-center gap-2 text-sm text-ink-faint">
            <Loader2 className="h-4 w-4 animate-spin" /> Counting and checking the reports…
          </p>
        )}
        {error && (
          <p className="mb-3 rounded-lg border border-high/40 bg-high/10 px-3 py-2 text-sm text-high" data-testid="bulk-error">
            {error}
          </p>
        )}

        {plan && !result && (
          <div data-testid="bulk-summary">
            <p className="text-sm text-ink">
              <strong data-testid="bulk-matching">{plan.matching}</strong> report{plan.matching === 1 ? "" : "s"} match{plan.matching === 1 ? "es" : ""} the current filters
              {ids ? `, ${ids.length} selected` : ""}. <strong data-testid="bulk-publishable">{plan.publishable}</strong> will be published; <strong data-testid="bulk-skipped-count">{plan.outcomes.length - plan.publishable}</strong> will be skipped.
            </p>
            {plan.publishable > 0 && (
              <p className="mt-2 text-xs text-ink-faint" data-testid="bulk-scopes">
                By location: {(Object.keys(plan.scopes) as LocationScope[]).filter((s) => plan.scopes[s] > 0).map((s) => `${LOCATION_SCOPE_LABEL[s]} ${plan.scopes[s]}`).join(" · ") || "none"}
              </p>
            )}
            {warn && (warn.lowConfidence > 0 || warn.partyClaimOrAggregator > 0 || warn.mediumDuplicateRisk > 0) && (
              <ul className="mt-3 space-y-1 rounded-lg border border-accent/30 bg-accent-dim/40 p-3 text-xs text-ink-dim" data-testid="bulk-warnings">
                <li className="flex items-center gap-1.5 font-semibold text-accent">
                  <AlertTriangle className="h-3.5 w-3.5" /> Check before publishing
                </li>
                {warn.lowConfidence > 0 && <li>{warn.lowConfidence} with low-confidence details (no location, unverified, or a headline taken from the text).</li>}
                {warn.partyClaimOrAggregator > 0 && <li>{warn.partyClaimOrAggregator} from party-claim or aggregator sources (published as reported, not corroborated).</li>}
                {warn.mediumDuplicateRisk > 0 && <li>{warn.mediumDuplicateRisk} with a medium duplicate risk.</li>}
              </ul>
            )}
            {plan.skipped.length > 0 && (
              <details className="mt-3 text-xs text-ink-dim" data-testid="bulk-skip-reasons">
                <summary className="cursor-pointer text-ink">Skipped ({plan.outcomes.length - plan.publishable})</summary>
                <ul className="mt-1 space-y-1">
                  {plan.skipped.map((s) => (
                    <li key={s.code}>
                      {s.count} — {s.label}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <p className="mt-3 text-xs text-ink-faint">Each report is published with its own original source link, its detected conflict and location, and the source&apos;s own headline. Skipped reports stay in the queue.</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" onClick={confirm} disabled={busy || plan.publishable === 0} data-testid="bulk-confirm">
                {busy ? "Publishing…" : `Publish ${plan.publishable} report${plan.publishable === 1 ? "" : "s"}`}
              </Button>
            </div>
          </div>
        )}

        {result && (
          <div data-testid="bulk-result">
            <p className="text-sm text-ink" data-testid="bulk-result-line">
              Published: <strong data-testid="bulk-published">{result.published}</strong> · Merged: <strong data-testid="bulk-merged" title="Attached to an existing event (same real-world incident) instead of creating a duplicate">{result.merged}</strong> · Skipped: <strong data-testid="bulk-result-skipped">{result.skipped}</strong> · Failed: <strong data-testid="bulk-failed">{result.failed}</strong>
            </p>
            {failed.length > 0 && (
              <details open className="mt-3 text-xs text-ink-dim" data-testid="bulk-failed-list">
                <summary className="cursor-pointer text-high">Failed ({failed.length})</summary>
                <ul className="mt-1 space-y-1">
                  {failed.map((f) => (
                    <li key={f.id}>
                      {f.title}: {f.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {skipped.length > 0 && (
              <details className="mt-3 text-xs text-ink-dim" data-testid="bulk-skipped-list">
                <summary className="cursor-pointer text-ink">Skipped ({skipped.length})</summary>
                <ul className="mt-1 max-h-48 space-y-1 overflow-y-auto">
                  {skipped.slice(0, 200).map((f) => (
                    <li key={f.id}>
                      {f.title}: {f.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <div className="mt-4 flex justify-end">
              <Button size="sm" variant="primary" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
