import { NextResponse } from "next/server";
import { getHazardDetail } from "@/lib/hazards/query";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const atRaw = new URL(request.url).searchParams.get("at");
  const at = atRaw ? new Date(atRaw) : null;
  if (at && Number.isNaN(at.getTime())) return NextResponse.json({ error: "'at' is not a valid timestamp" }, { status: 400 });
  const detail = await getHazardDetail(id, at);
  if (!detail) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(detail);
}
