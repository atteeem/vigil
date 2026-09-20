import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getWatcher, unauthorized } from "@/lib/alerts/watcher";
import { toNotificationDTO } from "@/lib/alerts/dto";

export const dynamic = "force-dynamic";

/** The notification feed (newest first) plus the unread count. Dismissed/archived items are hidden unless asked for. */
export async function GET(request: Request) {
  const watcher = await getWatcher(request);
  if (!watcher) return unauthorized();
  const p = new URL(request.url).searchParams;
  const limit = Math.min(Number(p.get("limit")) || 50, 200);
  const where = { watcherId: watcher.id, ...(p.get("archived") === "1" ? {} : { dismissedAt: null, archivedAt: null }) };
  const [items, unreadCount] = await Promise.all([
    prisma.notification.findMany({ where: { ...where, ...(p.get("unread") === "1" ? { readAt: null } : {}) }, orderBy: { createdAt: "desc" }, take: limit }),
    prisma.notification.count({ where: { watcherId: watcher.id, readAt: null, dismissedAt: null, archivedAt: null } }),
  ]);
  return NextResponse.json({ items: items.map(toNotificationDTO), unreadCount });
}

/** { action: "read" | "unread" | "dismiss" | "archive", ids?: string[], all?: true } */
export async function POST(request: Request) {
  const watcher = await getWatcher(request);
  if (!watcher) return unauthorized();
  const body = (await request.json().catch(() => null)) as { action?: string; ids?: string[]; all?: boolean } | null;
  if (!body?.action || !["read", "unread", "dismiss", "archive"].includes(body.action)) return NextResponse.json({ error: "action must be read, unread, dismiss or archive" }, { status: 400 });
  const now = new Date();
  const data = body.action === "read" ? { readAt: now } : body.action === "unread" ? { readAt: null } : body.action === "dismiss" ? { dismissedAt: now, readAt: now } : { archivedAt: now, readAt: now };
  const where = { watcherId: watcher.id, ...(body.all ? {} : { id: { in: body.ids ?? [] } }) };
  const res = await prisma.notification.updateMany({ where, data });
  const unreadCount = await prisma.notification.count({ where: { watcherId: watcher.id, readAt: null, dismissedAt: null, archivedAt: null } });
  return NextResponse.json({ updated: res.count, unreadCount });
}
