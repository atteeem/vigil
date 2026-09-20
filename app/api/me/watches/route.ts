import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getWatcher, unauthorized } from "@/lib/alerts/watcher";
import { describeWatchable } from "@/lib/alerts/entities";
import { toWatchDTO } from "@/lib/alerts/dto";
import { WATCH_ENTITY_TYPES, WATCH_MODES, validateRules, type WatchEntityType, type WatchMode } from "@/lib/alerts/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const watcher = await getWatcher(request);
  if (!watcher) return unauthorized();
  const rows = await prisma.watch.findMany({ where: { watcherId: watcher.id }, orderBy: { createdAt: "asc" } });
  return NextResponse.json(rows.map(toWatchDTO));
}

/** Follow something. Idempotent: following the same (type, key) again returns the existing watch. */
export async function POST(request: Request) {
  const watcher = await getWatcher(request);
  if (!watcher) return unauthorized();
  const body = (await request.json().catch(() => null)) as { entityType?: string; entityKey?: string; label?: string; mode?: string; rules?: unknown } | null;
  if (!body?.entityType || !body.entityKey || !(WATCH_ENTITY_TYPES as readonly string[]).includes(body.entityType)) return NextResponse.json({ error: `entityType must be one of ${WATCH_ENTITY_TYPES.join(", ")} and entityKey is required` }, { status: 400 });
  const type = body.entityType as WatchEntityType;
  const target = await describeWatchable(type, body.entityKey, body.label);
  if (!target) return NextResponse.json({ error: `Unknown ${type}: ${body.entityKey}` }, { status: 404 });
  const mode = (WATCH_MODES as readonly string[]).includes(body.mode ?? "") ? (body.mode as WatchMode) : "major";
  const rules = validateRules(type, target.entityKey, body.rules ?? {});
  if (!rules.ok) return NextResponse.json({ error: rules.error }, { status: 400 });

  const existing = await prisma.watch.findUnique({ where: { watcherId_entityType_entityKey: { watcherId: watcher.id, entityType: type, entityKey: target.entityKey } } });
  if (existing) return NextResponse.json(toWatchDTO(existing), { status: 200 });
  const watch = await prisma.watch.create({ data: { watcherId: watcher.id, entityType: type, entityKey: target.entityKey, label: target.label, mode, rules: JSON.stringify(rules.rules) } });
  return NextResponse.json(toWatchDTO(watch), { status: 201 });
}
