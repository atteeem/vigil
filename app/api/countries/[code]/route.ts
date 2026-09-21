import { NextResponse } from "next/server";
import { resolveCountry } from "@/lib/countries/registry";
import { getCountrySummary, identityOf } from "@/lib/countries/intelligence";

// One country: canonical identity (ISO codes, aliases, region, capital, borders) and its comparable summary.
export const dynamic = "force-dynamic";

export async function GET(_: Request, ctx: { params: Promise<{ code: string }> }) {
  const rec = resolveCountry((await ctx.params).code);
  if (!rec) return NextResponse.json({ error: "Unknown country" }, { status: 404 });
  return NextResponse.json({ country: identityOf(rec), summary: await getCountrySummary(rec.code) });
}
