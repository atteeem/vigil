"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Pencil, Radio, Loader2, Download } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SOURCE_TYPES, type SourceDTO, type SourceType } from "@/lib/types/db";
import type { FetchResult } from "@/lib/ingestion/poll";
import { timeAgo, cn } from "@/lib/utils";

interface SourceFormState {
  name: string;
  type: SourceType;
  url: string;
  telegramHandle: string;
  country: string;
  region: string;
  language: string;
  sourceCategory: string;
  reliabilityTier: string;
  autoIngest: boolean;
  autoProcessing: boolean;
}

const EMPTY_FORM: SourceFormState = {
  name: "",
  type: "rss",
  url: "",
  telegramHandle: "",
  country: "",
  region: "",
  language: "",
  sourceCategory: "",
  reliabilityTier: "",
  autoIngest: false,
  autoProcessing: true,
};

function toPayload(form: SourceFormState) {
  return {
    name: form.name,
    type: form.type,
    url: form.url || null,
    telegramHandle: form.telegramHandle || null,
    country: form.country || null,
    region: form.region || null,
    language: form.language || null,
    sourceCategory: form.sourceCategory || null,
    reliabilityTier: form.reliabilityTier || null,
    autoIngest: form.autoIngest,
    autoProcessing: form.autoProcessing,
  };
}

