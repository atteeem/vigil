import { NextResponse } from "next/server";
import { getWatcher } from "@/lib/alerts/watcher";
import { getBrief, listBriefSnapshots, saveBriefSnapshot } from "@/lib/brief/brief";
import { briefError, briefQueryFrom } from "@/lib/brief/request";

// Saved briefs. POST generates the brief for the same parameters as GET /api/brief and stores it as it is
// now (development ids + compact text + source references); GET lists a scope's recent snapshots.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const q = await briefQueryFrom(request);
  if (q instanceof NextResponse) return q;
  try {
    const brief = await getBrief(q);
    return NextResponse.json(await saveBriefSnapshot(brief, q.watcherId ?? null), { status: 201 });
  } catch (err) {
    return briefError(err);
  }
}

export async function GET(request: Request) {
  const p = new URL(request.url).searchParams;
  const watcher = request.headers.get("x-vigil-client") ? await getWatcher(request) : null;
  return NextResponse.json(await listBriefSnapshots(p.get("scope") ?? "global", watcher?.id ?? null, Number(p.get("limit")) || 10));
}
