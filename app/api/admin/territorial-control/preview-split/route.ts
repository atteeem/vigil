import { NextResponse } from "next/server";
import { previewSplit } from "@/lib/db/repositories/territorial-control";

// Read-only: what a partial change would produce (affected area vs the
// remainder that stays with the old controller). Writes nothing.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { sourceId?: string; geometry?: unknown } | null;
  if (!body?.sourceId) return NextResponse.json({ error: "sourceId is required" }, { status: 400 });
  return NextResponse.json(await previewSplit(body.sourceId, body.geometry));
}
