import { NextResponse } from "next/server";
import { getWatcher } from "@/lib/alerts/watcher";
import { getBriefSnapshot } from "@/lib/brief/brief";

export const dynamic = "force-dynamic";

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const watcher = request.headers.get("x-vigil-client") ? await getWatcher(request) : null;
  const snap = await getBriefSnapshot(id, watcher?.id ?? null);
  return snap ? NextResponse.json(snap) : NextResponse.json({ error: "Not found" }, { status: 404 });
}
