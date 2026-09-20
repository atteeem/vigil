"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { NotificationItem } from "@/components/notifications/notification-center";
import { useAppStore } from "@/hooks/use-app-store";
import { useNotificationFeed, useWatcherMutations, useWatcherSettings, useWatches, type NotificationDTO, type WatchDTO } from "@/hooks/use-watcher";
import { CATEGORIES, CATEGORY_LABEL, ENTITY_TYPE_LABEL, MODE_LABEL, PRIORITIES, WATCH_MODES, type RuleDef, type WatchEntityType, type WatchMode, type WatchRules } from "@/lib/alerts/types";
import { cn } from "@/lib/utils";

const GROUPS: { title: string; testId: string; types: WatchEntityType[] }[] = [
  { title: "Countries", testId: "group-countries", types: ["country"] },
  { title: "Conflicts", testId: "group-conflicts", types: ["conflict"] },
  { title: "Actors and units", testId: "group-actors", types: ["actor", "unit"] },
  { title: "Infrastructure and locations", testId: "group-infrastructure", types: ["airport", "port", "chokepoint", "volcano", "watchkey"] },
  { title: "Event categories", testId: "group-layers", types: ["layer"] },
];

const field = "rounded-md border border-border bg-surface px-2 py-1 text-xs text-ink";

