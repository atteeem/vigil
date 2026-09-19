"use client";

import { Fragment, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Pencil, Archive, Gauge } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CONFLICT_STATUSES, type ConflictDTO, type ConflictStatus } from "@/lib/types/db";
import { SEVERITY_LEVELS } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ScoresPanel } from "@/components/admin/scores-panel";

interface ConflictFormState {
  slug: string;
  name: string;
  shortName: string;
  region: string;
  countries: string; // comma-separated in the form, JSON array over the wire
  status: ConflictStatus;
  severity: string;
  intensity: string;
  startedAt: string;
  description: string;
}

const EMPTY_FORM: ConflictFormState = {
  slug: "",
  name: "",
  shortName: "",
  region: "",
  countries: "",
  status: "active",
  severity: "guarded",
  intensity: "30",
  startedAt: "",
  description: "",
};

function toPayload(form: ConflictFormState) {
  return {
    slug: form.slug.trim(),
    name: form.name.trim(),
    shortName: form.shortName.trim() || null,
    region: form.region.trim(),
    countries: form.countries
      .split(",")
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean),
    status: form.status,
    severity: form.severity,
    intensity: Number(form.intensity),
    startedAt: form.startedAt ? new Date(form.startedAt).toISOString() : null,
    summary: form.description.trim() || null,
  };
}

