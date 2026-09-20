"use client";

import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { RelativeTime } from "@/components/ui/relative-time";
import { cn } from "@/lib/utils";

interface ProviderRow {
  id: string;
  name: string;
  provider: string | null;
  layer: string | null;
  enabled: boolean;
  pollIntervalMinutes: number;
  lastSuccessAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  nextPollAt: string | null;
  backingOff: boolean;
  health: "ok" | "stale" | "error" | "backing_off" | "disabled" | "needs_credentials" | "never_run";
  access: { requiresCredentials: boolean; env: string[]; missing: string[]; signup: string | null };
  events: { total: number; active: number };
  trustClass: string | null;
  notes: string | null;
}
interface RawEvent {
  id: string;
  providerEventId: string;
  title: string;
  category: string;
  status: string | null;
  revision: number;
  metadata: unknown;
}

const HEALTH_LABEL: Record<ProviderRow["health"], string> = { ok: "Healthy", stale: "Stale", error: "Last poll failed", backing_off: "Backing off", disabled: "Disabled", needs_credentials: "Needs credentials", never_run: "Not yet polled" };

/** Structured data providers (earthquakes, aviation, maritime, energy, internet ...): status, health,
 * backoff, event counts, access requirements, and raw provider metadata for inspection. */
export default function AdminLiveDataPage() {
  const [open, setOpen] = useState<string | null>(null);
  const { data: rows = [], isLoading } = useQuery<ProviderRow[]>({ queryKey: ["admin", "live-data"], queryFn: async () => (await fetch("/api/admin/live-data")).json(), refetchInterval: 30_000 });
  const provider = rows.find((r) => r.id === open)?.provider;
  const { data: events = [] } = useQuery<RawEvent[]>({ queryKey: ["admin", "global-events", provider], enabled: !!provider, queryFn: async () => (await fetch(`/api/admin/global-events?provider=${provider}&limit=8`)).json() });

  return (
    <div data-testid="admin-live-data">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-ink">Live Data Providers</h1>
        <p className="text-xs text-ink-faint">Structured sensor, official and operator feeds — not news sources.</p>
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wide text-ink-faint">
              <th className="px-4 py-3">Provider</th>
              <th className="px-4 py-3">Layer</th>
              <th className="px-4 py-3">Health</th>
              <th className="px-4 py-3">Last success</th>
              <th className="px-4 py-3">Events</th>
              <th className="px-4 py-3">Access</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-ink-faint">
                  Loading…
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <Fragment key={r.id}>
                <tr data-testid={`live-provider-${r.provider}`} onClick={() => setOpen(open === r.id ? null : r.id)} className="cursor-pointer border-b border-border/60 hover:bg-white/5">
                  <td className="px-4 py-3 font-medium text-ink">
                    {r.name}
                    <span className="block text-[11px] font-normal text-ink-faint">{r.provider} · every {r.pollIntervalMinutes} min</span>
                  </td>
                  <td className="px-4 py-3 text-ink-dim">{r.layer ?? "—"}</td>
                  <td className="px-4 py-3" data-testid="live-health">
                    <span className={cn("text-xs font-medium", r.health === "ok" ? "text-green-400" : r.health === "disabled" ? "text-ink-faint" : "text-elevated")}>{HEALTH_LABEL[r.health]}</span>
                    {r.backingOff && r.nextPollAt && <span className="block text-[11px] text-ink-faint">next try <RelativeTime iso={r.nextPollAt} /> ({r.consecutiveFailures} failure{r.consecutiveFailures === 1 ? "" : "s"})</span>}
                    {r.lastError && <span className="block max-w-xs truncate text-[11px] text-ink-faint" title={r.lastError}>{r.lastError}</span>}
                  </td>
                  <td className="px-4 py-3 text-ink-dim">{r.lastSuccessAt ? <RelativeTime iso={r.lastSuccessAt} /> : "never"}</td>
                  <td className="px-4 py-3 text-ink-dim">{r.events.active} active / {r.events.total}</td>
                  <td className="px-4 py-3 text-xs text-ink-dim">
                    {r.access.requiresCredentials ? (
                      <span>
                        Credentials {r.access.missing.length ? "missing" : "configured"} <span className="text-ink-faint">({r.access.env.join(", ")})</span>
                      </span>
                    ) : (
                      "Keyless public API"
                    )}
                  </td>
                </tr>
                {open === r.id && (
                  <tr className="border-b border-border/60 bg-surface/40">
                    <td colSpan={6} className="px-4 py-3 text-xs text-ink-dim">
                      <p className="mb-2">{r.notes}</p>
                      <p className="mb-1 font-medium text-ink">Recent events (raw provider metadata)</p>
                      {events.length === 0 && <p className="text-ink-faint">No stored events.</p>}
                      {events.map((e) => (
                        <details key={e.id} className="mb-1">
                          <summary className="cursor-pointer">
                            {e.title} <span className="text-ink-faint">· {e.category} · {e.status ?? "—"} · rev {e.revision}</span>
                          </summary>
                          <pre className="mt-1 max-h-48 overflow-auto rounded bg-black/30 p-2 text-[10px]">{JSON.stringify(e.metadata, null, 2)}</pre>
                        </details>
                      ))}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
