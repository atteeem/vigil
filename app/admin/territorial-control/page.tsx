"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Pencil, Upload, ArrowRightLeft } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TerritoryGeometryPreview } from "@/components/admin/territory-geometry-preview";
import type { ConflictDTO } from "@/lib/types/db";
import type { ConflictActorDTO, TerritorialGeometry, TerritoryDTO } from "@/lib/types/territorial-control";
import { ASSIGNABLE_TERRITORIAL_STATUSES, type AssignableTerritorialStatus } from "@/lib/types/territorial-control";
import { isValidTerritorialGeometry } from "@/lib/data/territorial-control";
import { cn } from "@/lib/utils";

const NEW_ACTOR_VALUE = "__new__";
const NO_ACTOR_VALUE = "";

interface FormState {
  conflictId: string;
  actorId: string;
  newActorName: string;
  status: AssignableTerritorialStatus;
  confidence: string;
  geometryText: string;
  sourceName: string;
  sourceUrl: string;
  validFrom: string;
  validTo: string;
}

const EMPTY_FORM: FormState = {
  conflictId: "",
  actorId: NO_ACTOR_VALUE,
  newActorName: "",
  status: "controlled",
  confidence: "0.7",
  geometryText: "",
  sourceName: "",
  sourceUrl: "",
  validFrom: "",
  validTo: "",
};

// Local wall-clock "YYYY-MM-DDTHH:mm" for a datetime-local input's value —
// same rounding-free construction TimelineControls already uses.
function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseGeometry(text: string): { geometry: TerritorialGeometry | null; error: string | null } {
  if (!text.trim()) return { geometry: null, error: null };
  try {
    const parsed = JSON.parse(text);
    if (!isValidTerritorialGeometry(parsed)) {
      return { geometry: null, error: "Must be a valid GeoJSON Polygon or MultiPolygon." };
    }
    return { geometry: parsed, error: null };
  } catch {
    return { geometry: null, error: "Not valid JSON." };
  }
}

