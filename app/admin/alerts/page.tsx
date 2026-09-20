"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { RelativeTime } from "@/components/ui/relative-time";

interface AlertRecordRow {
  id: string;
  createdAt: string;
  signalKind: string;
  fingerprint: string;
  alertType: string;
  entityType: string;
  entityKey: string;
  watcherId: string | null;
  decision: string;
  rule: string | null;
  priority: string | null;
  notificationId: string | null;
  detail: { title?: string } | null;
}
interface NotifRow {
  id: string;
  title: string;
  priority: string;
  fingerprint: string;
  entityLabel: string;
  suppressedCount: number;
  createdAt: string;
  reason: { rule?: string };
}
interface Simulation {
  developments: number;
  results: { fingerprint: string; title: string; candidates: { type: string; key: string }[]; matches: { watchId: string; watcherId: string; label: string; entityType: string; decision: string; rule: string | null; priority: string | null; priorityScore: number | null; wouldNotify: boolean }[] }[];
}

const field = "rounded-md border border-border bg-surface px-2 py-1 text-sm text-ink";

/** Alert inspector: why watchers did or did not get an alert, plus a read-only simulator. */
export default function AdminAlertsPage() {
  const [decision, setDecision] = useState("");
  const { data } = useQuery<{ stats: Record<string, unknown> & { decisions: Record<string, number> }; records: AlertRecordRow[]; notifications: NotifRow[] }>({
    queryKey: ["admin", "alerts", decision],
    queryFn: async () => (await fetch(`/api/admin/alerts${decision ? `?decision=${decision}` : ""}`)).json(),
    refetchInterval: 15_000,
  });
  const [kind, setKind] = useState("global_event");
  const [id, setId] = useState("");
  const [sim, setSim] = useState<Simulation | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setError(null);
    const res = await fetch("/api/admin/alerts/simulate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, id }) });
    if (!res.ok) return setError(((await res.json()) as { error?: string }).error ?? "Failed");
    setSim((await res.json()) as Simulation);
  }

  return (
    <div className="space-y-4" data-testid="admin-alerts">
      <h1 className="text-lg font-semibold text-ink">Alert inspector</h1>
      <Card className="p-4">
        <h2 className="mb-2 text-sm font-semibold text-ink">Simulate: if this happened, which watches would match?</h2>
        <div className="flex flex-wrap items-center gap-2">
          <select className={field} value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind" data-testid="sim-kind">
            {["global_event", "event", "territorial_change", "claim", "conflict"].map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
          <input className={`${field} w-72`} placeholder="Record id" value={id} onChange={(e) => setId(e.target.value)} aria-label="Record id" data-testid="sim-id" />
          <button onClick={run} className="rounded-md border border-accent/40 px-3 py-1 text-sm text-accent" data-testid="sim-run">
            Simulate
          </button>
          {error && <span className="text-xs text-elevated">{error}</span>}
        </div>
        {sim && (
          <div className="mt-3 text-xs text-ink-dim" data-testid="sim-result">
            <p>{sim.developments} development(s) derived (nothing was written).</p>
            {sim.results.map((r) => (
              <div key={r.fingerprint} className="mt-2 rounded-lg border border-border p-2">
                <p className="font-medium text-ink">{r.title}</p>
                <p className="text-ink-faint">{r.fingerprint}</p>
                <p className="text-ink-faint">Candidate keys: {r.candidates.map((c) => `${c.type}:${c.key}`).join(", ")}</p>
                {r.matches.length === 0 ? <p>No watches match.</p> : r.matches.map((m) => (
                  <p key={m.watchId} data-testid="sim-match">
                    {m.entityType} “{m.label}” — <b>{m.decision}</b>{m.priority ? ` · ${m.priority} (${m.priorityScore})` : ""}{m.rule ? ` · ${m.rule}` : ""}
                  </p>
                ))}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-4 text-xs text-ink-dim" data-testid="alert-stats">
        <p>
          Watchers {String(data?.stats.watchers ?? "…")} · watches {String(data?.stats.watches ?? "…")} · developments evaluated {String(data?.stats.developments ?? 0)} · watch queries {String(data?.stats.watchQueries ?? 0)} · notifications {String(data?.stats.notifications ?? 0)} · duplicates suppressed {String(data?.stats.duplicatesSuppressed ?? 0)}
        </p>
        <p className="mt-1">Decisions: {Object.entries(data?.stats.decisions ?? {}).map(([k, v]) => `${k} ${v}`).join(" · ") || "none yet"}</p>
      </Card>

      <Card className="overflow-x-auto">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">Decisions</h2>
          <select className={field} value={decision} onChange={(e) => setDecision(e.target.value)} aria-label="Filter by decision">
            <option value="">all</option>
            {["notified", "merged_watch", "suppressed_duplicate", "below_threshold", "party_claim_hidden", "muted", "paused", "category_off", "below_min_priority", "resolution_off", "not_material"].map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </div>
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-border text-ink-faint">
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Development</th>
              <th className="px-3 py-2">Watch</th>
              <th className="px-3 py-2">Decision</th>
              <th className="px-3 py-2">Rule / priority</th>
            </tr>
          </thead>
          <tbody>
            {(data?.records ?? []).map((r) => (
              <tr key={r.id} className="border-b border-border/50 align-top" data-testid="alert-record" data-decision={r.decision}>
                <td className="px-3 py-2"><RelativeTime iso={r.createdAt} /></td>
                <td className="px-3 py-2">
                  {r.detail?.title ?? r.alertType}
                  <span className="block text-[10px] text-ink-faint">{r.fingerprint}</span>
                </td>
                <td className="px-3 py-2">{r.entityType}:{r.entityKey}</td>
                <td className="px-3 py-2 font-medium text-ink">{r.decision}</td>
                <td className="px-3 py-2">{r.priority ?? "—"} {r.rule && <span className="text-ink-faint">· {r.rule}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="p-4">
        <h2 className="mb-2 text-sm font-semibold text-ink">Generated notifications</h2>
        <ul className="space-y-1 text-xs text-ink-dim">
          {(data?.notifications ?? []).map((n) => (
            <li key={n.id}>
              <b>{n.priority}</b> {n.title} — {n.entityLabel} {n.suppressedCount > 0 && <span className="text-ink-faint">(+{n.suppressedCount} merged)</span>}
              <span className="block text-[10px] text-ink-faint">{n.fingerprint}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
