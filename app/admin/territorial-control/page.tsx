"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Pencil, Upload, ArrowRightLeft, Scissors } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TerritoryEditorMap, type EditorOverlay } from "@/components/admin/territory-editor-map";
import type { ConflictDTO, TerritorialChangeCandidateDTO } from "@/lib/types/db";
import type { ConflictActorDTO, TerritorialGeometry, TerritoryDTO } from "@/lib/types/territorial-control";
import { ASSIGNABLE_TERRITORIAL_STATUSES, type AssignableTerritorialStatus } from "@/lib/types/territorial-control";
import { isValidTerritorialGeometry } from "@/lib/data/territorial-control";
import { NO_ACTOR_COLOR, nextActorColor } from "@/lib/map/territorial-colors";
import { planarArea, validateTerritorialGeometry } from "@/lib/territory/geometry";
import { cn } from "@/lib/utils";

// Admin Territorial Control: a visual drawing/editing workflow on top of the
// versioned territory model. Published territory stays immutable — every
// change supersedes (whole reshape / change of control), splits (partial
// change: only the drawn area changes hands, the rest stays with the old
// controller) or creates a new version; nothing ever edits a published row.
// Raw GeoJSON remains available under "Advanced" for import/export.

const NEW_ACTOR_VALUE = "__new__";
const NO_ACTOR_VALUE = "";
const NO_SOURCE_VALUE = "";

type Mode =
  | { kind: "closed" }
  | { kind: "create" }
  | { kind: "edit"; id: string }
  | { kind: "supersede"; id: string }
  | { kind: "split"; sourceId: string }
  | { kind: "candidate"; candidateId: string };

interface FormState {
  conflictId: string;
  actorId: string;
  newActorName: string;
  status: AssignableTerritorialStatus;
  confidence: string;
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
  sourceName: "",
  sourceUrl: "",
  validFrom: "",
  validTo: "",
};

interface PreviewState {
  valid: boolean;
  errors: string[];
  base: TerritorialGeometry | null;
  affected: TerritorialGeometry | null;
  remainder: TerritorialGeometry | null;
  areaOutsideBase: boolean;
  sourceTerritoryId?: string | null;
}

// Local wall-clock "YYYY-MM-DDTHH:mm" for a datetime-local input's value.
function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseGeometry(text: string): { geometry: TerritorialGeometry | null; error: string | null } {
  if (!text.trim()) return { geometry: null, error: null };
  try {
    const parsed = JSON.parse(text);
    if (!isValidTerritorialGeometry(parsed)) return { geometry: null, error: "Must be a valid GeoJSON Polygon or MultiPolygon." };
    return { geometry: parsed, error: null };
  } catch {
    return { geometry: null, error: "Not valid JSON." };
  }
}

