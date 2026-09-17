import { NextResponse } from "next/server";
import { getEvent, setEventPublished } from "@/lib/db/repositories/events";

// Unpublish: removes the event from the public /world view (GET
// /api/events filters to published: true) without deleting it or its
// supporting-source history — publishedAt is preserved so the event
// still reads as "Unpublished" rather than reverting to "Draft".
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const existing = await getEvent(id);
  if (!existing) return NextResponse.json({ error: "Event not found" }, { status: 404 });

  const updated = await setEventPublished(id, false);
  return NextResponse.json(updated);
}
