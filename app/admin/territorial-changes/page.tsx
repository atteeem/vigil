"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { CHANGE_TYPE_LABEL, COMPARISON_LABEL, isChangeType } from "@/lib/territory/change-types";
import { PRECISION_LABEL } from "@/lib/territory/location-precision";
import { OPEN_CANDIDATE_STATUSES, type TerritorialChangeCandidateDTO } from "@/lib/types/db";

// Territorial Change Intelligence — admin review workflow. A candidate is a
// proposal; nothing here changes territory except an explicit Approve, which
// supersedes a versioned polygon (old row closed with validTo, new row from
// validFrom) or, with no safe geometry, records a verified change "pending
// geometry" — never a fabricated polygon.

type Tab = "open" | "geometry" | "resolved";

const isOpen = (c: TerritorialChangeCandidateDTO) => (OPEN_CANDIDATE_STATUSES as readonly string[]).includes(c.status);

const COMPARISON_STYLE: Record<string, string> = {
  genuine_change: "border-emerald-500/40 text-emerald-300",
  already_known: "border-border text-ink-faint",
  conflicting_claim: "border-amber-500/50 text-amber-300",
  insufficient_evidence: "border-border text-ink-dim",
};

function changeLabel(type: string) {
  return isChangeType(type) ? CHANGE_TYPE_LABEL[type] : type;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-ink-faint">{label}</div>
      <div className="text-ink-dim">{children}</div>
    </div>
  );
}

function StateCard({ title, actor, status, testId }: { title: string; actor: string | null; status: string | null; testId: string }) {
  return (
    <div className="rounded-lg border border-border/60 p-2" data-testid={testId}>
      <div className="text-xs uppercase tracking-wide text-ink-faint">{title}</div>
      <div className="text-ink">{status ? status.replace("_", " ") : "Not mapped"}</div>
      <div className="text-xs text-ink-dim">{actor ?? "No single controller"}</div>
    </div>
  );
}

