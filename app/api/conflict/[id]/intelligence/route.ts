import { NextResponse } from "next/server";
import { getConflictIntelligence } from "@/lib/conflicts/intelligence";

// The whole conflict page as structured sections, from one server-side aggregation (lib/conflicts/intelligence.ts).
// Accepts the database id, the slug, the canonical name or a curated alias. Database / processed state only: no
// external provider is contacted while answering.
export const dynamic = "force-dynamic";

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const data = await getConflictIntelligence((await ctx.params).id);
  if (!data) return NextResponse.json({ error: "Unknown conflict" }, { status: 404 });
  return NextResponse.json(data);
}