export default function AdminConflictsPage() {
  const queryClient = useQueryClient();
  const { data: conflicts = [], isLoading: loading } = useQuery({
    queryKey: ["admin", "conflicts"],
    queryFn: async (): Promise<ConflictDTO[]> => (await fetch("/api/admin/conflicts")).json(),
  });
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ConflictFormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [scoresOpenId, setScoresOpenId] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin", "conflicts"] });

  async function submitForm() {
    setError(null);
    if (!form.slug.trim() || !form.name.trim() || !form.region.trim()) {
      setError("Slug, name, and region are required.");
      return;
    }
    const res = await fetch(editingId ? `/api/admin/conflicts/${editingId}` : "/api/admin/conflicts", {
      method: editingId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(toPayload(form)),
    });
    if (!res.ok) {
      const err = await res.json();
      setError(err.error ?? "Save failed");
      return;
    }
    setForm(EMPTY_FORM);
    setShowForm(false);
    setEditingId(null);
    refresh();
  }

  function startEdit(c: ConflictDTO) {
    setEditingId(c.id);
    setError(null);
    setForm({
      slug: c.slug,
      name: c.name,
      shortName: c.shortName ?? "",
      region: c.region,
      countries: c.countries.join(", "),
      status: c.status,
      severity: c.severity,
      intensity: String(c.intensity),
      startedAt: c.startedAt ? c.startedAt.slice(0, 10) : "",
      description: c.summary ?? "",
    });
    setShowForm(true);
  }

  async function setStatus(c: ConflictDTO, status: ConflictStatus) {
    await fetch(`/api/admin/conflicts/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    refresh();
  }

  async function removeConflict(c: ConflictDTO) {
    if (!confirm(`Delete "${c.name}"? Only allowed if no events are linked.`)) return;
    const res = await fetch(`/api/admin/conflicts/${c.id}`, { method: "DELETE" });
    if (!res.ok) {
      const err = await res.json();
      alert(err.error ?? "Delete failed");
      return;
    }
    refresh();
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-ink">Conflicts</h1>
        <Button
          size="sm"
          variant="accent"
          onClick={() => {
            setForm(EMPTY_FORM);
            setEditingId(null);
            setError(null);
            setShowForm((v) => !v);
          }}
        >
          <Plus className="h-3.5 w-3.5" /> Create Conflict
        </Button>
      </div>

      {showForm && (
        <Card className="mb-4 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-ink-faint">
              Slug
              <input
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value })}
                placeholder="e.g. russia-ukraine"
                disabled={Boolean(editingId)}
              />
            </label>
            <label className="text-xs text-ink-faint">
              Name
              <input
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label className="text-xs text-ink-faint">
              Short name
              <input
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                value={form.shortName}
                onChange={(e) => setForm({ ...form, shortName: e.target.value })}
              />
            </label>
            <label className="text-xs text-ink-faint">
              Region
              <input
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                value={form.region}
                onChange={(e) => setForm({ ...form, region: e.target.value })}
                placeholder="Europe / Middle East / …"
              />
            </label>
            <label className="text-xs text-ink-faint">
              Countries (comma-separated ISO codes)
              <input
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                value={form.countries}
                onChange={(e) => setForm({ ...form, countries: e.target.value })}
                placeholder="UA, RU"
              />
            </label>
            <label className="text-xs text-ink-faint">
              Status
              <select
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value as ConflictStatus })}
              >
                {CONFLICT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-ink-faint">
              Severity
              <select
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                value={form.severity}
                onChange={(e) => setForm({ ...form, severity: e.target.value })}
              >
                {SEVERITY_LEVELS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-ink-faint">
              Intensity (0–100)
              <input
                type="number"
                min={0}
                max={100}
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                value={form.intensity}
                onChange={(e) => setForm({ ...form, intensity: e.target.value })}
              />
            </label>
            <label className="text-xs text-ink-faint">
              Started
              <input
                type="date"
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                value={form.startedAt}
                onChange={(e) => setForm({ ...form, startedAt: e.target.value })}
              />
            </label>
            <label className="sm:col-span-2 text-xs text-ink-faint">
              Description
              <textarea
                rows={2}
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </label>
          </div>
          {error && <p className="mt-2 text-xs text-high">{error}</p>}
          <div className="mt-4 flex items-center gap-2">
            <Button size="sm" variant="primary" onClick={submitForm}>
              {editingId ? "Save Changes" : "Create Conflict"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
          </div>
        </Card>
      )}

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wide text-ink-faint">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Region</th>
              <th className="px-4 py-3">Countries</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Severity</th>
              <th className="px-4 py-3">Events</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-ink-faint">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && conflicts.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-ink-faint">
                  No conflicts yet.
                </td>
              </tr>
            )}
            {conflicts.map((c) => (
              <Fragment key={c.id}>
              <tr data-testid={`conflict-row-${c.slug}`} className="border-b border-border/60 align-top">
                <td className="px-4 py-3">
                  <div className="font-medium text-ink">{c.shortName ?? c.name}</div>
                  <div className="text-xs text-ink-faint">{c.slug}</div>
                </td>
                <td className="px-4 py-3 text-ink-dim">{c.region}</td>
                <td className="px-4 py-3 text-ink-dim">{c.countries.join(", ") || "—"}</td>
                <td className="px-4 py-3">
                  <select
                    aria-label={`Status for ${c.name}`}
                    value={c.status}
                    onChange={(e) => setStatus(c, e.target.value as ConflictStatus)}
                    className={cn(
                      "rounded-full border-0 px-2 py-0.5 text-xs",
                      c.status === "active" ? "bg-elevated-dim text-elevated" : "bg-white/5 text-ink-faint",
                    )}
                  >
                    {CONFLICT_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-3 text-ink-dim">{c.severity}</td>
                <td className="px-4 py-3 text-ink-dim">{c.eventCount ?? 0}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1.5">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setScoresOpenId(scoresOpenId === c.id ? null : c.id)}
                      aria-label={`Scores for ${c.name}`}
                      aria-expanded={scoresOpenId === c.id}
                    >
                      <Gauge className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => startEdit(c)} aria-label={`Edit ${c.name}`}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setStatus(c, "archived")}
                      aria-label={`Archive ${c.name}`}
                    >
                      <Archive className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => removeConflict(c)}
                      aria-label={`Delete ${c.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
              {scoresOpenId === c.id && (
                <tr className="border-b border-border/60 bg-surface/40">
                  <td colSpan={7} className="px-4 py-4">
                    <ScoresPanel kind="conflicts" entityId={c.id} />
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