export default function AdminTerritorialControlPage() {
  const queryClient = useQueryClient();
  const { data: conflicts = [] } = useQuery({
    queryKey: ["admin", "conflicts"],
    queryFn: async (): Promise<ConflictDTO[]> => (await fetch("/api/admin/conflicts")).json(),
  });
  const { data: territories = [], isLoading: loading } = useQuery({
    queryKey: ["admin", "territorial-control"],
    queryFn: async (): Promise<TerritoryDTO[]> => (await fetch("/api/admin/territorial-control")).json(),
  });

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [mode, setMode] = useState<"closed" | "create" | { editId: string } | { supersedeId: string }>("closed");
  const [error, setError] = useState<string | null>(null);

  const { data: actors = [] } = useQuery({
    queryKey: ["admin", "actors", form.conflictId],
    queryFn: async (): Promise<ConflictActorDTO[]> =>
      form.conflictId ? (await fetch(`/api/admin/actors?conflictId=${form.conflictId}`)).json() : [],
    enabled: Boolean(form.conflictId),
  });

  const { geometry: parsedGeometry, error: geometryError } = useMemo(() => parseGeometry(form.geometryText), [form.geometryText]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["admin", "territorial-control"] });
    queryClient.invalidateQueries({ queryKey: ["admin", "actors"] });
  };

  function closeForm() {
    setMode("closed");
    setForm(EMPTY_FORM);
    setError(null);
  }

  function startCreate() {
    setForm(EMPTY_FORM);
    setError(null);
    setMode("create");
  }

  function startEdit(t: TerritoryDTO) {
    setForm({
      conflictId: t.conflictId,
      actorId: t.actorId ?? NO_ACTOR_VALUE,
      newActorName: "",
      status: t.status === "recently_changed" ? "controlled" : t.status,
      confidence: String(t.confidence),
      geometryText: JSON.stringify(t.geometry, null, 2),
      sourceName: t.sourceName ?? "",
      sourceUrl: t.sourceUrl ?? "",
      validFrom: toDatetimeLocal(t.validFrom),
      validTo: t.validTo ? toDatetimeLocal(t.validTo) : "",
    });
    setError(null);
    setMode({ editId: t.id });
  }

  function startSupersede(t: TerritoryDTO) {
    setForm({
      conflictId: t.conflictId,
      actorId: t.actorId ?? NO_ACTOR_VALUE,
      newActorName: "",
      status: t.status === "recently_changed" ? "controlled" : t.status,
      confidence: String(t.confidence),
      geometryText: JSON.stringify(t.geometry, null, 2),
      sourceName: "",
      sourceUrl: "",
      validFrom: toDatetimeLocal(new Date().toISOString()),
      validTo: "",
    });
    setError(null);
    setMode({ supersedeId: t.id });
  }

  async function resolveActorId(): Promise<string | null> {
    if (form.actorId === NEW_ACTOR_VALUE) {
      if (!form.newActorName.trim()) return null;
      const res = await fetch("/api/admin/actors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conflictId: form.conflictId, name: form.newActorName }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Failed to create actor");
      }
      const actor = (await res.json()) as ConflictActorDTO;
      return actor.id;
    }
    return form.actorId || null;
  }

  async function submit() {
    setError(null);
    if (!form.conflictId) return setError("Conflict is required.");
    if (!form.validFrom) return setError("Valid from is required.");
    if (!parsedGeometry) return setError(geometryError ?? "Geometry is required.");
    const confidence = Number(form.confidence);
    if (Number.isNaN(confidence) || confidence < 0 || confidence > 1) return setError("Confidence must be between 0 and 1.");

    try {
      const actorId = await resolveActorId();
      const validFrom = new Date(form.validFrom).toISOString();
      const validTo = form.validTo ? new Date(form.validTo).toISOString() : null;

      if (mode === "create") {
        const res = await fetch("/api/admin/territorial-control", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conflictId: form.conflictId,
            actorId,
            status: form.status,
            confidence,
            geometry: parsedGeometry,
            sourceName: form.sourceName.trim() || null,
            sourceUrl: form.sourceUrl.trim() || null,
            validFrom,
            validTo,
          }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? "Create failed");
      } else if (typeof mode === "object" && "editId" in mode) {
        const res = await fetch(`/api/admin/territorial-control/${mode.editId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            actorId,
            status: form.status,
            confidence,
            geometry: parsedGeometry,
            sourceName: form.sourceName.trim() || null,
            sourceUrl: form.sourceUrl.trim() || null,
            validFrom,
            validTo,
          }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? "Save failed");
      } else if (typeof mode === "object" && "supersedeId" in mode) {
        const res = await fetch(`/api/admin/territorial-control/${mode.supersedeId}/supersede`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            actorId,
            status: form.status,
            confidence,
            geometry: parsedGeometry,
            sourceName: form.sourceName.trim() || null,
            sourceUrl: form.sourceUrl.trim() || null,
            validFrom,
          }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? "Supersede failed");
      }
      closeForm();
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function publish(t: TerritoryDTO) {
    const res = await fetch(`/api/admin/territorial-control/${t.id}/publish`, { method: "POST" });
    if (!res.ok) {
      alert((await res.json()).error ?? "Publish failed");
      return;
    }
    refresh();
  }

  async function remove(t: TerritoryDTO) {
    if (!confirm("Delete this draft territory version?")) return;
    const res = await fetch(`/api/admin/territorial-control/${t.id}`, { method: "DELETE" });
    if (!res.ok) {
      alert((await res.json()).error ?? "Delete failed");
      return;
    }
    refresh();
  }

  const conflictName = (id: string) => conflicts.find((c) => c.id === id)?.name ?? id;
  const isFormOpen = mode !== "closed";

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-ink">Territorial Control</h1>
        <Button size="sm" variant="accent" onClick={startCreate} data-testid="territory-create-button">
          <Plus className="h-3.5 w-3.5" /> New Territory
        </Button>
      </div>

      {isFormOpen && (
        <Card className="mb-4 p-4" data-testid="territory-form">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-ink-faint">
              Conflict
              <select
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                value={form.conflictId}
                onChange={(e) => setForm({ ...form, conflictId: e.target.value, actorId: NO_ACTOR_VALUE })}
                disabled={typeof mode === "object" && ("editId" in mode || "supersedeId" in mode)}
              >
                <option value="">Select a conflict…</option>
                {conflicts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-ink-faint">
              Controlling actor
              <select
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                value={form.actorId}
                onChange={(e) => setForm({ ...form, actorId: e.target.value })}
                disabled={!form.conflictId}
              >
                <option value={NO_ACTOR_VALUE}>No clear actor (contested/uncertain)</option>
                {actors.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
                <option value={NEW_ACTOR_VALUE}>+ New actor…</option>
              </select>
            </label>
            {form.actorId === NEW_ACTOR_VALUE && (
              <label className="text-xs text-ink-faint">
                New actor name
                <input
                  className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                  value={form.newActorName}
                  onChange={(e) => setForm({ ...form, newActorName: e.target.value })}
                  placeholder="e.g. Actor name as reported"
                />
              </label>
            )}
            <label className="text-xs text-ink-faint">
              Status
              <select
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value as AssignableTerritorialStatus })}
              >
                {ASSIGNABLE_TERRITORIAL_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-ink-faint">
              Confidence (0–1)
              <input
                type="number"
                min={0}
                max={1}
                step={0.05}
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                value={form.confidence}
                onChange={(e) => setForm({ ...form, confidence: e.target.value })}
              />
            </label>
            <label className="text-xs text-ink-faint">
              Valid from
              <input
                type="datetime-local"
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                value={form.validFrom}
                onChange={(e) => setForm({ ...form, validFrom: e.target.value })}
              />
            </label>
            {mode === "create" || (typeof mode === "object" && "editId" in mode) ? (
              <label className="text-xs text-ink-faint">
                Valid to (blank = current)
                <input
                  type="datetime-local"
                  className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                  value={form.validTo}
                  onChange={(e) => setForm({ ...form, validTo: e.target.value })}
                />
              </label>
            ) : null}
            <label className="text-xs text-ink-faint">
              Source name
              <input
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                value={form.sourceName}
                onChange={(e) => setForm({ ...form, sourceName: e.target.value })}
              />
            </label>
            <label className="text-xs text-ink-faint">
              Source URL
              <input
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                value={form.sourceUrl}
                onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })}
                placeholder="https://…"
              />
            </label>
            <label className="sm:col-span-2 text-xs text-ink-faint">
              Geometry (GeoJSON Polygon or MultiPolygon)
              <textarea
                rows={6}
                data-testid="territory-geometry-input"
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs text-ink"
                value={form.geometryText}
                onChange={(e) => setForm({ ...form, geometryText: e.target.value })}
                placeholder='{"type":"Polygon","coordinates":[[[..lng,lat..],...]]}'
              />
              {geometryError && form.geometryText.trim() && <p className="mt-1 text-high">{geometryError}</p>}
            </label>
            <div className="sm:col-span-2">
              <div className="mb-1 flex items-center gap-1.5 text-xs text-ink-faint">
                <Upload className="h-3 w-3" /> Preview
              </div>
              <TerritoryGeometryPreview geometry={parsedGeometry} />
            </div>
          </div>
          {error && <p className="mt-2 text-xs text-high">{error}</p>}
          <div className="mt-4 flex items-center gap-2">
            <Button size="sm" variant="primary" onClick={submit} data-testid="territory-form-submit">
              {mode === "create" ? "Save as Draft" : typeof mode === "object" && "supersedeId" in mode ? "Publish Change" : "Save Changes"}
            </Button>
            <Button size="sm" variant="ghost" onClick={closeForm}>
              Cancel
            </Button>
          </div>
        </Card>
      )}

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[1000px] text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wide text-ink-faint">
              <th className="px-4 py-3">Conflict</th>
              <th className="px-4 py-3">Actor</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Confidence</th>
              <th className="px-4 py-3">Valid from</th>
              <th className="px-4 py-3">Valid to</th>
              <th className="px-4 py-3">Published</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-ink-faint">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && territories.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-ink-faint">
                  No territorial control data yet.
                </td>
              </tr>
            )}
            {territories.map((t) => (
              <tr key={t.id} data-testid={`territory-row-${t.id}`} className="border-b border-border/60 align-top">
                <td className="px-4 py-3 text-ink-dim">{conflictName(t.conflictId)}</td>
                <td className="px-4 py-3">
                  <span className="flex items-center gap-1.5 text-ink-dim">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: t.actorColor }} aria-hidden />
                    {t.actorName ?? "—"}
                  </span>
                </td>
                <td className="px-4 py-3 text-ink-dim">{t.status}</td>
                <td className="px-4 py-3 text-ink-dim">{Math.round(t.confidence * 100)}%</td>
                <td className="px-4 py-3 text-ink-faint">{new Date(t.validFrom).toLocaleString()}</td>
                <td className="px-4 py-3 text-ink-faint">{t.validTo ? new Date(t.validTo).toLocaleString() : "current"}</td>
                <td className="px-4 py-3">
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs",
                      t.published ? "bg-elevated-dim text-elevated" : "bg-white/5 text-ink-faint",
                    )}
                  >
                    {t.published ? "Published" : "Draft"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1.5">
                    {!t.published && (
                      <>
                        <Button size="icon" variant="ghost" onClick={() => startEdit(t)} aria-label={`Edit territory ${t.id}`}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => publish(t)}
                          aria-label={`Publish territory ${t.id}`}
                          data-testid={`territory-publish-${t.id}`}
                        >
                          <Upload className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => remove(t)} aria-label={`Delete territory ${t.id}`}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                    {t.published && !t.validTo && (
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => startSupersede(t)}
                        aria-label={`Change control for territory ${t.id}`}
                        data-testid={`territory-supersede-${t.id}`}
                      >
                        <ArrowRightLeft className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
