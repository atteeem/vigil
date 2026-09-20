import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getWatcher, unauthorized } from "@/lib/alerts/watcher";
import { toWatchDTO } from "@/lib/alerts/dto";
import { WATCH_MODES, validateRules, type WatchEntityType, type WatchMode } from "@/lib/alerts/types";

export const dynamic = "force-dynamic";

/** Edit a watch: mode, custom rules, mute, pause. Only the owner's watches are reachable. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const watcher = await getWatcher(request);
  if (!watcher) return unauthorized();
  const { id } = await params;
  const watch = await prisma.watch.findFirst({ where: { id, watcherId: watcher.id } });
  if (!watch) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as { mode?: string; rules?: unknown; muted?: boolean; pauseHours?: number | null } | null;
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const data: Record<string, unknown> = {};
  if (body.mode !== undefined) {
    if (!(WATCH_MODES as readonly string[]).includes(body.mode)) return NextResponse.json({ error: `mode must be one of ${WATCH_MODES.join(", ")}` }, { status: 400 });
    data.mode = body.mode as WatchMode;
  }
  if (body.rules !== undefined) {
    const v = validateRules(watch.entityType as WatchEntityType, watch.entityKey, body.rules);
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
    data.rules = JSON.stringify(v.rules);
  }
  if (body.muted !== undefined) data.muted = !!body.muted;
  if (body.pauseHours !== undefined) data.pausedUntil = body.pauseHours ? new Date(Date.now() + Math.min(Number(body.pauseHours), 24 * 30) * 3_600_000) : null;
  const updated = await prisma.watch.update({ where: { id }, data });
  return NextResponse.json(toWatchDTO(updated));
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const watcher = await getWatcher(request);
  if (!watcher) return unauthorized();
  const { id } = await params;
  const res = await prisma.watch.deleteMany({ where: { id, watcherId: watcher.id } });
  return NextResponse.json({ ok: res.count > 0 }, { status: res.count > 0 ? 200 : 404 });
}
