import { NextResponse } from "next/server";
import { getEvent, setEventPublished } from "@/lib/db/repositories/events";

// Publish/republish an existing event (Draft -> Published, or
// Unpublished -> Published again). Distinct from
// POST /api/admin/incoming/[id]/publish, which creates a brand-new event
// from a reviewed incoming report — this route only flips the status of
// an event that already exists.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const existing = await getEvent(id);
  if (!existing) return NextResponse.json({ error: "Event not found" }, { status: 404 });

  const updated = await setEventPublished(id, true);
  return NextResponse.json(updated);
}