function CandidatePanel({ candidate, all }: { candidate: TerritorialChangeCandidateDTO; all: TerritorialChangeCandidateDTO[] }) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [mergeInto, setMergeInto] = useState("");
  const [geometryText, setGeometryText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const cmp = candidate.comparison;
  const mergeTargets = all.filter((c) => c.id !== candidate.id && c.conflictId === candidate.conflictId && isOpen(c));

  async function post(path: string, body: unknown) {
    setError(null);
    const res = await fetch(`/api/admin/territorial-change-candidates/${candidate.id}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      setError(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Action failed");
      return;
    }
    setConfirm(false);
    queryClient.invalidateQueries({ queryKey: ["admin", "territorial-changes"] });
    queryClient.invalidateQueries({ queryKey: ["admin", "territorial-control"] });
  }

  function attachGeometry() {
    let geometry: unknown;
    try {
      geometry = JSON.parse(geometryText);
    } catch {
      setError("Geometry must be valid GeoJSON (Polygon or MultiPolygon)");
      return;
    }
    void post("geometry", { geometry });
  }

  return (
    <div className="space-y-3 text-sm" data-testid="tc-detail">
      <Field label="Reported change">
        <span className="text-ink">{candidate.description}</span>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Change type">{changeLabel(candidate.changeType)}</Field>
        <Field label="Status">
          <span data-testid="tc-status">{candidate.status}</span>
        </Field>
        <Field label="Location">{candidate.locationName ?? "—"}</Field>
        <Field label="Location precision">
          <span data-testid="tc-precision">{PRECISION_LABEL[candidate.precision]}</span>
          {(candidate.precision === "approximate" || candidate.precision === "area_level" || candidate.precision === "unknown") && (
            <span className="ml-1 text-xs text-ink-faint">
              {candidate.precision === "approximate"
                ? "(settlement-level point, not the exact spot)"
                : candidate.precision === "area_level"
                  ? "(names an area — no point coordinates)"
                  : "(no coordinates recorded)"}
            </span>
          )}
        </Field>
        <Field label="Claimed new controller">{candidate.claimedActorName ?? "—"}</Field>
        <Field label="Previous controller">{candidate.previousActorName ?? "—"}</Field>
        <Field label="Claim confidence">
          <span data-testid="tc-confidence">{Math.round(candidate.confidence * 100)}%</span>
          <span className="ml-1 text-xs text-ink-faint">of this claim — not conflict severity</span>
        </Field>
        <Field label="Reported / observed">{candidate.observedAt ? new Date(candidate.observedAt).toLocaleString() : "—"}</Field>
      </div>

      {cmp && (
        <div className="space-y-2" data-testid="tc-comparison">
          <div className="flex items-center gap-2">
            <span className={cn("rounded-full border px-2 py-0.5 text-xs", COMPARISON_STYLE[cmp.outcome])} data-testid="tc-outcome">
              {COMPARISON_LABEL[cmp.outcome]}
            </span>
            <span className="text-xs text-ink-faint">{cmp.reason}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <StateCard title="Current state" actor={cmp.currentActorName} status={cmp.currentStatus} testId="tc-current" />
            <StateCard title="Proposed state" actor={cmp.proposedActorName} status={cmp.proposedStatus} testId="tc-proposed" />
          </div>
        </div>
      )}

      {candidate.evidence && (
        <Field label="Extracted evidence">
          <span className="text-xs" data-testid="tc-evidence">
            {candidate.evidence}
          </span>
        </Field>
      )}

      <div className="space-y-1">
        <div className="text-xs uppercase tracking-wide text-ink-faint">Source</div>
        {candidate.report?.title && <div className="text-ink-dim">{candidate.report.title}</div>}
        {(candidate.sourceUrl || candidate.report?.url) && (
          <a
            href={(candidate.sourceUrl ?? candidate.report?.url) as string}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
          >
            <ExternalLink className="h-3 w-3" />
            {candidate.sourceName ?? "Source"}
          </a>
        )}
        {candidate.event && (
          <div className="text-xs text-ink-dim">
            Event:{" "}
            <a className="text-accent hover:underline" href={`/event/${candidate.event.slug}`}>
              {candidate.event.title}
            </a>
          </div>
        )}
        {candidate.corroboration.length > 0 && (
          <div className="text-xs text-ink-faint" data-testid="tc-corroboration">
            Also reported by: {candidate.corroboration.map((c) => c.sourceName ?? "unknown").join(", ")}. Corroboration
            raises confidence slightly but never proves a claim.
          </div>
        )}
      </div>

      {candidate.status === "approved" && (
        <div className="rounded-lg border border-border/60 p-2 text-xs text-ink-dim" data-testid="tc-applied">
          {candidate.geometryPending
            ? "Approved as a verified territorial change — no polygon has been changed. Geometry is pending."
            : `Approved and applied as territory version ${candidate.appliedTerritoryId}.`}
        </div>
      )}

      {(isOpen(candidate) || (candidate.status === "approved" && candidate.geometryPending)) && (
        <a
          href={`/admin/territorial-control?candidate=${candidate.id}`}
          className="inline-flex rounded-lg border border-border px-3 py-1 text-xs text-accent hover:bg-white/5"
          data-testid="tc-open-editor"
        >
          Open in territory editor — draw only the affected area
        </a>
      )}

      {candidate.status === "approved" && candidate.geometryPending && (
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-wide text-ink-faint">Add admin-supplied geometry (paste GeoJSON — or use the territory editor above)</div>
          <textarea
            className="h-24 w-full rounded-lg border border-border bg-surface p-2 font-mono text-xs text-ink"
            placeholder='GeoJSON Polygon or MultiPolygon, e.g. {"type":"Polygon","coordinates":[[[...]]]}'
            value={geometryText}
            onChange={(e) => setGeometryText(e.target.value)}
            data-testid="tc-geometry-input"
          />
          <button onClick={attachGeometry} className="rounded-lg border border-border px-3 py-1 text-xs text-ink hover:bg-white/5" data-testid="tc-attach-geometry">
            Publish territory with this geometry
          </button>
        </div>
      )}

      {isOpen(candidate) && (
        <div className="space-y-2 border-t border-border/60 pt-3">
          <textarea
            className="h-14 w-full rounded-lg border border-border bg-surface p-2 text-xs text-ink"
            placeholder="Review note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <label className="flex items-start gap-2 text-xs text-ink-dim">
            <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} data-testid="tc-confirm" />
            <span>
              I have reviewed the source and confirm this change.{" "}
              {cmp?.canReuseGeometry
                ? "Approval will supersede the current polygon: the old version is closed and a new version starts at the reported time."
                : "No single polygon can be safely reused, so approval records the change as pending geometry — no polygon is created or modified."}
            </span>
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              disabled={!confirm}
              onClick={() => post("review", { action: "approve", note })}
              className="rounded-lg bg-ink px-3 py-1 text-xs text-bg disabled:opacity-40"
              data-testid="tc-approve"
            >
              Approve
            </button>
            <button onClick={() => post("review", { action: "reject", note })} className="rounded-lg border border-border px-3 py-1 text-xs text-ink-dim hover:bg-white/5" data-testid="tc-reject">
              Reject
            </button>
            <button onClick={() => post("review", { action: "uncertain", note })} className="rounded-lg border border-border px-3 py-1 text-xs text-ink hover:bg-white/5" data-testid="tc-uncertain">
              Mark uncertain
            </button>
          </div>
          {mergeTargets.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="rounded-lg border border-border bg-surface px-2 py-1 text-xs text-ink"
                value={mergeInto}
                onChange={(e) => setMergeInto(e.target.value)}
                data-testid="tc-merge-select"
              >
                <option value="">Merge with existing candidate…</option>
                {mergeTargets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {changeLabel(t.changeType)} — {t.locationName ?? "unknown place"} ({t.claimedActorName ?? "no controller"})
                  </option>
                ))}
              </select>
              <button
                disabled={!mergeInto}
                onClick={() => post("review", { action: "merge", mergeIntoId: mergeInto, note })}
                className="rounded-lg border border-border px-3 py-1 text-xs text-ink hover:bg-white/5 disabled:opacity-40"
                data-testid="tc-merge"
              >
                Merge
              </button>
            </div>
          )}
        </div>
      )}
      {error && (
        <p className="text-xs text-red-400" data-testid="tc-error">
          {error}
        </p>
      )}
    </div>
  );
}

export default function AdminTerritorialChangesPage() {
  const [tab, setTab] = useState<Tab>("open");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data: candidates = [], isLoading } = useQuery<TerritorialChangeCandidateDTO[]>({
    queryKey: ["admin", "territorial-changes"],
    queryFn: async () => (await fetch("/api/admin/territorial-change-candidates")).json(),
  });

  const open = candidates.filter(isOpen);
  const pendingGeometry = candidates.filter((c) => c.status === "approved" && c.geometryPending);
  const resolved = candidates.filter((c) => !isOpen(c));
  const rows = tab === "open" ? open : tab === "geometry" ? pendingGeometry : resolved;
  const selected = candidates.find((c) => c.id === selectedId);

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "open", label: "Open review", count: open.length },
    { id: "geometry", label: "Pending geometry", count: pendingGeometry.length },
    { id: "resolved", label: "Resolved", count: resolved.length },
  ];

  return (
    <div className="space-y-4" data-testid="territorial-changes-page">
      <div>
        <h1 className="text-lg font-semibold text-ink">Territorial Changes</h1>
        <p className="text-sm text-ink-dim">
          Sourced reports that imply a change in control. Nothing changes on the map until you explicitly approve — and
          approval never overwrites history. Areas of Operation are not Territorial Control and never appear here.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setTab(t.id);
              setSelectedId(null);
            }}
            className={cn("rounded-full px-3 py-1.5 text-sm", tab === t.id ? "bg-ink text-bg" : "text-ink-dim hover:text-ink")}
            data-testid={`tc-tab-${t.id}`}
          >
            {t.label} ({t.count})
          </button>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card className="overflow-x-auto p-0">
          {isLoading ? (
            <p className="p-4 text-sm text-ink-dim">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="p-4 text-sm text-ink-dim" data-testid="tc-empty">
              Nothing here.
            </p>
          ) : (
            <table className="w-full text-left text-sm" data-testid="tc-table">
              <thead className="text-xs uppercase text-ink-faint">
                <tr>
                  <th className="px-3 py-2">Location</th>
                  <th className="px-3 py-2">Change</th>
                  <th className="px-3 py-2">Controller</th>
                  <th className="px-3 py-2">Precision</th>
                  <th className="px-3 py-2">Comparison</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => setSelectedId(c.id)}
                    className={cn("cursor-pointer border-t border-border/60 hover:bg-white/5", selectedId === c.id && "bg-white/5")}
                    data-testid="tc-row"
                  >
                    <td className="px-3 py-2 text-ink">{c.locationName ?? "—"}</td>
                    <td className="px-3 py-2 text-ink-dim">{changeLabel(c.changeType)}</td>
                    <td className="px-3 py-2 text-ink-dim">{c.claimedActorName ?? "—"}</td>
                    <td className="px-3 py-2 text-ink-dim">{PRECISION_LABEL[c.precision]}</td>
                    <td className="px-3 py-2 text-xs text-ink-dim">{c.comparison ? COMPARISON_LABEL[c.comparison.outcome] : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card className="p-4">
          {selected ? <CandidatePanel key={selected.id} candidate={selected} all={candidates} /> : <p className="text-sm text-ink-dim">Select a candidate to review.</p>}
        </Card>
      </div>
    </div>
  );
}