function RuleEditor({ watch, onSave }: { watch: WatchDTO; onSave: (rules: WatchRules) => void }) {
  const [draft, setDraft] = useState<WatchRules>(watch.rules);
  const set = (key: string, value: WatchRules[string]) => setDraft((d) => ({ ...d, [key]: value }));
  return (
    <div className="mt-2 space-y-1.5 rounded-lg border border-border bg-surface/50 p-2.5" data-testid="rule-editor">
      {watch.ruleSchema.map((def: RuleDef) => (
        <label key={def.key} className="flex items-center justify-between gap-3 text-xs text-ink-dim">
          <span>{def.label}</span>
          {def.kind === "boolean" ? (
            <input type="checkbox" checked={draft[def.key] === true} onChange={(e) => set(def.key, e.target.checked)} data-testid={`rule-${def.key}`} />
          ) : def.kind === "number" ? (
            <input type="number" min={def.min} max={def.max} step="any" value={typeof draft[def.key] === "number" ? (draft[def.key] as number) : ""} onChange={(e) => set(def.key, e.target.value === "" ? null : Number(e.target.value))} className={cn(field, "w-24")} data-testid={`rule-${def.key}`} placeholder="off" />
          ) : (
            <select value={typeof draft[def.key] === "string" ? (draft[def.key] as string) : ""} onChange={(e) => set(def.key, e.target.value || null)} className={field} data-testid={`rule-${def.key}`}>
              <option value="">off</option>
              {def.options!.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          )}
        </label>
      ))}
      <button onClick={() => onSave(draft)} className="rounded-md border border-accent/40 px-2.5 py-1 text-xs text-accent" data-testid="save-rules">
        Save rules
      </button>
    </div>
  );
}

function WatchCard({ w }: { w: WatchDTO }) {
  const { update, unfollow } = useWatcherMutations();
  const paused = w.pausedUntil && new Date(w.pausedUntil) > new Date();
  return (
    <li className="rounded-xl border border-border bg-card/60 px-3.5 py-3" data-testid="watch-item" data-watch-key={`${w.entityType}:${w.entityKey}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          {w.href ? (
            <Link href={w.href} className="text-sm font-medium text-ink hover:underline">
              {w.label}
            </Link>
          ) : (
            <span className="text-sm font-medium text-ink">{w.label}</span>
          )}
          <span className="ml-2 text-[11px] text-ink-faint">{ENTITY_TYPE_LABEL[w.entityType]}</span>
          {(w.muted || paused) && (
            <span className="ml-2 rounded-full border border-border-strong px-1.5 text-[10px] text-ink-faint" data-testid="watch-state">
              {w.muted ? "Muted" : "Paused"}
            </span>
          )}
        </div>
        <select aria-label={`Alert mode for ${w.label}`} value={w.mode} onChange={(e) => update.mutate({ id: w.id, mode: e.target.value as WatchMode })} className={field} data-testid="watch-mode">
          {WATCH_MODES.map((m) => (
            <option key={m} value={m}>
              {MODE_LABEL[m]}
            </option>
          ))}
        </select>
        <button onClick={() => update.mutate({ id: w.id, muted: !w.muted })} className={cn(field, "hover:text-ink")} data-testid="watch-mute">
          {w.muted ? "Unmute" : "Mute"}
        </button>
        <select aria-label={`Pause ${w.label}`} value="" onChange={(e) => update.mutate({ id: w.id, pauseHours: e.target.value === "" ? undefined : Number(e.target.value) })} className={field} data-testid="watch-pause">
          <option value="">{paused ? "Paused — change…" : "Pause…"}</option>
          <option value="1">1 hour</option>
          <option value="24">24 hours</option>
          <option value="168">7 days</option>
          {paused && <option value="0">Resume now</option>}
        </select>
        <button onClick={() => unfollow.mutate(w.id)} className={cn(field, "text-elevated")} data-testid="watch-unfollow">
          Unfollow
        </button>
      </div>
      {w.mode === "custom" && <RuleEditor key={JSON.stringify(w.rules)} watch={w} onSave={(rules) => update.mutate({ id: w.id, rules })} />}
    </li>
  );
}

function AddWatch() {
  const [type, setType] = useState<WatchEntityType>("country");
  const [q, setQ] = useState("");
  const { follow } = useWatcherMutations();
  const { data: watches } = useWatches();
  const { data: results = [] } = useQuery<{ entityType: WatchEntityType; entityKey: string; label: string; detail?: string }[]>({
    queryKey: ["watchable", type, q],
    queryFn: async () => (await fetch(`/api/me/watchable?type=${type}&q=${encodeURIComponent(q)}`)).json(),
  });
  return (
    <Card className="p-4" data-testid="add-watch">
      <h2 className="mb-2 text-sm font-semibold text-ink">Follow something</h2>
      <div className="flex flex-wrap gap-2">
        <select aria-label="What to follow" value={type} onChange={(e) => setType(e.target.value as WatchEntityType)} className={field} data-testid="add-type">
          {(["country", "conflict", "actor", "unit", "airport", "chokepoint", "volcano", "port", "watchkey", "layer"] as WatchEntityType[]).map((t) => (
            <option key={t} value={t}>
              {ENTITY_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
        <input aria-label="Search" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} className={cn(field, "flex-1")} data-testid="add-search" />
      </div>
      <ul className="mt-2 max-h-52 space-y-1 overflow-y-auto">
        {results.map((r) => {
          const followed = watches?.some((w) => w.entityType === r.entityType && w.entityKey === r.entityKey);
          return (
            <li key={`${r.entityType}:${r.entityKey}`} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1 text-xs hover:bg-white/5" data-testid="add-result">
              <span className="min-w-0 truncate text-ink-dim">
                {r.label} {r.detail && <span className="text-ink-faint">· {r.detail}</span>}
              </span>
              <button disabled={followed || follow.isPending} onClick={() => follow.mutate({ entityType: r.entityType, entityKey: r.entityKey, label: r.label })} className={cn(field, "shrink-0")} data-testid="add-follow">
                {followed ? "Following" : "Follow"}
              </button>
            </li>
          );
        })}
        {results.length === 0 && <li className="px-2 py-2 text-xs text-ink-faint">No matches.</li>}
      </ul>
    </Card>
  );
}

function Preferences() {
  const { data: s } = useWatcherSettings();
  const { settings } = useWatcherMutations();
  const showPartyClaims = useAppStore((st) => st.showPartyClaims);
  const setShowPartyClaims = useAppStore((st) => st.setShowPartyClaims);
  if (!s) return null;
  return (
    <Card className="space-y-3 p-4" data-testid="alert-preferences">
      <h2 className="text-sm font-semibold text-ink">Alert preferences</h2>
      <label className="flex items-center justify-between text-xs text-ink-dim">
        Notifications enabled
        <input type="checkbox" checked={s.enabled} onChange={(e) => settings.mutate({ enabled: e.target.checked })} data-testid="pref-enabled" />
      </label>
      <label className="flex items-center justify-between text-xs text-ink-dim">
        Minimum priority
        <select value={s.minPriority} onChange={(e) => settings.mutate({ minPriority: e.target.value as never })} className={field} data-testid="pref-min-priority">
          {PRIORITIES.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </label>
      <label className="flex items-center justify-between text-xs text-ink-dim">
        <span>
          Party / aligned claims
          <span className="block text-[11px] text-ink-faint">Default off. The same setting as Profile → Sources.</span>
        </span>
        <input
          type="checkbox"
          checked={showPartyClaims}
          onChange={(e) => {
            setShowPartyClaims(e.target.checked);
            settings.mutate({ partyClaims: e.target.checked });
          }}
          data-testid="pref-party-claims"
        />
      </label>
      <label className="flex items-center justify-between text-xs text-ink-dim">
        Also tell me when situations improve (reopened, restored, expired)
        <input type="checkbox" checked={s.resolutionAlerts} onChange={(e) => settings.mutate({ resolutionAlerts: e.target.checked })} data-testid="pref-resolution" />
      </label>
      <fieldset>
        <legend className="mb-1 text-xs text-ink-faint">Categories</legend>
        <div className="grid grid-cols-2 gap-1">
          {CATEGORIES.map((c) => (
            <label key={c} className="flex items-center gap-2 text-xs text-ink-dim">
              <input type="checkbox" checked={s.categories[c]} onChange={(e) => settings.mutate({ categories: { [c]: e.target.checked } as never })} data-testid={`pref-cat-${c}`} />
              {CATEGORY_LABEL[c]}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-dim">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={s.quietHours.enabled} onChange={(e) => settings.mutate({ quietHours: { ...s.quietHours, enabled: e.target.checked } })} data-testid="pref-quiet" />
          Quiet hours (UTC)
        </label>
        <input type="time" value={s.quietHours.start} onChange={(e) => settings.mutate({ quietHours: { ...s.quietHours, start: e.target.value } })} className={field} aria-label="Quiet hours start" />
        <span>to</span>
        <input type="time" value={s.quietHours.end} onChange={(e) => settings.mutate({ quietHours: { ...s.quietHours, end: e.target.value } })} className={field} aria-label="Quiet hours end" />
      </div>
      <p className="text-[11px] text-ink-faint">In-app notifications only for now: no email, SMS or push. Priority is how much it matters to you, not how severe the event is.</p>
    </Card>
  );
}

export default function WatchlistPage() {
  const { data: watches = [], isLoading } = useWatches();
  const { data: feed } = useNotificationFeed();
  const { notify } = useWatcherMutations();
  const [open, setOpen] = useState<string | null>(null);
  const toggle = (n: NotificationDTO) => {
    setOpen(open === n.id ? null : n.id);
    if (open !== n.id && !n.readAt) notify.mutate({ action: "read", ids: [n.id] });
  };

  return (
    <main className="mx-auto max-w-5xl px-4 pb-28 pt-24 sm:px-6 sm:pt-32" data-testid="watchlist-page">
      <h1 className="text-2xl font-semibold text-ink">Watchlist</h1>
      <p className="mt-1 text-sm text-ink-dim">Follow what you care about. By default you are only told about major developments — never every raw event, and never the same development twice.</p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <section data-testid="following">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-faint">Following</h2>
            {isLoading ? (
              <p className="text-xs text-ink-faint">Loading…</p>
            ) : watches.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-xs text-ink-faint" data-testid="watchlist-empty">
                You are not following anything yet. Use “Follow something”, or the Follow button on any country, conflict, actor, airport or chokepoint page.
              </p>
            ) : (
              GROUPS.map((g) => {
                const list = watches.filter((w) => g.types.includes(w.entityType));
                if (list.length === 0) return null;
                return (
                  <div key={g.title} className="mb-5" data-testid={g.testId}>
                    <h3 className="mb-2 text-xs font-medium text-ink-dim">{g.title}</h3>
                    <ul className="space-y-2">
                      {list.map((w) => (
                        <WatchCard key={w.id} w={w} />
                      ))}
                    </ul>
                  </div>
                );
              })
            )}
          </section>

          <section data-testid="recent-alerts">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-faint">Recent alerts</h2>
            <Card className="overflow-hidden">
              {!feed || feed.items.length === 0 ? (
                <p className="px-4 py-6 text-center text-xs text-ink-faint">No alerts yet.</p>
              ) : (
                <ul>
                  {feed.items.slice(0, 20).map((n) => (
                    <NotificationItem key={n.id} n={n} open={open === n.id} onToggle={() => toggle(n)} />
                  ))}
                </ul>
              )}
            </Card>
          </section>
        </div>

        <div className="space-y-4">
          <AddWatch />
          <Preferences />
        </div>
      </div>
    </main>
  );
}
