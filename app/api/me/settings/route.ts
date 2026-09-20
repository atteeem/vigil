import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getWatcher, unauthorized } from "@/lib/alerts/watcher";
import { parseSettings, validateSettingsPatch } from "@/lib/alerts/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const watcher = await getWatcher(request);
  if (!watcher) return unauthorized();
  return NextResponse.json(parseSettings(watcher.settings));
}

export async function PUT(request: Request) {
  const watcher = await getWatcher(request);
  if (!watcher) return unauthorized();
  const v = validateSettingsPatch(await request.json().catch(() => null));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  const current = parseSettings(watcher.settings);
  const next = { ...current, ...v.patch, categories: { ...current.categories, ...(v.patch.categories ?? {}) } };
  await prisma.watcher.update({ where: { id: watcher.id }, data: { settings: JSON.stringify(next) } });
  return NextResponse.json(next);
}
