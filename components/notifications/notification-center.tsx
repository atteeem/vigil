"use client";

import { useState } from "react";
import Link from "next/link";
import { Activity, Bell, Flag, Plane, Ship, Swords, WifiOff, Zap } from "lucide-react";
import { RelativeTime } from "@/components/ui/relative-time";
import { useNotificationFeed, useWatcherMutations, useWatcherSync, type NotificationDTO } from "@/hooks/use-watcher";
import { cn } from "@/lib/utils";

const CATEGORY_ICON: Record<string, React.ComponentType<{ className?: string }>> = { conflicts: Swords, territorial: Flag, hazards: Activity, aviation: Plane, maritime: Ship, energy: Zap, internet: WifiOff };
const PRIORITY_STYLE: Record<string, string> = {
  CRITICAL: "border-red-400/50 bg-red-500/15 text-red-300",
  HIGH: "border-orange-400/50 bg-orange-500/15 text-orange-300",
  MEDIUM: "border-yellow-400/40 bg-yellow-500/10 text-yellow-200",
  LOW: "border-border-strong text-ink-faint",
};

/** Why this notification was sent: what the user follows, which rule fired, and how the priority was reached. */
export function NotificationReason({ n }: { n: NotificationDTO }) {
  const r = n.reason;
  return (
    <div className="mt-2 rounded-lg border border-border bg-surface/60 px-3 py-2 text-[11px] text-ink-dim" data-testid="notification-reason">
      <p className="font-semibold text-ink">Why you received this</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        {r.follows && (
          <li data-testid="reason-follows">
            You watch {r.follows.label} <span className="text-ink-faint">({r.follows.typeLabel}{r.modeLabel ? ` · ${r.modeLabel}` : ""})</span>
          </li>
        )}
        {r.rule && <li data-testid="reason-rule">{r.rule}</li>}
        {r.changeNote && <li>{r.changeNote}</li>}
        {n.isPartyClaim && <li>Unverified party claim — delivered because you enabled party / aligned claims</li>}
        {n.isResolution && <li>Restoration / resolution alert</li>}
        {(r.alsoMatched?.length ?? 0) > 0 && <li>Also matched: {r.alsoMatched!.join(", ")}</li>}
        {n.suppressedCount > 0 && <li data-testid="reason-suppressed">{n.suppressedCount} repeat report{n.suppressedCount === 1 ? "" : "s"} of this development were merged into this notification</li>}
      </ul>
      <p className="mt-1.5 text-ink-faint" data-testid="reason-priority">
        Priority {n.priority} ({n.priorityScore}): {(r.priorityFactors ?? []).map((f) => `${f.name} ${f.value}`).join(" · ")}
        {(r.priorityNotes ?? []).length ? ` — ${(r.priorityNotes ?? []).join("; ")}` : ""}
      </p>
    </div>
  );
}

export function NotificationItem({ n, open, onToggle }: { n: NotificationDTO; open: boolean; onToggle: () => void }) {
  const Icon = CATEGORY_ICON[n.category] ?? Bell;
  const snapLink = n.snapshot.snapshotLink;
  return (
    <li className={cn("border-b border-border/60 px-3 py-2.5", !n.readAt && "bg-accent-dim/20")} data-testid="notification" data-priority={n.priority} data-unread={!n.readAt}>
      <button onClick={onToggle} className="flex w-full items-start gap-2.5 text-left" aria-expanded={open}>
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-ink-dim" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className={cn("rounded border px-1.5 py-px text-[9px] font-bold tracking-wide", PRIORITY_STYLE[n.priority])} data-testid="notification-priority">
              {n.priority}
            </span>
            {n.isPartyClaim && <span className="rounded border border-elevated/40 px-1.5 py-px text-[9px] font-bold text-elevated">PARTY CLAIM</span>}
            {n.isResolution && <span className="rounded border border-green-400/40 px-1.5 py-px text-[9px] font-bold text-green-300">RESOLVED</span>}
            {!n.readAt && <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-accent" aria-label="Unread" data-testid="unread-dot" />}
          </span>
          <span className="mt-0.5 block text-sm font-medium text-ink" data-testid="notification-title">
            {n.title}
          </span>
          <span className="block text-xs text-ink-dim">{n.summary}</span>
          <span className="mt-0.5 block text-[11px] text-ink-faint">
            {n.entityLabel} · <RelativeTime iso={n.createdAt} />
          </span>
        </span>
      </button>
      {open && (
        <div className="pl-6.5">
          <NotificationReason n={n} />
          <div className="mt-2 flex flex-wrap gap-3 text-xs">
            <Link href={n.deepLink} className="text-accent hover:underline" data-testid="notification-open">
              Open
            </Link>
            {snapLink && (
              <Link href={snapLink} className="text-accent hover:underline" data-testid="notification-snapshot-link">
                View the map as it was then
              </Link>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

/** The top-right bell: unread count, chronological feed, expandable explanation, deep links. */
export function NotificationBell({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const { data } = useNotificationFeed();
  const { notify } = useWatcherMutations();
  useWatcherSync();
  const unread = data?.unreadCount ?? 0;

  function toggle(n: NotificationDTO) {
    const next = expanded === n.id ? null : n.id;
    setExpanded(next);
    if (next && !n.readAt) notify.mutate({ action: "read", ids: [n.id] });
  }

  return (
    <div className={cn("relative", className)}>
      <button
        onClick={() => setOpen(!open)}
        aria-label="Notifications"
        aria-expanded={open}
        data-testid="notification-bell"
        className="relative flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface/60 text-ink-dim backdrop-blur-xl transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-bold text-bg" data-testid="unread-badge">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="fixed inset-x-3 top-16 z-[60] max-h-[70vh] overflow-y-auto rounded-2xl border border-border bg-surface/95 shadow-2xl backdrop-blur-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[26rem]" data-testid="notification-panel">
          <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
            <h2 className="text-sm font-semibold text-ink">Notifications</h2>
            <span className="flex items-center gap-3 text-xs">
              {unread > 0 && (
                <button onClick={() => notify.mutate({ action: "read", all: true })} className="text-accent hover:underline" data-testid="mark-all-read">
                  Mark all read
                </button>
              )}
              <Link href="/watchlist" onClick={() => setOpen(false)} className="text-accent hover:underline" data-testid="open-watchlist">
                Watchlist
              </Link>
            </span>
          </div>
          {!data || data.items.length === 0 ? (
            <p className="px-4 py-8 text-center text-xs text-ink-faint" data-testid="notifications-empty">
              No notifications yet. Follow a country, conflict or place on the Watchlist to be told about major developments.
            </p>
          ) : (
            <ul>
              {data.items.map((n) => (
                <NotificationItem key={n.id} n={n} open={expanded === n.id} onToggle={() => toggle(n)} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