export default function AdminSourcesPage() {
  const queryClient = useQueryClient();
  const { data: sources = [], isLoading: loading } = useQuery({
    queryKey: ["admin", "sources"],
    queryFn: async (): Promise<SourceDTO[]> => (await fetch("/api/admin/sources")).json(),
  });
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<SourceFormState>(EMPTY_FORM);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; message?: string }>>({});
  const [testingId, setTestingId] = useState<string | null>(null);
  const [fetchResults, setFetchResults] = useState<Record<string, FetchResult>>({});
  const [fetchingId, setFetchingId] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin", "sources"] });

  async function submitForm() {
    if (!form.name.trim()) return;
    if (editingId) {
      await fetch(`/api/admin/sources/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toPayload(form)),
      });
    } else {
      await fetch("/api/admin/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toPayload(form)),
      });
    }
    setForm(EMPTY_FORM);
    setShowForm(false);
    setEditingId(null);
    refresh();
  }

  function startEdit(source: SourceDTO) {
    setEditingId(source.id);
    setForm({
      name: source.name,
      type: source.type,
      url: source.url ?? "",
      telegramHandle: source.telegramHandle ?? "",
      country: source.country ?? "",
      region: source.region ?? "",
      language: source.language ?? "",
      sourceCategory: source.sourceCategory ?? "",
      reliabilityTier: source.reliabilityTier ?? "",
      autoIngest: source.autoIngest,
      autoProcessing: source.autoProcessing,
    });
    setShowForm(true);
  }

  async function toggleEnabled(source: SourceDTO) {
    await fetch(`/api/admin/sources/${source.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !source.enabled }),
    });
    refresh();
  }

  async function testSource(id: string) {
    setTestingId(id);
    const res = await fetch(`/api/admin/sources/${id}/test`, { method: "POST" });
    const result = await res.json();
    setTestResults((prev) => ({ ...prev, [id]: result }));
    setTestingId(null);
    refresh();
  }

  async function fetchNow(id: string) {
    setFetchingId(id);
    const res = await fetch(`/api/admin/sources/${id}/fetch`, { method: "POST" });
    const result = (await res.json()) as FetchResult;
    setFetchResults((prev) => ({ ...prev, [id]: result }));
    setFetchingId(null);
    refresh();
    queryClient.invalidateQueries({ queryKey: ["admin", "incoming"] });
  }

  async function removeSource(id: string) {
    if (!confirm("Delete this source? Its raw ingestion history will be deleted too.")) return;
    await fetch(`/api/admin/sources/${id}`, { method: "DELETE" });
    refresh();
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-ink">Source Manager</h1>
        <Button
          size="sm"
          variant="accent"
          onClick={() => {
            setForm(EMPTY_FORM);
            setEditingId(null);
            setShowForm((v) => !v);
          }}
        >
          <Plus className="h-3.5 w-3.5" /> Add Source
        </Button>
      </div>

      {showForm && (
        <Card className="mb-4 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-ink-faint">
              Name
              <input
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label className="text-xs text-ink-faint">
              Type
              <select
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as SourceType })}
              >
                {SOURCE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-ink-faint">
              URL {form.type === "rss" && "(feed URL)"}
              <input
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
              />
            </label>
            <label className="text-xs text-ink-faint">
              Telegram handle
              <input
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                value={form.telegramHandle}
                onChange={(e) => setForm({ ...form, telegramHandle: e.target.value })}
                placeholder="@handle"
              />
            </label>
            <label className="text-xs text-ink-faint">
              Country
              <input
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                value={form.country}
                onChange={(e) => setForm({ ...form, country: e.target.value })}
              />
            </label>
            <label className="text-xs text-ink-faint">
              Region
              <input
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                value={form.region}
                onChange={(e) => setForm({ ...form, region: e.target.value })}
              />
            </label>
            <label className="text-xs text-ink-faint">
              Language
              <input
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                value={form.language}
                onChange={(e) => setForm({ ...form, language: e.target.value })}
              />
            </label>
            <label className="text-xs text-ink-faint">
              Reliability tier
              <input
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                value={form.reliabilityTier}
                onChange={(e) => setForm({ ...form, reliabilityTier: e.target.value })}
                placeholder="e.g. wire, relay, community"
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-ink-faint">
              <input
                type="checkbox"
                checked={form.autoIngest}
                onChange={(e) => setForm({ ...form, autoIngest: e.target.checked })}
              />
              Auto-ingest (poll automatically every ~60s)
            </label>
            <label className="flex items-center gap-2 text-xs text-ink-faint">
              <input
                type="checkbox"
                checked={form.autoProcessing}
                onChange={(e) => setForm({ ...form, autoProcessing: e.target.checked })}
              />
              Auto-processing (generate an automated draft suggestion for incoming items)
            </label>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <Button size="sm" variant="primary" onClick={submitForm}>
              {editingId ? "Save Changes" : "Create Source"}
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
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Region</th>
              <th className="px-4 py-3">Reliability</th>
              <th className="px-4 py-3">Permission</th>
              <th className="px-4 py-3">Enabled</th>
              <th className="px-4 py-3">Auto</th>
              <th className="px-4 py-3">Last update</th>
              <th className="px-4 py-3">Items today</th>
              <th className="px-4 py-3">Health</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={11} className="px-4 py-8 text-center text-ink-faint">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && sources.length === 0 && (
              <tr>
                <td colSpan={11} className="px-4 py-8 text-center text-ink-faint">
                  No sources yet. Add one to get started.
                </td>
              </tr>
            )}
            {sources.map((source) => {
              const test = testResults[source.id];
              const fetchResult = fetchResults[source.id];
              const healthy = test ? test.ok : !source.lastError;
              return (
                <tr key={source.id} className="border-b border-border/60 align-top">
                  <td className="px-4 py-3">
                    <div className="font-medium text-ink">{source.name}</div>
                    {source.telegramHandle && (
                      <div className="text-xs text-ink-faint">{source.telegramHandle}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-ink-dim">{source.type}</td>
                  <td className="px-4 py-3 text-ink-dim">{source.region ?? "—"}</td>
                  <td className="px-4 py-3 text-ink-dim">{source.reliabilityTier ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-xs",
                        source.permissionStatus === "authorized"
                          ? "bg-elevated-dim text-elevated"
                          : "bg-white/5 text-ink-faint",
                      )}
                    >
                      {source.permissionStatus}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggleEnabled(source)}
                      className={cn(
                        "rounded-full px-2 py-0.5 text-xs",
                        source.enabled ? "bg-elevated-dim text-elevated" : "bg-white/5 text-ink-faint",
                      )}
                    >
                      {source.enabled ? "On" : "Off"}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-ink-dim">{source.autoIngest ? "Yes" : "No"}</td>
                  <td className="px-4 py-3 text-xs text-ink-faint">
                    {source.lastSuccessfulIngestion ? timeAgo(source.lastSuccessfulIngestion) : "Never"}
                  </td>
                  <td className="px-4 py-3 text-ink-dim">{source.itemsToday ?? 0}</td>
                  <td className="px-4 py-3">
                    <span className={cn("flex items-center gap-1 text-xs", healthy ? "text-elevated" : "text-high")}>
                      <Radio className="h-3 w-3" />
                      {healthy ? "OK" : "Error"}
                    </span>
                    {(test?.message || source.lastError) && (
                      <div className="mt-1 max-w-[180px] text-[11px] text-ink-faint">
                        {test?.message ?? source.lastError}
                      </div>
                    )}
                    {fetchResult && (
                      <div className="mt-1 max-w-[200px] text-[11px] text-ink-faint">
                        {fetchResult.fetched} fetched · {fetchResult.alreadyKnown} already known · {fetchResult.new}{" "}
                        new · {fetchResult.errors} error{fetchResult.errors === 1 ? "" : "s"}
                        {fetchResult.error && <span className="text-high"> — {fetchResult.error}</span>}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      {source.type === "rss" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => fetchNow(source.id)}
                          disabled={fetchingId === source.id}
                        >
                          {fetchingId === source.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <>
                              <Download className="h-3.5 w-3.5" /> Fetch Now
                            </>
                          )}
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => testSource(source.id)} disabled={testingId === source.id}>
                        {testingId === source.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Test"}
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => startEdit(source)} aria-label="Edit source">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => removeSource(source.id)} aria-label="Delete source">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
