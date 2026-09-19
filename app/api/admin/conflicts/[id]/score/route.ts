import { NextResponse } from "next/server";
import { scoreConflict } from "@/lib/db/repositories/scoring";

// Central Conflict Scoring Engine v1 §8 — admin debug endpoint: severity +
// confidence always, impact only when ?countryCode= is supplied (the
// "impact preview for a selected country" feature).
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const countryCode = new URL(request.url).searchParams.get("countryCode");
  const scores = await scoreConflict(id, countryCode);
  if (!scores) return NextResponse.json({ error: "Conflict not found" }, { status: 404 });
  return NextResponse.json(scores);
}
