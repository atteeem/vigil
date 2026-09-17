import { NextResponse } from "next/server";
import { getEvent } from "@/lib/db/repositories/events";
import { acceptAllSafeProposals } from "@/lib/db/repositories/event-updates";

// Bulk convenience action (spec "Accept all safe/high-confidence updates
// where appropriate") — still an explicit admin click, not an unattended
// auto-apply; see acceptAllSafeProposals' own comment for the confidence
// bar and why every field here stays approval-based regardless.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const event = await getEvent(id);
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

  const accepted = await acceptAllSafeProposals(id);
  return NextResponse.json({ accepted });
}
