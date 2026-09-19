import { NextResponse } from "next/server";
import { scoreEvent } from "@/lib/db/repositories/scoring";

// Central Conflict Scoring Engine v1 §8 — admin debug endpoint, same shape
// as the conflict one: severity + confidence always, impact only when
// ?countryCode= is supplied.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const countryCode = new URL(request.url).searchParams.get("countryCode");
  const scores = await scoreEvent(id, countryCode);
  if (!scores) return NextResponse.json({ error: "Event not found" }, { status: 404 });
  return NextResponse.json(scores);
}
