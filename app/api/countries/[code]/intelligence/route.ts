import { NextResponse } from "next/server";
import { resolveCountry } from "@/lib/countries/registry";
import { getCountryIntelligence } from "@/lib/countries/intelligence";

// The whole country page as structured sections, from one server-side aggregation (bounded queries, the
// cached brief universe, the central impact scoring). Party claims come back separately and labelled; the
// client decides whether to show them (Profile -> Sources).
export const dynamic = "force-dynamic";

export async function GET(_: Request, ctx: { params: Promise<{ code: string }> }) {
  const rec = resolveCountry((await ctx.params).code);
  if (!rec) return NextResponse.json({ error: "Unknown country" }, { status: 404 });
  const data = await getCountryIntelligence(rec.code);
  return NextResponse.json(data);
}
