import type { Notification, Watch } from "@prisma/client";
import { effectiveRules, ruleSchemaFor, type WatchEntityType, type WatchMode, type WatchRules } from "./types";
import { watchHref } from "./entities";

export function toWatchDTO(w: Watch) {
  const rules = JSON.parse(w.rules || "{}") as WatchRules;
  const type = w.entityType as WatchEntityType;
  return {
    id: w.id,
    entityType: type,
    entityKey: w.entityKey,
    label: w.label,
    mode: w.mode as WatchMode,
    rules,
    effectiveRules: effectiveRules(type, w.entityKey, w.mode as WatchMode, rules),
    ruleSchema: ruleSchemaFor(type, w.entityKey),
    muted: w.muted,
    pausedUntil: w.pausedUntil?.toISOString() ?? null,
    href: watchHref(type, w.entityKey),
    createdAt: w.createdAt.toISOString(),
  };
}

export function toNotificationDTO(n: Notification) {
  return {
    id: n.id,
    fingerprint: n.fingerprint,
    alertType: n.alertType,
    category: n.category,
    priority: n.priority,
    priorityScore: n.priorityScore,
    title: n.title,
    summary: n.summary,
    entityType: n.entityType,
    entityKey: n.entityKey,
    entityLabel: n.entityLabel,
    eventId: n.eventId,
    globalEventId: n.globalEventId,
    conflictSlug: n.conflictSlug,
    deepLink: n.deepLink,
    snapshot: JSON.parse(n.snapshot) as Record<string, unknown>,
    reason: JSON.parse(n.reason) as Record<string, unknown>,
    isPartyClaim: n.isPartyClaim,
    isResolution: n.isResolution,
    suppressedCount: n.suppressedCount,
    quiet: n.quiet,
    createdAt: n.createdAt.toISOString(),
    readAt: n.readAt?.toISOString() ?? null,
    dismissedAt: n.dismissedAt?.toISOString() ?? null,
    archivedAt: n.archivedAt?.toISOString() ?? null,
  };
}
