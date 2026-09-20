"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { ENTITY_TYPES } from "@/lib/military/entity-types";
import type { AuditRow } from "@/lib/military/audit";

interface Review {
  id: string;
  matchedText: string;
  reason: string;
  reportTitle: string;
  reportUrl: string | null;
  candidates: { id: string; name: string }[];
}

interface Inspect {
  aliases: { id: string; alias: string; aliasType: string; sourceName: string | null }[];
  parentHistory: { id: string; parent: { name: string } | null; validFrom: string | null; validTo: string | null; sourceName: string | null }[];
  appointments: { id: string; role: string; commander: { name: string }; startDate: string | null; endDate: string | null; sourceName: string | null }[];
  relationships: { id: string; relationType: string; from: { name: string }; to: { name: string }; sourceName: string | null }[];
}

const FLAGS = [
  { id: "", label: "All" },
  { id: "stale", label: "Stale relationships" },
  { id: "missing_provenance", label: "Missing provenance" },
  { id: "unresolved_aliases", label: "Unresolved aliases" },
  { id: "untyped", label: "Untyped" },
];

const field = "rounded-md border border-border bg-surface px-2 py-1 text-sm text-ink";

export function IntelligenceAudit() {
  const qc = useQueryClient();
  const [filters, setFilters] = useState({ entityType: "", country: "", source: "", q: "", flag: "" });
  const [selected, setSelected] = useState<string | null>(null);
  const [aliasText, setAliasText] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
  const { data } = useQuery<{ rows: AuditRow[]; total: number; matched: number }>({
    queryKey: ["admin", "military-audit", qs],
    queryFn: async () => (await fetch(`/api/admin/military-audit?${qs}`)).json(),
  });
  const { data: reviews = [] } = useQuery<Review[]>({
    queryKey: ["admin", "military-reviews"],
    queryFn: async () => (await fetch("/api/admin/military-reviews")).json(),
  });
  const { data: inspect } = useQuery<Inspect>({
    queryKey: ["admin", "military-relationships", selected],
    enabled: Boolean(selected),
    queryFn: async () => (await fetch(`/api/admin/military-units/${selected}/relationships`)).json(),
  });

  async function post(url: string, body: unknown) {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    setMessage(res.ok ? "Saved." : (json.error ?? json.reason ?? "Rejected."));
    await qc.invalidateQueries({ queryKey: ["admin"] });
  }

  return (
    <div className="space-y-4" data-testid="intelligence-audit">
      <Card className="flex flex-wrap items-center gap-2 p-3">
        <select aria-label="Entity type" className={field} value={filters.entityType} onChange={(e) => setFilters({ ...filters, entityType: e.target.value })}>
          <option value="">Any type</option>
          {ENTITY_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
          <option value="untyped">untyped</option>
        </select>
        <input aria-label="Country" placeholder="Country (ISO)" className={`${field} w-28`} value={filters.country} onChange={(e) => setFilters({ ...filters, country: e.target.value })} />
        <input aria-label="Source" placeholder="Source" className={`${field} w-32`} value={filters.source} onChange={(e) => setFilters({ ...filters, source: e.target.value })} />
        <input aria-label="Name or alias" placeholder="Name or alias" className={`${field} w-40`} value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
        <select aria-label="Flag" className={field} value={filters.flag} onChange={(e) => setFilters({ ...filters, flag: e.target.value })}>
          {FLAGS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
        <span className="text-xs text-ink-faint" data-testid="audit-count">
          {data ? `${data.matched} of ${data.total}` : "…"}
        </span>
      </Card>

      {message && <p className="text-xs text-ink-dim">{message}</p>}

      <div className="grid gap-4 sm:grid-cols-[1fr_360px]">
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm" data-testid="audit-table">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-ink-faint">
                <th className="px-4 py-3">Entity</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Conflicts</th>
                <th className="px-4 py-3">Flags</th>
              </tr>
            </thead>
            <tbody>
              {(data?.rows ?? []).map((r) => (
                <tr key={r.id} onClick={() => setSelected(r.id)} className="cursor-pointer border-b border-border/60 hover:bg-white/5">
                  <td className="px-4 py-3 font-medium text-ink">{r.name}</td>
                  <td className="px-4 py-3 text-ink-dim">{r.entityType ?? "—"}</td>
                  <td className="px-4 py-3 text-ink-dim">{r.conflicts.join(", ") || "—"}</td>
                  <td className="px-4 py-3 text-xs text-ink-dim">{r.flags.join(", ") || "ok"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card className="p-4 text-sm">
          {!selected || !inspect ? (
            <p className="text-ink-faint">Select an entity to inspect its aliases, hierarchy history, commanders and relationships.</p>
          ) : (
            <div className="space-y-3">
              <Link href={`/unit/${selected}`} className="text-xs text-accent underline">
                Open public page
              </Link>
              <section>
                <h3 className="text-xs uppercase text-ink-faint">Aliases</h3>
                <ul>
                  {inspect.aliases.map((a) => (
                    <li key={a.id}>
                      {a.alias} <span className="text-xs text-ink-faint">{a.aliasType}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-1 flex gap-1">
                  <input aria-label="New alias" className={`${field} flex-1`} value={aliasText} onChange={(e) => setAliasText(e.target.value)} />
                  <button
                    className="rounded-md border border-border px-2 text-xs"
                    onClick={() => {
                      void post(`/api/admin/military-units/${selected}/relationships`, { action: "add_alias", alias: aliasText, aliasType: "alternate" });
                      setAliasText("");
                    }}
                  >
                    Add
                  </button>
                </div>
              </section>
              <section>
                <h3 className="text-xs uppercase text-ink-faint">Parent history</h3>
                <ul>
                  {inspect.parentHistory.map((h) => (
                    <li key={h.id}>
                      {h.parent?.name ?? "none"} <span className="text-xs text-ink-faint">{h.validTo ? `until ${h.validTo.slice(0, 10)}` : "current"}</span>
                    </li>
                  ))}
                </ul>
              </section>
              <section>
                <h3 className="text-xs uppercase text-ink-faint">Commanders</h3>
                <ul>
                  {inspect.appointments.map((a) => (
                    <li key={a.id}>
                      {a.commander.name} — {a.role} <span className="text-xs text-ink-faint">{a.endDate ? "ended" : "current"}</span>
                    </li>
                  ))}
                </ul>
              </section>
              <section>
                <h3 className="text-xs uppercase text-ink-faint">Explicit relationships</h3>
                <ul>
                  {inspect.relationships.map((r) => (
                    <li key={r.id}>
                      {r.from.name} {r.relationType} {r.to.name} <span className="text-xs text-ink-faint">{r.sourceName ?? "no source"}</span>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          )}
        </Card>
      </div>

      <Card className="p-4" data-testid="match-reviews">
        <h3 className="mb-2 text-sm font-semibold text-ink">Ambiguous mentions ({reviews.length})</h3>
        {reviews.length === 0 && <p className="text-xs text-ink-faint">Nothing waiting for review.</p>}
        {reviews.map((r) => (
          <div key={r.id} className="mb-2 border-b border-border/60 pb-2 text-sm">
            <p className="text-ink">
              &ldquo;{r.matchedText}&rdquo; in {r.reportTitle}
            </p>
            <div className="mt-1 flex flex-wrap gap-1">
              {r.candidates.map((c) => (
                <button key={c.id} className="rounded-md border border-border px-2 py-0.5 text-xs" onClick={() => void post("/api/admin/military-reviews", { id: r.id, entityId: c.id })}>
                  Link to {c.name}
                </button>
              ))}
              <button className="rounded-md border border-border px-2 py-0.5 text-xs" onClick={() => void post("/api/admin/military-reviews", { id: r.id, entityId: null })}>
                Dismiss
              </button>
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}
