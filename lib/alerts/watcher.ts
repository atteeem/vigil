import { NextResponse } from "next/server";
import type { Watcher } from "@prisma/client";
import { prisma } from "@/lib/db/client";

// There are no server accounts yet: a watcher is a per-device profile. The client id (random, 128+ bits,
// generated in the browser) is the bearer secret for that profile's watches and notifications; every /api/me
// route requires it and only ever touches rows owned by it. When real accounts arrive the id can be bound to
// one without changing watches, notifications or history.
export const CLIENT_HEADER = "x-vigil-client";
const CLIENT_ID = /^[A-Za-z0-9_-]{22,64}$/;

export async function getWatcher(request: Request): Promise<Watcher | null> {
  const id = request.headers.get(CLIENT_HEADER);
  if (!id || !CLIENT_ID.test(id)) return null;
  return prisma.watcher.upsert({ where: { id }, update: {}, create: { id } });
}

export const unauthorized = () => NextResponse.json({ error: `Missing or invalid ${CLIENT_HEADER} header` }, { status: 401 });
