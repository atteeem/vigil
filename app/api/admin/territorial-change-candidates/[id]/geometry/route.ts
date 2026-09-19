import { NextResponse } from "next/server";
import { attachGeometry } from "@/lib/db/repositories/territorial-changes";

// Admin-supplied geometry for an approved change awaiting geometry. Nothing
// is ever drawn automatically from prose.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { geometry?: unknown; validFrom?: string } | null;
  if (!body?.geometry) return NextResponse.json({ error: "geometry is required" }, { status: 400 });
  try {
    return NextResponse.json(await attachGeometry(id, body.geometry, { validFrom: body.validFrom ? new Date(body.validFrom) : null }));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not attach geometry" }, { status: 409 });
  }
}
