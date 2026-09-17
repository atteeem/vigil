import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { setExtractedFactStatus, editExtractedFactValue, toExtractedFactDTO } from "@/lib/db/repositories/extracted-facts";

interface PatchBody {
  action: "accept" | "reject" | "edit";
  value?: string; // required when action === "edit"
}

// Admin review actions on one extracted fact (spec "allow accepting/
// rejecting individual fields"). Deliberately per-fact, not per-item —
// a field can have several coexisting facts (e.g. two conflicting
// casualty figures), and the admin disposition of each is independent.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; factId: string }> }) {
  const { id, factId } = await params;
  const existing = await prisma.extractedFact.findUnique({ where: { id: factId } });
  if (!existing || existing.rawIngestionItemId !== id) {
    return NextResponse.json({ error: "Extracted fact not found" }, { status: 404 });
  }

  const body = (await request.json()) as PatchBody;
  if (body.action === "accept" || body.action === "reject") {
    const updated = await setExtractedFactStatus(factId, body.action === "accept" ? "accepted" : "rejected");
    return NextResponse.json(toExtractedFactDTO(updated));
  }
  if (body.action === "edit") {
    if (typeof body.value !== "string" || !body.value.trim()) {
      return NextResponse.json({ error: "value is required for an edit" }, { status: 400 });
    }
    const updated = await editExtractedFactValue(factId, body.value.trim());
    return NextResponse.json(toExtractedFactDTO(updated));
  }
  return NextResponse.json({ error: "action must be accept, reject, or edit" }, { status: 400 });
}
