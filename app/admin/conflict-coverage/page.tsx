"use client";

import { Fragment, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { CoverageResult, CoverageRowDTO } from "@/lib/db/repositories/coverage";
import { REGISTRY_STATUS_LABEL, type RegistryStatus } from "@/lib/registry/status";

// Admin coverage tool: which conflicts the registry tracks, how well they are
// sourced and how fresh that coverage is. Not a public ranking.

const HEALTH_LABEL: Record<string, string> = { healthy: "Healthy", weak: "Weak", stale: "Stale", no_source: "No source", inactive: "Inactive" };
const HEALTH_STYLE: Record<string, string> = {
  healthy: "border-emerald-500/40 text-emerald-300",
  weak: "border-amber-500/50 text-amber-300",
  stale: "border-orange-500/50 text-orange-300",
  no_source: "border-red-500/50 text-red-300",
  inactive: "border-border text-ink-faint",
};
const KIND_LABEL: Record<string, string> = { dedicated: "Dedicated", specialist_local: "Specialist/local", general: "General", aggregator: "Aggregator/relay" };

interface Filters {
  region: string;
  status: string;
  severity: string;
  health: string;
  dedicated: string;
  territorial: string;
}
const NO_FILTERS: Filters = { region: "", status: "", severity: "", health: "", dedicated: "", territorial: "" };

interface Detail extends CoverageRowDTO {
  provenance: { field: string; sourceName: string; sourceUrl: string | null; note: string | null }[];
  candidates: { id: string; name: string; url: string | null; sourceType: string; language: string | null; status: string; notes: string | null }[];
  familyMembers: { id: string; slug: string; name: string; status: string }[];
}

function ago(iso: string | null): string {
  if (!iso) return "—";
  const hours = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m ago`;
  if (hours < 48) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function Codes({ label, codes, testId }: { label: string; codes: string[]; testId: string }) {
  return (
    <div data-testid={testId}>
      <div className="text-xs uppercase tracking-wide text-ink-faint">{label}</div>
      <div className="text-ink-dim">{codes.length > 0 ? codes.join(", ") : "—"}</div>
    </div>
  );
}

function DetailPanel({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const { data } = useQuery<Detail>({ queryKey: ["admin", "conflict-coverage", id], queryFn: async () => (await fetch(`/api/admin/conflict-coverage/${id}`)).json() });
  const [form, setForm] = useState({ name: "", url: "", sourceType: "news", language: "", notes: "" });
  const [error, setError] = useState<string | null>(null);
  if (!data) return <p className="p-3 text-sm text-ink-dim">Loading…</p>;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin", "conflict-coverage"] });
  async function addCandidate() {
    setError(null);
    const res = await fetch("/api/admin/source-candidates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conflictId: id, name: form.name, url: form.url || null, sourceType: form.sourceType, language: form.language || null, notes: form.notes || null }),
    });
    if (!res.ok) return setError(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Could not add");
    setForm({ name: "", url: "", sourceType: "news", language: "", notes: "" });
    refresh();
  }
  async function setStatus(candidateId: string, status: string) {
    await fetch(`/api/admin/source-candidates/${candidateId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    refresh();
  }

  return (
    <div className="space-y-4 p-4 text-sm" data-testid="cov-detail">
      <div className="grid gap-3 sm:grid-cols-3">
        <Codes label="Fighting occurs in" codes={data.geography.fighting} testId="cov-geo-fighting" />
        <Codes label="Belligerents / participants" codes={data.geography.participants} testId="cov-geo-participants" />
        <Codes label="External supporters" codes={data.geography.supporters} testId="cov-geo-supporters" />
      </div>
      <div className="text-xs text-ink-faint">
        Geography basis: <span data-testid="cov-geo-basis">{data.geography.basis}</span>
        {data.geography.basis === "legacy_countries" && " — backfilled from the old countries list; review it."}
        {data.conflict.classificationNote && (
          <div className="mt-1" data-testid="cov-classification">
            Classification ({data.conflict.classificationConfidence}): {data.conflict.classificationNote}
          </div>
        )}
      </div>
      {data.family && (
        <div data-testid="cov-family">
          <div className="text-xs uppercase tracking-wide text-ink-faint">Family: {data.family.name}</div>
          <div className="text-ink-dim">{data.familyMembers.length > 0 ? `Also: ${data.familyMembers.map((m) => m.name).join(" · ")}` : "No other members"}</div>
        </div>
      )}
      <div>
        <div className="text-xs uppercase tracking-wide text-ink-faint">Actors ({data.actors.length})</div>
        <div className="text-ink-dim" data-testid="cov-actors">
          {data.actors.length > 0 ? data.actors.map((a) => `${a.name} (${a.role})`).join(" · ") : "None recorded"}
        </div>
      </div>
      <div>
        <div className="text-xs uppercase tracking-wide text-ink-faint">Relevant sources ({data.sources.length})</div>
        <ul className="text-ink-dim" data-testid="cov-sources">
          {data.sources.length === 0 && <li>None</li>}
          {data.sources.map((s) => (
            <li key={s.id}>
              {s.name} — {KIND_LABEL[s.kind]} ({s.link}){s.enabled ? "" : " · disabled"} · last ingest {ago(s.lastSuccessfulIngestion)}
            </li>
          ))}
        </ul>
        <p className="mt-1 text-xs text-ink-faint">Diversity counts sources, not articles; all aggregators/relays together count once.</p>
      </div>
      <div>
        <div className="text-xs uppercase tracking-wide text-ink-faint">Metadata provenance</div>
        <ul className="text-xs text-ink-dim" data-testid="cov-provenance">
          {data.provenance.map((p) => (
            <li key={`${p.field}-${p.sourceName}`}>
              {p.field}: {p.sourceUrl ? <a className="text-accent hover:underline" href={p.sourceUrl} target="_blank" rel="noreferrer">{p.sourceName}</a> : p.sourceName}
            </li>
          ))}
          {data.provenance.length === 0 && <li>No provenance recorded.</li>}
        </ul>
      </div>
      <div>
        <div className="text-xs uppercase tracking-wide text-ink-faint">Candidate sources (backlog — never scraped)</div>
        <ul className="space-y-1" data-testid="cov-candidates">
          {data.candidates.length === 0 && <li className="text-ink-faint">None yet.</li>}
          {data.candidates.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 text-ink-dim" data-testid={`cov-candidate-${c.name}`}>
              <span>
                {c.name} · {c.sourceType}
                {c.language ? ` · ${c.language}` : ""}
              </span>
              <select className="rounded border border-border bg-surface px-1 py-0.5 text-xs" value={c.status} onChange={(e) => setStatus(c.id, e.target.value)} aria-label={`Status of ${c.name}`}>
                {["candidate", "approved", "integrated", "rejected"].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
        <div className="mt-2 grid gap-2 sm:grid-cols-5">
          <input className="rounded border border-border bg-surface px-2 py-1 text-xs" placeholder="Source name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="cov-candidate-name" />
          <input className="rounded border border-border bg-surface px-2 py-1 text-xs" placeholder="https://…" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} data-testid="cov-candidate-url" />
          <select className="rounded border border-border bg-surface px-2 py-1 text-xs" value={form.sourceType} onChange={(e) => setForm({ ...form, sourceType: e.target.value })}>
            {["news", "local_media", "ngo", "official", "monitor", "social", "other"].map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <input className="rounded border border-border bg-surface px-2 py-1 text-xs" placeholder="Language" value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })} />
          <button className="rounded border border-border px-2 py-1 text-xs text-ink hover:bg-white/5" onClick={addCandidate} data-testid="cov-candidate-add">
            Add candidate
          </button>
        </div>
        {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
      </div>
    </div>
  );
}

function Select({ label, value, onChange, options, testId }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][]; testId: string }) {
  return (
    <label className="text-xs text-ink-faint">
      {label}
      <select className="mt-1 block rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-ink" value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId}>
        <option value="">All</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function ConflictCoveragePage() {
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [openId, setOpenId] = useState<string | null>(null);
  const query = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
  const { data, isLoading } = useQuery<CoverageResult>({
    queryKey: ["admin", "conflict-coverage", "list", query],
    queryFn: async () => (await fetch(`/api/admin/conflict-coverage?${query}`)).json(),
  });

  const s = data?.summary;
  const cards: [string, string, number | undefined][] = [
    ["active", "Active conflicts tracked", s?.activeTracked],
    ["dedicated", "With dedicated sources", s?.withDedicatedSources],
    ["territorial", "With territorial data", s?.withTerritorialData],
    ["updated6h", "Updated in last 6h", s?.updatedLast6h],
    ["updated24h", "Updated in last 24h", s?.updatedLast24h],
    ["weak", "Weak coverage", s?.weakCoverage],
    ["stale", "Stale coverage", s?.staleCoverage],
    ["nosource", "No-source conflicts", s?.noSource],
    ["noactors", "Missing actors", s?.missingActors],
    ["nogeo", "Missing / unreviewed geography", s?.missingGeography],
  ];

  return (
    <div className="space-y-4" data-testid="conflict-coverage-page">
      <div>
        <h1 className="text-lg font-semibold text-ink">Conflict coverage</h1>
        <p className="text-sm text-ink-dim">
          The registry&apos;s view of which conflicts are tracked, how well they are sourced and how fresh that coverage is. An admin tool, not a public ranking; no total is asserted as ground truth.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {cards.map(([key, label, value]) => (
          <Card key={key} className="p-3" data-testid={`cov-card-${key}`}>
            <div className="text-xl font-semibold text-ink tabular-nums" data-testid={`cov-card-${key}-value`}>
              {value ?? "…"}
            </div>
            <div className="text-[11px] text-ink-faint">{label}</div>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Select label="Region" value={filters.region} onChange={(v) => setFilters({ ...filters, region: v })} options={["Africa", "Americas", "Asia", "Europe", "Middle East"].map((r) => [r, r])} testId="cov-filter-region" />
        <Select label="Status" value={filters.status} onChange={(v) => setFilters({ ...filters, status: v })} options={(Object.keys(REGISTRY_STATUS_LABEL) as RegistryStatus[]).map((k) => [k, REGISTRY_STATUS_LABEL[k]])} testId="cov-filter-status" />
        <Select label="Severity" value={filters.severity} onChange={(v) => setFilters({ ...filters, severity: v })} options={["stable", "guarded", "elevated", "high", "severe", "extreme"].map((k) => [k, k])} testId="cov-filter-severity" />
        <Select label="Coverage health" value={filters.health} onChange={(v) => setFilters({ ...filters, health: v })} options={Object.entries(HEALTH_LABEL)} testId="cov-filter-health" />
        <Select label="Dedicated source" value={filters.dedicated} onChange={(v) => setFilters({ ...filters, dedicated: v })} options={[["true", "Has one"], ["false", "None"]]} testId="cov-filter-dedicated" />
        <Select label="Territorial data" value={filters.territorial} onChange={(v) => setFilters({ ...filters, territorial: v })} options={[["true", "Has data"], ["false", "None"]]} testId="cov-filter-territorial" />
        <button className="rounded-lg border border-border px-3 py-1.5 text-sm text-ink-dim hover:bg-white/5" onClick={() => setFilters(NO_FILTERS)} data-testid="cov-filter-reset">
          Reset
        </button>
        <span className="text-xs text-ink-faint" data-testid="cov-matched">
          {data ? `${data.matched} of ${s?.total ?? "…"} conflicts` : ""}
        </span>
      </div>

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[980px] text-left text-sm" data-testid="cov-table">
          <thead className="text-xs uppercase text-ink-faint">
            <tr>
              <th className="px-3 py-2">Conflict</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Severity</th>
              <th className="px-3 py-2">Coverage</th>
              <th className="px-3 py-2">Sources</th>
              <th className="px-3 py-2">Last event</th>
              <th className="px-3 py-2">Last ingest</th>
              <th className="px-3 py-2">Territory</th>
              <th className="px-3 py-2">Metadata</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td className="px-3 py-6 text-ink-dim" colSpan={9}>
                  Loading…
                </td>
              </tr>
            )}
            {data?.rows.map((r) => (
              <Fragment key={r.conflict.id}>
                <tr className={cn("cursor-pointer border-t border-border/60 hover:bg-white/5", openId === r.conflict.id && "bg-white/5")} onClick={() => setOpenId(openId === r.conflict.id ? null : r.conflict.id)} data-testid={`cov-row-${r.conflict.slug}`}>
                  <td className="px-3 py-2 text-ink">
                    {r.conflict.name}
                    <div className="text-[11px] text-ink-faint">
                      {r.conflict.region}
                      {r.family ? ` · ${r.family.name}` : ""}
                      {r.conflict.classificationConfidence !== "established" ? ` · classification ${r.conflict.classificationConfidence}` : ""}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-ink-dim" data-testid={`cov-status-${r.conflict.slug}`}>
                    {REGISTRY_STATUS_LABEL[r.status]}
                  </td>
                  <td className="px-3 py-2 text-ink-dim">{r.conflict.severity}</td>
                  <td className="px-3 py-2">
                    <span className={cn("rounded-full border px-2 py-0.5 text-xs", HEALTH_STYLE[r.health])} data-testid={`cov-health-${r.conflict.slug}`} title={r.reasons.join(" ")}>
                      {HEALTH_LABEL[r.health]}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-ink-dim" data-testid={`cov-sources-${r.conflict.slug}`}>
                    {r.enabledSources} ({r.dedicatedSources} dedicated · {r.specialistSources} local · {r.generalSources} general · {r.aggregatorSources} aggr)
                  </td>
                  <td className="px-3 py-2 text-ink-faint">{ago(r.latestEventAt)}</td>
                  <td className="px-3 py-2 text-ink-faint">{ago(r.latestSourceAt)}</td>
                  <td className="px-3 py-2 text-ink-dim">{r.hasTerritorialData ? `${r.territorialAreas} area${r.territorialAreas === 1 ? "" : "s"}` : "—"}</td>
                  <td className="px-3 py-2 text-xs text-amber-300" data-testid={`cov-flags-${r.conflict.slug}`}>
                    {[r.flags.missingActors && "no actors", r.flags.missingFightingGeography && "no fighting geography", r.flags.missingParticipants && "no participants", r.flags.unreviewedGeography && "geography unreviewed"].filter(Boolean).join(", ") || <span className="text-ink-faint">complete</span>}
                  </td>
                </tr>
                {openId === r.conflict.id && (
                  <tr className="border-t border-border/60 bg-black/20">
                    <td colSpan={9}>
                      <DetailPanel id={r.conflict.id} />
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
