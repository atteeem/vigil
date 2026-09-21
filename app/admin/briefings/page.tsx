"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { BRIEF_WINDOWS, type BriefDevelopment, type BriefExclusion, type EscalationAssessment, type HotspotAssessment } from "@/lib/brief/types";

interface Inspection {
  range: { from: string; to: string; window: string; live: boolean };
  revision: string;
  cached: boolean;
  computeMs: number;
  stats: { computes: number; hits: number };
  developments: BriefDevelopment[];
  excluded: BriefExclusion[];
  escalation: EscalationAssessment[];
  hotspots: HotspotAssessment[];
  hiddenPartyClaims: number;
}

const field = "rounded-md border border-border bg-surface px-2 py-1 text-sm text-ink";

/** Briefing inspector: every development with its significance / confidence reasoning, what was excluded and
 * why, the escalation assessments with their signals, and the hotspot calculations. For tuning. */
export default function AdminBriefingsPage() {
  const [window, setWindow] = useState("6h");
  const [asOf, setAsOf] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const custom = window === "custom";
  const qs = new URLSearchParams({ window });
  if (custom && from && to) {
    qs.set("from", new Date(from).toISOString());
    qs.set("to", new Date(to).toISOString());
  } else if (asOf) qs.set("asOf", new Date(asOf).toISOString());
  const { data, error, isFetching } = useQuery<Inspection>({
    queryKey: ["admin", "briefings", qs.toString()],
    queryFn: async () => {
      const r = await fetch(`/api/admin/briefings?${qs.toString()}`);
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${r.status}`);
      return (await r.json()) as Inspection;
    },
    enabled: !custom || (!!from && !!to),
  });
  return (
    <div className="space-y-6" data-testid="admin-briefings">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-ink-dim">
          Window
          <select value={window} onChange={(e) => setWindow(e.target.value)} className={`${field} ml-2`} data-testid="admin-window">
            {BRIEF_WINDOWS.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </label>
        {custom ? (
          <>
            <label className="text-xs text-ink-dim">
              From <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} className={field} />
            </label>
            <label className="text-xs text-ink-dim">
              To <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} className={field} />
            </label>
          </>
        ) : (
          <label className="text-xs text-ink-dim">
            As of (optional) <input type="datetime-local" value={asOf} onChange={(e) => setAsOf(e.target.value)} className={field} />
          </label>
        )}
        {data && (
          <p className="text-xs text-ink-faint" data-testid="admin-brief-meta">
            {data.range.from.slice(0, 16)} → {data.range.to.slice(0, 16)} · revision {data.revision.slice(0, 24)}… · {data.cached ? "cached" : `computed in ${data.computeMs} ms`} · {data.stats.computes} computes / {data.stats.hits} cache hits {isFetching ? "· refreshing" : ""}
          </p>
        )}
      </div>
      {error && <p className="text-sm text-red-300">{(error as Error).message}</p>}
      {data && (
        <>
          <section data-testid="admin-developments">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-faint">Developments ({data.developments.length}; {data.hiddenPartyClaims} party claims hidden from default briefs)</h2>
            <Card className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-ink-faint">
                  <tr>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">Title</th>
                    <th className="px-3 py-2">Sig.</th>
                    <th className="px-3 py-2">Conf.</th>
                    <th className="px-3 py-2">Evidence</th>
                    <th className="px-3 py-2">Why it is included</th>
                  </tr>
                </thead>
                <tbody>
                  {data.developments.map((d) => (
                    <tr key={d.id} className="border-t border-border align-top" data-testid="admin-dev-row" data-dev-type={d.developmentType}>
                      <td className="px-3 py-2 whitespace-nowrap">{d.developmentType}</td>
                      <td className="px-3 py-2">{d.title}</td>
                      <td className="px-3 py-2 tabular-nums">{d.significance}</td>
                      <td className="px-3 py-2 tabular-nums">{Math.round(d.confidence * 100)}%</td>
                      <td className="px-3 py-2">{d.evidence.text}</td>
                      <td className="px-3 py-2 text-ink-dim">
                        {d.reasons.join("; ")} · significance: {d.significanceReasons.join(", ")} · confidence: {d.confidenceReasons.join("; ")}
                      </td>
                    </tr>
                  ))}
                  {data.developments.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-4 text-center text-ink-faint">
                        No developments in this window.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Card>
          </section>

          <section data-testid="admin-excluded">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-faint">Excluded ({data.excluded.length}) — and why</h2>
            <Card className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <tbody>
                  {data.excluded.slice(0, 200).map((x, i) => (
                    <tr key={`${x.id}-${i}`} className="border-t border-border align-top" data-testid="admin-excluded-row">
                      <td className="px-3 py-2 whitespace-nowrap">{x.developmentType}</td>
                      <td className="px-3 py-2">{x.title}</td>
                      <td className="px-3 py-2 text-ink-dim">{x.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </section>

          <section data-testid="admin-escalation">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-faint">Escalation / de-escalation reasoning</h2>
            <div className="space-y-2">
              {data.escalation.map((e) => (
                <Card key={e.conflictSlug} className="p-3 text-xs" data-testid="admin-escalation-row">
                  <p className="font-medium text-ink">
                    {e.conflictName}: {e.trend} (score {e.score}, {e.confidenceLabel} confidence)
                  </p>
                  <p className="mt-1 text-ink-faint">
                    window {e.metrics.windowEvents} incidents ({e.metrics.windowSevere} high-severity) · previous 7 days {e.metrics.baselineEvents} · new areas {e.metrics.newCells}
                  </p>
                  <ul className="mt-1 list-disc pl-4 text-ink-dim">
                    {e.signals.map((s) => (
                      <li key={s.name}>
                        {s.name} ({s.delta > 0 ? "+" : ""}
                        {s.delta}): {s.detail}
                      </li>
                    ))}
                    {e.signals.length === 0 && <li>{e.reasons[0]}</li>}
                  </ul>
                </Card>
              ))}
            </div>
          </section>

          <section data-testid="admin-hotspots">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-faint">Hotspot calculations</h2>
            <div className="space-y-2">
              {data.hotspots.map((h) => (
                <Card key={h.key} className="p-3 text-xs" data-testid="admin-hotspot-row">
                  <p className="font-medium text-ink">
                    {h.label}: {h.label2} (change {h.score}/100)
                  </p>
                  <p className="mt-1 text-ink-faint">
                    {h.metrics.windowEvents} incidents vs {h.metrics.expectedEvents} expected · severity {h.metrics.baselineMeanSeverity ?? "—"} → {h.metrics.windowMeanSeverity ?? "—"} · new areas {h.metrics.newCells} · territorial claims {h.metrics.territorialClaims}
                  </p>
                  <ul className="mt-1 list-disc pl-4 text-ink-dim">
                    {h.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </Card>
              ))}
              {data.hotspots.length === 0 && <p className="text-xs text-ink-faint">No hotspots above the detection threshold.</p>}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
