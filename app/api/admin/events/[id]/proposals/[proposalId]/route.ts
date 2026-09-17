import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { acceptProposal, rejectProposal } from "@/lib/db/repositories/event-updates";

interface PatchBody {
  action: "accept" | "reject";
}

// Admin review actions on one pending update proposal (spec "Admin
// actions: Accept field update, Reject field update"). Accepting mutates
// the event and writes an EventHistory row in one transaction (see
// acceptProposal); rejecting leaves the event completely untouched and
// writes no history — see rejectProposal's own comment.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; proposalId: string }> }) {
  const { id, proposalId } = await params;
  const existing = await prisma.eventUpdateProposal.findUnique({ where: { id: proposalId } });
  if (!existing || existing.eventId !== id) {
    return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
  }
  if (existing.status !== "pending") {
    return NextResponse.json({ error: "Proposal has already been resolved" }, { status: 409 });
  }

  const body = (await request.json().catch(() => null)) as PatchBody | null;
  if (body?.action === "accept") {
    const { proposal, event } = await acceptProposal(proposalId);
    return NextResponse.json({ proposal, event });
  }
  if (body?.action === "reject") {
    const proposal = await rejectProposal(proposalId);
    return NextResponse.json({ proposal });
  }
  return NextResponse.json({ error: "action must be accept or reject" }, { status: 400 });
}