const inputClass = "mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink";

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
  const [mode, setMode] = useState<Mode>({ kind: "closed" });
  const [geometry, setGeometry] = useState<TerritorialGeometry | null>(null);
  const [geometryText, setGeometryText] = useState("");
  const [initial, setInitial] = useState<{ form: FormState; geometry: TerritorialGeometry | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [fitKey, setFitKey] = useState("");
  const fitCounter = useRef(0);
  const nextFitKey = (label: string) => `${label}-${++fitCounter.current}`;
  const [busy, setBusy] = useState(false);
  const [candidate, setCandidate] = useState<TerritorialChangeCandidateDTO | null>(null);
  const [candidateSourceId, setCandidateSourceId] = useState<string>(NO_SOURCE_VALUE);

  const { data: actors = [] } = useQuery({
    queryKey: ["admin", "actors", form.conflictId],
    queryFn: async (): Promise<ConflictActorDTO[]> => (form.conflictId ? (await fetch(`/api/admin/actors?conflictId=${form.conflictId}`)).json() : []),
    enabled: Boolean(form.conflictId),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["admin", "territorial-control"] });
    queryClient.invalidateQueries({ queryKey: ["admin", "actors"] });
    queryClient.invalidateQueries({ queryKey: ["admin", "territorial-changes"] });
  };

  // The version the current action is against: what's being superseded/split, or
  // the territory a draft split was drawn against, or the candidate's chosen territory.
  const sourceTerritory: TerritoryDTO | null = useMemo(() => {
    if (mode.kind === "supersede") return territories.find((t) => t.id === mode.id) ?? null;
    if (mode.kind === "split") return territories.find((t) => t.id === mode.sourceId) ?? null;
    if (mode.kind === "edit") {
      const draft = territories.find((t) => t.id === mode.id);
      return draft?.splitFromId ? (territories.find((t) => t.id === draft.splitFromId) ?? null) : null;
    }
    if (mode.kind === "candidate") return candidateSourceId ? (territories.find((t) => t.id === candidateSourceId) ?? null) : null;
    return null;
  }, [mode, territories, candidateSourceId]);

  const isSplitMode = mode.kind === "split" || (mode.kind === "edit" && Boolean(sourceTerritory) && territories.find((t) => t.id === mode.id)?.splitFromId != null);
  const isCandidate = mode.kind === "candidate";

  // ---- geometry sync between the editor and the advanced JSON box -----------------
  function setGeometryFromEditor(g: TerritorialGeometry | null) {
    setGeometry(g);
    setGeometryText(g ? JSON.stringify(g, null, 2) : "");
    setPreview(null);
  }
  function setGeometryFromText(text: string) {
    setGeometryText(text);
    setPreview(null);
    const parsed = parseGeometry(text);
    if (parsed.geometry || !text.trim()) setGeometry(parsed.geometry);
  }
  const geometryTextError = useMemo(() => parseGeometry(geometryText).error, [geometryText]);
  const validation = useMemo(() => (geometry ? validateTerritorialGeometry(geometry) : null), [geometry]);

  function open(next: Mode, nextForm: FormState, nextGeometry: TerritorialGeometry | null) {
    setForm(nextForm);
    setGeometry(nextGeometry);
    setGeometryText(nextGeometry ? JSON.stringify(nextGeometry, null, 2) : "");
    setInitial({ form: nextForm, geometry: nextGeometry });
    setMode(next);
    setError(null);
    setNotice(null);
    setConfirmed(false);
    setPreview(null);
    setFitKey(nextFitKey(next.kind));
  }

  function closeForm() {
    setMode({ kind: "closed" });
    setForm(EMPTY_FORM);
    setGeometry(null);
    setGeometryText("");
    setInitial(null);
    setError(null);
    setConfirmed(false);
    setPreview(null);
    setCandidate(null);
    setCandidateSourceId(NO_SOURCE_VALUE);
  }

  function revert() {
    if (!initial) return;
    setForm(initial.form);
    setGeometry(initial.geometry);
    setGeometryText(initial.geometry ? JSON.stringify(initial.geometry, null, 2) : "");
    setPreview(null);
    setConfirmed(false);
    setError(null);
    setFitKey(nextFitKey("revert"));
  }

  const fromTerritory = (t: TerritoryDTO, over: Partial<FormState>): FormState => ({
    conflictId: t.conflictId,
    actorId: t.actorId ?? NO_ACTOR_VALUE,
    newActorName: "",
    status: t.status === "recently_changed" ? "controlled" : t.status,
    confidence: String(t.confidence),
    sourceName: t.sourceName ?? "",
    sourceUrl: t.sourceUrl ?? "",
    validFrom: toDatetimeLocal(t.validFrom),
    validTo: t.validTo ? toDatetimeLocal(t.validTo) : "",
    ...over,
  });

  const startCreate = () => open({ kind: "create" }, { ...EMPTY_FORM, validFrom: toDatetimeLocal(new Date().toISOString()) }, null);
  const startEdit = (t: TerritoryDTO) => open({ kind: "edit", id: t.id }, fromTerritory(t, {}), t.geometry);
  const startSupersede = (t: TerritoryDTO) =>
    open({ kind: "supersede", id: t.id }, fromTerritory(t, { sourceName: "", sourceUrl: "", validFrom: toDatetimeLocal(new Date().toISOString()), validTo: "" }), t.geometry);
  // Split: nothing drawn yet — the admin draws only the affected area.
  const startSplit = (t: TerritoryDTO) =>
    open({ kind: "split", sourceId: t.id }, fromTerritory(t, { sourceName: "", sourceUrl: "", validFrom: toDatetimeLocal(new Date().toISOString()), validTo: "" }), null);

  // ---- open from a territorial-change candidate (?candidate=<id>) -----------------
  function openCandidate(c: TerritorialChangeCandidateDTO) {
    const cmp = c.comparison;
    setCandidate(c);
    setCandidateSourceId(cmp?.currentTerritoryId ?? NO_SOURCE_VALUE);
    open(
      { kind: "candidate", candidateId: c.id },
      {
        ...EMPTY_FORM,
        conflictId: c.conflictId,
        actorId: NO_ACTOR_VALUE,
        newActorName: cmp?.proposedActorName ?? "",
        status: cmp?.proposedStatus ?? "controlled",
        confidence: String(c.confidence),
        sourceName: c.sourceName ?? "",
        sourceUrl: c.sourceUrl ?? "",
        validFrom: toDatetimeLocal(c.observedAt ?? new Date().toISOString()),
      },
      null,
    );
  }

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("candidate");
    if (!id) return;
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/admin/territorial-change-candidates/${id}`);
      if (!res.ok || cancelled) return;
      openCandidate((await res.json()) as TerritorialChangeCandidateDTO);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once on mount.
  }, []);

  // ---- actor helpers ------------------------------------------------------------
  const chosenActor = actors.find((a) => a.id === form.actorId) ?? null;
  const candidateActor = isCandidate ? (actors.find((a) => a.name.toLowerCase() === (candidate?.comparison?.proposedActorName ?? "").toLowerCase()) ?? null) : null;
  const draftColor = isCandidate
    ? (candidateActor?.color ?? (candidate?.comparison?.proposedActorName ? nextActorColor(actors.length) : NO_ACTOR_COLOR))
    : form.actorId === NEW_ACTOR_VALUE
      ? nextActorColor(actors.length)
      : (chosenActor?.color ?? NO_ACTOR_COLOR);

  async function resolveActorId(): Promise<string | null> {
    if (form.actorId === NEW_ACTOR_VALUE) {
      if (!form.newActorName.trim()) return null;
      const res = await fetch("/api/admin/actors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conflictId: form.conflictId, name: form.newActorName }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to create actor");
      return ((await res.json()) as ConflictActorDTO).id;
    }
    return form.actorId || null;
  }

  // ---- validation / preview -------------------------------------------------------
  function localProblems(): string | null {
    if (!form.conflictId) return "Conflict is required.";
    if (!form.validFrom) return "Effective time (valid from) is required.";
    if (!geometry) return geometryTextError ?? "Draw or paste a geometry first.";
    const check = validateTerritorialGeometry(geometry);
    if (!check.valid) return check.errors.join(" ");
    const confidence = Number(form.confidence);
    if (Number.isNaN(confidence) || confidence < 0 || confidence > 1) return "Confidence must be between 0 and 1.";
    return null;
  }

  async function runPreview() {
    setError(null);
    setNotice(null);
    const problem = localProblems();
    if (problem) {
      setPreview({ valid: false, errors: [problem], base: null, affected: null, remainder: null, areaOutsideBase: false });
      return;
    }
    if (isCandidate && candidate) {
      const res = await fetch(`/api/admin/territorial-change-candidates/${candidate.id}/preview-geometry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ geometry, sourceTerritoryId: candidateSourceId || null }),
      });
      const data = await res.json();
      setPreview(res.ok ? data : { valid: false, errors: [data.error ?? "Preview failed"], base: null, affected: null, remainder: null, areaOutsideBase: false });
      return;
    }
    if (sourceTerritory && (mode.kind === "split" || isSplitMode)) {
      const res = await fetch("/api/admin/territorial-control/preview-split", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId: sourceTerritory.id, geometry }),
      });
      setPreview(await res.json());
      return;
    }
    // Whole-geometry actions: validation is the preview; old vs new overlay stays on the map.
    setPreview({ valid: true, errors: [], base: sourceTerritory?.geometry ?? null, affected: geometry, remainder: null, areaOutsideBase: false });
  }

  // ---- persistence -----------------------------------------------------------------
  const bodyFields = async () => ({
    actorId: await resolveActorId(),
    status: form.status,
    confidence: Number(form.confidence),
    geometry,
    sourceName: form.sourceName.trim() || null,
    sourceUrl: form.sourceUrl.trim() || null,
    validFrom: new Date(form.validFrom).toISOString(),
  });

  /** Creates or updates the draft row for create/edit/split modes; returns its id. */
  async function persistDraft(): Promise<string> {
    const fields = await bodyFields();
    if (mode.kind === "edit") {
      const res = await fetch(`/api/admin/territorial-control/${mode.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...fields, validTo: form.validTo ? new Date(form.validTo).toISOString() : null }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Save failed");
      return mode.id;
    }
    const res = await fetch("/api/admin/territorial-control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conflictId: form.conflictId,
        ...fields,
        validTo: form.validTo ? new Date(form.validTo).toISOString() : null,
        splitFromId: mode.kind === "split" ? mode.sourceId : null,
      }),
    });
    if (!res.ok) throw new Error((await res.json()).error ?? "Create failed");
    return ((await res.json()) as TerritoryDTO).id;
  }

  async function saveDraft() {
    setError(null);
    const problem = localProblems();
    if (problem) return setError(problem);
    setBusy(true);
    try {
      await persistDraft();
      closeForm();
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function publishFromForm() {
    setError(null);
    const problem = localProblems();
    if (problem) return setError(problem);
    if (!confirmed) return setError("Tick the confirmation box to publish.");
    setBusy(true);
    let createdDraftId: string | null = null;
    try {
      if (isCandidate && candidate) {
        const res = await fetch(`/api/admin/territorial-change-candidates/${candidate.id}/apply-geometry`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ geometry, confirm: true, sourceTerritoryId: candidateSourceId || null, validFrom: new Date(form.validFrom).toISOString() }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? "Publish failed");
      } else if (mode.kind === "supersede") {
        const fields = await bodyFields();
        const res = await fetch(`/api/admin/territorial-control/${mode.id}/supersede`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(fields),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? "Supersede failed");
      } else {
        // create / edit / split: save the draft, then publish it. A brand-new
        // draft that fails to publish is removed again so no orphan is left.
        const isNew = mode.kind !== "edit";
        const id = await persistDraft();
        if (isNew) createdDraftId = id;
        const res = await fetch(`/api/admin/territorial-control/${id}/publish`, { method: "POST" });
        if (!res.ok) throw new Error((await res.json()).error ?? "Publish failed");
        createdDraftId = null;
      }
      closeForm();
      refresh();
    } catch (err) {
      if (createdDraftId) await fetch(`/api/admin/territorial-control/${createdDraftId}`, { method: "DELETE" });
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function publishRow(t: TerritoryDTO) {
    const what = t.splitFromId ? "This carves the drawn area out of the version it was drawn against; the rest stays with the old controller." : "";
    if (!confirm(`Publish this territory version? Published territory can't be edited afterwards — only superseded. ${what}`)) return;
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

  // ---- overlays for the editor map --------------------------------------------------
  const overlays: EditorOverlay[] = useMemo(() => {
    const out: EditorOverlay[] = [];
    if (!sourceTerritory) return out;
    const oldColor = sourceTerritory.actorColor;
    if (preview?.valid && (preview.remainder || preview.affected) && (isSplitMode || isCandidate)) {
      if (preview.remainder) out.push({ geometry: preview.remainder, color: oldColor, status: sourceTerritory.status, kind: "remainder" });
      if (preview.affected) out.push({ geometry: preview.affected, color: draftColor, status: form.status, kind: "affected" });
    } else {
      out.push({ geometry: sourceTerritory.geometry, color: oldColor, status: sourceTerritory.status, kind: "old" });
    }
    return out;
  }, [sourceTerritory, preview, isSplitMode, isCandidate, draftColor, form.status]);

  const conflictName = (id: string) => conflicts.find((c) => c.id === id)?.name ?? id;
  const isFormOpen = mode.kind !== "closed";
  const lockedConflict = mode.kind !== "create" && mode.kind !== "closed";
  const activePublished = territories.filter((t) => t.published && !t.validTo && t.conflictId === form.conflictId);
  const titleFor = () => {
    switch (mode.kind) {
      case "create":
        return "New territory";
      case "edit":
        return isSplitMode ? "Edit draft partial change" : "Edit draft";
      case "supersede":
        return "Change control / reshape (new version)";
      case "split":
        return "Partial change — draw only the affected area";
      case "candidate":
        return "Apply territorial-change candidate";
      default:
        return "";
    }
  };
  const primaryLabel =
    mode.kind === "create" ? "Save as Draft" : mode.kind === "edit" ? "Save Changes" : mode.kind === "split" ? "Save Draft" : "Publish Change";
  const primaryPublishes = mode.kind === "supersede" || mode.kind === "candidate";
  const canPublish = confirmed && !busy;

  const share = (g: TerritorialGeometry | null) => (g && preview?.base ? Math.round((planarArea(g) / Math.max(planarArea(preview.base), 1e-12)) * 100) : null);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-ink">Territorial Control</h1>
        <Button size="sm" variant="accent" onClick={startCreate} data-testid="territory-create-button">
          <Plus className="h-3.5 w-3.5" /> New Territory
        </Button>
      </div>

      {notice && (
        <p className="mb-3 rounded-lg border border-border/60 p-2 text-xs text-ink-dim" data-testid="territory-notice">
          {notice}
        </p>
      )}

      {isFormOpen && (
        <Card className="mb-4 p-4" data-testid="territory-form">
          <h2 className="mb-3 text-sm font-semibold text-ink" data-testid="territory-form-title">
            {titleFor()}
          </h2>

          {isCandidate && candidate && (
            <div className="mb-3 space-y-1 rounded-lg border border-border/60 p-3 text-xs text-ink-dim" data-testid="territory-candidate-banner">
              <div className="text-ink">{candidate.description}</div>
              <div>
                {candidate.locationName ?? "Unknown place"} · precision {candidate.precision.replace("_", "-")} · {Math.round(candidate.confidence * 100)}% claim confidence
              </div>
              <div data-testid="territory-candidate-states">
                Current: {candidate.comparison?.currentStatus ?? "not mapped"} ({candidate.comparison?.currentActorName ?? "no controller"}) → Proposed: {candidate.comparison?.proposedStatus} (
                {candidate.comparison?.proposedActorName ?? "no controller"})
              </div>
              <div>Geometry is never generated from the report — draw only the area the report supports.</div>
              <label className="block text-ink-faint">
                Territory to change
                <select className={inputClass} value={candidateSourceId} onChange={(e) => { setCandidateSourceId(e.target.value); setPreview(null); }} data-testid="territory-source-select">
                  <option value={NO_SOURCE_VALUE}>None — publish the drawn area as a new territory</option>
                  {activePublished.map((t) => (
                    <option key={t.id} value={t.id}>
                      {(t.actorName ?? "No actor") + " · " + t.status + " · from " + new Date(t.validFrom).toLocaleDateString()}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {isSplitMode && sourceTerritory && (
            <p className="mb-3 rounded-lg border border-border/60 p-2 text-xs text-ink-dim" data-testid="territory-split-explainer">
              Changing part of <strong>{sourceTerritory.actorName ?? "the current territory"}</strong>&apos;s area. Only the area you draw changes hands; the rest stays with{" "}
              {sourceTerritory.actorName ?? "the old controller"} as a new version starting at the effective time. The current version is closed, not edited.
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-ink-faint">
              Conflict
              <select className={inputClass} value={form.conflictId} onChange={(e) => setForm({ ...form, conflictId: e.target.value, actorId: NO_ACTOR_VALUE })} disabled={lockedConflict}>
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
              <select className={inputClass} value={isCandidate ? NO_ACTOR_VALUE : form.actorId} onChange={(e) => setForm({ ...form, actorId: e.target.value })} disabled={!form.conflictId || isCandidate}>
                <option value={NO_ACTOR_VALUE}>{isCandidate ? (candidate?.comparison?.proposedActorName ?? "No clear actor") + " (from the candidate)" : "No clear actor (contested/uncertain)"}</option>
                {actors.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
                {!isCandidate && <option value={NEW_ACTOR_VALUE}>+ New actor…</option>}
              </select>
            </label>
            {form.actorId === NEW_ACTOR_VALUE && !isCandidate && (
              <label className="text-xs text-ink-faint">
                New actor name
                <input className={inputClass} value={form.newActorName} onChange={(e) => setForm({ ...form, newActorName: e.target.value })} placeholder="e.g. Actor name as reported" />
              </label>
            )}
            <label className="text-xs text-ink-faint">
              Status
              <select className={inputClass} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as AssignableTerritorialStatus })} disabled={isCandidate}>
                {ASSIGNABLE_TERRITORIAL_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <span className="mt-0.5 block text-[11px] text-ink-faint">&ldquo;Recently changed&rdquo; is derived from the effective time — it is never assigned by hand.</span>
            </label>
            <label className="text-xs text-ink-faint">
              Confidence (0–1)
              <input type="number" min={0} max={1} step={0.05} className={inputClass} value={form.confidence} onChange={(e) => setForm({ ...form, confidence: e.target.value })} disabled={isCandidate} />
            </label>
            <label className="text-xs text-ink-faint">
              Valid from (effective time)
              <input type="datetime-local" className={inputClass} value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value })} />
            </label>
            {mode.kind === "create" || mode.kind === "edit" ? (
              <label className="text-xs text-ink-faint">
                Valid to (blank = current)
                <input type="datetime-local" className={inputClass} value={form.validTo} onChange={(e) => setForm({ ...form, validTo: e.target.value })} />
              </label>
            ) : null}
            <label className="text-xs text-ink-faint">
              Source name
              <input className={inputClass} value={form.sourceName} onChange={(e) => setForm({ ...form, sourceName: e.target.value })} disabled={isCandidate} />
            </label>
            <label className="text-xs text-ink-faint">
              Source URL
              <input className={inputClass} value={form.sourceUrl} onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })} placeholder="https://…" disabled={isCandidate} />
            </label>

            <div className="sm:col-span-2">
              <div className="mb-1 flex flex-wrap items-center gap-3 text-xs text-ink-faint">
                <span>Geometry</span>
                <span className="inline-flex items-center gap-1" data-testid="territory-legend-draft">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: draftColor }} aria-hidden /> draft ({form.status})
                </span>
                {sourceTerritory && (
                  <span className="inline-flex items-center gap-1" data-testid="territory-legend-current">
                    <span className="h-2.5 w-2.5 rounded-sm border border-dashed" style={{ borderColor: sourceTerritory.actorColor }} aria-hidden /> current ({sourceTerritory.actorName ?? "no actor"},{" "}
                    {sourceTerritory.status})
                  </span>
                )}
              </div>
              <TerritoryEditorMap
                value={geometry}
                onChange={setGeometryFromEditor}
                color={draftColor}
                status={form.status}
                overlays={overlays}
                fitKey={fitKey}
                focus={candidate && candidate.lat !== null && candidate.lng !== null ? { lat: candidate.lat, lng: candidate.lng } : null}
              />
            </div>

            <details className="sm:col-span-2 rounded-lg border border-border/60 p-2" open>
              <summary className="cursor-pointer text-xs text-ink-faint">Advanced: GeoJSON (import / export)</summary>
              <label className="mt-2 block text-xs text-ink-faint">
                Geometry (GeoJSON Polygon or MultiPolygon)
                <textarea
                  rows={5}
                  data-testid="territory-geometry-input"
                  className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs text-ink"
                  value={geometryText}
                  onChange={(e) => setGeometryFromText(e.target.value)}
                  placeholder='{"type":"Polygon","coordinates":[[[..lng,lat..],...]]}'
                />
                {geometryTextError && geometryText.trim() && <p className="mt-1 text-high">{geometryTextError}</p>}
              </label>
            </details>
          </div>

          {validation && !validation.valid && (
            <ul className="mt-3 list-disc pl-5 text-xs text-high" data-testid="territory-validation-errors">
              {validation.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}

          {preview && (
            <div className="mt-3 space-y-1 rounded-lg border border-border/60 p-3 text-xs text-ink-dim" data-testid="territory-preview-panel">
              <div className={cn("font-medium", preview.valid ? "text-elevated" : "text-high")} data-testid="territory-preview-status">
                {preview.valid ? "Preview: geometry is valid" : "Preview: cannot publish"}
              </div>
              {preview.errors.length > 0 && (
                <ul className="list-disc pl-5 text-high" data-testid="territory-preview-errors">
                  {preview.errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              )}
              {preview.valid && (isSplitMode || isCandidate) && sourceTerritory && (
                <>
                  <div data-testid="territory-preview-affected">
                    Changes hands: {preview.affected ? `${share(preview.affected) ?? "?"}% of the current area` : "nothing"} → {isCandidate ? (candidate?.comparison?.proposedActorName ?? "no controller") : (chosenActor?.name ?? (form.actorId === NEW_ACTOR_VALUE ? form.newActorName : "no controller"))} ({form.status})
                  </div>
                  <div data-testid="territory-preview-remainder">
                    {preview.remainder
                      ? `Stays with ${sourceTerritory.actorName ?? "the old controller"} (${sourceTerritory.status}): ${share(preview.remainder) ?? "?"}% — unchanged geometry.`
                      : "The drawn area covers the whole territory: nothing stays with the old controller."}
                  </div>
                  {preview.areaOutsideBase && <div>Part of the drawn area lies outside the current territory — that part is ignored, not added.</div>}
                </>
              )}
              <div>
                Effective {form.validFrom ? new Date(form.validFrom).toLocaleString() : "—"} · source {form.sourceName || "none recorded"}
              </div>
            </div>
          )}

          {(primaryPublishes || mode.kind === "create" || mode.kind === "edit" || mode.kind === "split") && (
            <label className="mt-3 flex items-start gap-2 text-xs text-ink-dim">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} data-testid="territory-confirm" />
              <span>
                I confirm publishing this change to Territorial Control. Published territory can&apos;t be edited afterwards — it can only be superseded, and the
                previous version stays in history.
              </span>
            </label>
          )}

          {error && (
            <p className="mt-2 text-xs text-high" data-testid="territory-form-error">
              {error}
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="primary"
              onClick={primaryPublishes ? publishFromForm : saveDraft}
              disabled={busy || (primaryPublishes && !confirmed)}
              data-testid="territory-form-submit"
            >
              {primaryLabel}
            </Button>
            <Button size="sm" variant="ghost" onClick={runPreview} data-testid="territory-preview">
              Preview
            </Button>
            {!primaryPublishes && (
              <Button size="sm" variant="accent" onClick={publishFromForm} disabled={!canPublish} data-testid="territory-publish">
                Publish
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={revert} data-testid="territory-revert">
              Revert
            </Button>
            <Button size="sm" variant="ghost" onClick={closeForm} data-testid="territory-cancel">
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
                  <span className={cn("rounded-full px-2 py-0.5 text-xs", t.published ? "bg-elevated-dim text-elevated" : "bg-white/5 text-ink-faint")}>{t.published ? "Published" : "Draft"}</span>
                  {t.splitFromId && (
                    <span className="ml-1.5 text-[11px] text-ink-faint" data-testid={`territory-split-tag-${t.id}`}>
                      {t.published ? "split" : "partial change"}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1.5">
                    {!t.published && (
                      <>
                        <Button size="icon" variant="ghost" onClick={() => startEdit(t)} aria-label={`Edit territory ${t.id}`} data-testid={`territory-edit-${t.id}`}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => publishRow(t)} aria-label={`Publish territory ${t.id}`} data-testid={`territory-publish-${t.id}`}>
                          <Upload className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => remove(t)} aria-label={`Delete territory ${t.id}`}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                    {t.published && !t.validTo && (
                      <>
                        <Button size="icon" variant="ghost" onClick={() => startSupersede(t)} aria-label={`Change control for territory ${t.id}`} data-testid={`territory-supersede-${t.id}`}>
                          <ArrowRightLeft className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => startSplit(t)} aria-label={`Change part of territory ${t.id}`} data-testid={`territory-split-${t.id}`}>
                          <Scissors className="h-3.5 w-3.5" />
                        </Button>
                      </>
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
