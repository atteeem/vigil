import { NextResponse } from "next/server";
import { searchCountries, resolveCountry } from "@/lib/countries/registry";
import { identityOf, getCountrySummary } from "@/lib/countries/intelligence";

// Country registry search and the comparison foundation.
//   GET /api/countries?q=suomi            -> registry matches (ISO2 / ISO3 / name / alias)
//   GET /api/countries?codes=FI,SE,EE     -> comparable summaries (max 5): exposure, active developments,
//                                            infrastructure disruption, hazards, freshness
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const p = new URL(request.url).searchParams;
  const codes = p.get("codes");
  if (codes) {
    const wanted = [...new Set(codes.split(",").map((c) => resolveCountry(c)?.code).filter((c): c is string => !!c))].slice(0, 5);
    if (wanted.length === 0) return NextResponse.json({ error: "No known country in `codes`" }, { status: 400 });
    const summaries = await Promise.all(wanted.map((c) => getCountrySummary(c)));
    return NextResponse.json({ countries: summaries.filter(Boolean) });
  }
  const q = p.get("q") ?? "";
  return NextResponse.json({ countries: searchCountries(q, Math.min(Number(p.get("limit")) || 8, 25)).map(identityOf) });
}
